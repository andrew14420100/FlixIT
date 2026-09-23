// @ts-nocheck
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MEDIA_ASSET_QUALITY_VERSION,
  mediaTypeSlug,
  buildMediaAssetFallback,
  mergeOfficialArtwork,
} from "./useAutomaticMediaAssets";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const BATCH_VERSION = "sc-artwork-server-batch-v5-priority";
const MAX_VISIBLE_CANDIDATES = 120;
const PRIMARY_BATCH_SIZE = 24;
const ARTWORK_STALE_MS = 24 * 60 * 60 * 1000;
const ARTWORK_MEMORY_MAX = 12000;

type NormalizedEntry = {
  item: any;
  id: number;
  type: "movie" | "tv";
  key: string;
};

type ArtworkMemoryEntry = {
  savedAt: number;
  value: any;
};

// Batch query signatures grow while catalogues paginate. Cache each backend
// result by title so appending a page never re-requests artwork already seen in
// another row, grid or route during the same session.
const artworkMemory = new Map<string, ArtworkMemoryEntry>();

function artworkKey(raw: any) {
  const id = Number(raw?.tmdbId || raw?.tmdb_id || raw?.id || 0);
  if (!id) return "";
  const type = raw?.type === "tv" || raw?.media_type === "tv" ? "tv" : "movie";
  return `${type}:${id}`;
}

function getArtworkMemory(key: string) {
  const hit = artworkMemory.get(key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt >= ARTWORK_STALE_MS) {
    artworkMemory.delete(key);
    return null;
  }
  return hit.value;
}

function setArtworkMemory(raw: any) {
  const key = artworkKey(raw);
  if (!key) return;

  if (artworkMemory.size >= ARTWORK_MEMORY_MAX && !artworkMemory.has(key)) {
    const removeCount = Math.max(1, Math.floor(ARTWORK_MEMORY_MAX * 0.15));
    let removed = 0;
    for (const oldKey of artworkMemory.keys()) {
      artworkMemory.delete(oldKey);
      removed += 1;
      if (removed >= removeCount) break;
    }
  }

  artworkMemory.set(key, { savedAt: Date.now(), value: raw });
}

function normalizeItem(item: any): NormalizedEntry | null {
  const id = Number(item?.id || item?.tmdbId || item?.tmdb_id || 0);
  if (!id) return null;
  const type = mediaTypeSlug(item?.media_type || item?.type, item) === "tv" ? "tv" : "movie";
  return { item, id, type, key: `${type}:${id}` };
}

function uniqueItems(items: any[]) {
  const seen = new Set<string>();
  const out: NormalizedEntry[] = [];
  for (const item of items || []) {
    const entry = normalizeItem(item);
    if (!entry || seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push(entry);
    if (out.length >= MAX_VISIBLE_CANDIDATES) break;
  }
  return out;
}

function requestItem(entry: NormalizedEntry) {
  const item = entry.item || {};
  return {
    tmdbId: entry.id,
    type: entry.type,
    title: item?.title || item?.name || "",
    name: item?.name || item?.title || "",
    original_title: item?.original_title || item?.original_name || "",
    original_name: item?.original_name || item?.original_title || "",
    release_date: item?.release_date || "",
    first_air_date: item?.first_air_date || "",
    year: item?.year || "",
  };
}

async function fetchBatch(entries: NormalizedEntry[], signal?: AbortSignal) {
  if (!entries.length) return { items: [], catalog_count: 0 };
  const response = await fetch(`${API_URL}/api/public/sc-artwork/batch`, {
    method: "POST",
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items: entries.map(requestItem) }),
  });
  if (!response.ok) throw new Error(`Artwork batch ${response.status}`);

  const payload = await response.json();
  (Array.isArray(payload?.items) ? payload.items : []).forEach(setArtworkMemory);
  return payload;
}

function embeddedArtwork(entry: NormalizedEntry) {
  const raw = entry?.item?.__artwork;
  if (!raw || typeof raw !== "object") return null;
  const id = Number(raw?.tmdbId || raw?.tmdb_id || entry.id || 0);
  if (!id) return null;
  return {
    ...raw,
    tmdbId: id,
    type: raw?.type === "tv" ? "tv" : entry.type,
  };
}

