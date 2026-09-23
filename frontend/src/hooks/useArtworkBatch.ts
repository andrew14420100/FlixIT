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
const BATCH_VERSION = "sc-artwork-server-batch-v4-memory";
const MAX_VISIBLE_CANDIDATES = 120;
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

// Batch query keys naturally change when a paginated grid grows. Without a
// per-title cache, appending page 2 caused page 1 artwork to be requested again
// inside the new larger signature. Keep the validated backend result by title so
// Home rows, Film/Serie grids and future pages only request genuinely new ids.
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
  const signature = useMemo(() => missing.map((entry) => entry.key).join("|"), [missing]);

  const batchQuery = useQuery({
    queryKey: [BATCH_VERSION, signature],
    queryFn: ({ signal }: any) => fetchBatch(missing, signal),
    enabled: !!enabled && missing.length > 0,
    staleTime: ARTWORK_STALE_MS,
    gcTime: ARTWORK_STALE_MS * 7,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const data = useMemo(() => {
    const remote = Array.isArray(batchQuery.data?.items) ? batchQuery.data.items : [];
    const map = new Map<string, any>();
    [...embedded, ...memory, ...remote].forEach((raw: any) => {
      const key = artworkKey(raw);
      if (key) map.set(key, raw);
    });
    return [...map.values()];
  }, [embedded, memory, batchQuery.data]);

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

  return {
    data,
    byKey,
    getResolved,
    isReady,
    count: normalized.length,
    catalogCount: Number(batchQuery.data?.catalog_count || 0),
    isPending: missing.length > 0 && batchQuery.isPending && !data.length,
    isFetching: missing.length > 0 && batchQuery.isFetching,
    primaryPending: missing.length > 0 && batchQuery.isPending,
    backgroundPending: false,
    error: batchQuery.error,
  };
}