export default function useArtworkBatch(items: any[] = [], enabled = true) {
  const queryClient = useQueryClient();
  const normalized = useMemo(() => uniqueItems(items), [items]);

  const embedded = useMemo(
    () => normalized.map(embeddedArtwork).filter(Boolean),
    [normalized]
  );
  const memory = useMemo(
    () => normalized.map((entry) => getArtworkMemory(entry.key)).filter(Boolean),
    [normalized]
  );
  const knownKeys = useMemo(() => {
    const keys = new Set<string>();
    [...embedded, ...memory].forEach((raw: any) => {
      const key = artworkKey(raw);
      if (key) keys.add(key);
    });
    return keys;
  }, [embedded, memory]);
  const missing = useMemo(
    () => normalized.filter((entry) => !knownKeys.has(entry.key)),
    [normalized, knownKeys]
  );

  // Do not let a 50-title rail compete with Hero and the first visible cards in
  // one large request. Resolve the first screenful first, then warm the rest of
  // the rail only after that request has settled. Total coverage is unchanged,
  // but initial network/JSON work is substantially less bursty.
  const primaryMissing = useMemo(() => missing.slice(0, PRIMARY_BATCH_SIZE), [missing]);
  const backgroundMissing = useMemo(() => missing.slice(PRIMARY_BATCH_SIZE), [missing]);
  const primarySignature = useMemo(
    () => primaryMissing.map((entry) => entry.key).join("|"),
    [primaryMissing]
  );
  const backgroundSignature = useMemo(
    () => backgroundMissing.map((entry) => entry.key).join("|"),
    [backgroundMissing]
  );

  const primaryQuery = useQuery({
    queryKey: [BATCH_VERSION, "primary", primarySignature],
    queryFn: ({ signal }: any) => fetchBatch(primaryMissing, signal),
    enabled: !!enabled && primaryMissing.length > 0,
    staleTime: ARTWORK_STALE_MS,
    gcTime: ARTWORK_STALE_MS * 7,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const primarySettled =
    primaryMissing.length === 0 || primaryQuery.isSuccess || primaryQuery.isError;

  const backgroundQuery = useQuery({
    queryKey: [BATCH_VERSION, "background", backgroundSignature],
    queryFn: ({ signal }: any) => fetchBatch(backgroundMissing, signal),
    enabled: !!enabled && backgroundMissing.length > 0 && primarySettled,
    staleTime: ARTWORK_STALE_MS,
    gcTime: ARTWORK_STALE_MS * 7,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const data = useMemo(() => {
    const primaryRemote = Array.isArray(primaryQuery.data?.items) ? primaryQuery.data.items : [];
    const backgroundRemote = Array.isArray(backgroundQuery.data?.items) ? backgroundQuery.data.items : [];
    const map = new Map<string, any>();
    [...embedded, ...memory, ...primaryRemote, ...backgroundRemote].forEach((raw: any) => {
      const key = artworkKey(raw);
      if (key) map.set(key, raw);
    });
    return [...map.values()];
  }, [embedded, memory, primaryQuery.data, backgroundQuery.data]);

  const byKey = useMemo(() => {
    const map = new Map<string, any>();
    data.forEach((raw: any) => {
      const key = artworkKey(raw);
      if (key) map.set(key, raw);
    });
    return map;
  }, [data]);

  const resolvedByKey = useMemo(() => {
    const map = new Map<string, any>();
    normalized.forEach((entry) => {
      const fallback = buildMediaAssetFallback(entry.item, entry.type);
      const official = byKey.get(entry.key);
      map.set(
        entry.key,
        official?.active ? mergeOfficialArtwork(fallback, official) : fallback
      );
    });
    return map;
  }, [normalized, byKey]);

  useEffect(() => {
    if (!data.length) return;
    normalized.forEach((entry) => {
      const resolved = resolvedByKey.get(entry.key);
      if (!resolved) return;
      queryClient.setQueryData(
        ["media-assets", MEDIA_ASSET_QUALITY_VERSION, entry.type, entry.id],
        resolved
      );
    });
  }, [data, normalized, resolvedByKey, queryClient]);

  const getResolved = (item: any) => {
    const entry = normalizeItem(item);
    if (!entry) return null;
    return resolvedByKey.get(entry.key) || null;
  };

  const isReady = (item: any, targetRole: "landscape" | "poster" = "landscape") => {
    const resolved = getResolved(item);
    if (!resolved) return false;

    if (targetRole === "poster") {
      return !!(
        resolved?.poster_path ||
        resolved?.poster ||
        resolved?.poster_url ||
        item?.__artwork?.poster_url ||
        item?.poster_path ||
        item?.poster
      );
    }

    return !!(
      resolved?.card_ready ||
      resolved?.backdrop_path ||
      resolved?.titled_backdrop_path ||
      resolved?.backdrop_url ||
      item?.__artwork?.backdrop_url ||
      item?.backdrop_path
    );
  };

  const primaryFetching = primaryMissing.length > 0 && primaryQuery.isFetching;
  const backgroundFetching = backgroundMissing.length > 0 && backgroundQuery.isFetching;

  return {
    data,
    byKey,
    getResolved,
    isReady,
    count: normalized.length,
    catalogCount: Number(
      primaryQuery.data?.catalog_count || backgroundQuery.data?.catalog_count || 0
    ),
    isPending: primaryMissing.length > 0 && primaryQuery.isPending && !data.length,
    isFetching: primaryFetching || backgroundFetching,
    primaryPending: primaryMissing.length > 0 && primaryQuery.isPending,
    backgroundPending: backgroundFetching,
    error: primaryQuery.error || backgroundQuery.error,
  };
}
