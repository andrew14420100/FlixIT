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
const BATCH_VERSION = "sc-artwork-server-batch-v1";
const MAX_VISIBLE_CANDIDATES = 90;
const ARTWORK_STALE_MS = 24 * 60 * 60 * 1000;

type NormalizedEntry = {
  item: any;
  id: number;
  type: "movie" | "tv";
  key: string;
};

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
  return response.json();
}

export default function useArtworkBatch(items: any[] = [], enabled = true) {
  const queryClient = useQueryClient();
  const normalized = useMemo(() => uniqueItems(items), [items]);
  const signature = useMemo(() => normalized.map((entry) => entry.key).join("|"), [normalized]);

  const batchQuery = useQuery({
    queryKey: [BATCH_VERSION, signature],
    queryFn: ({ signal }: any) => fetchBatch(normalized, signal),
    enabled: !!enabled && normalized.length > 0,
    staleTime: ARTWORK_STALE_MS,
    gcTime: ARTWORK_STALE_MS * 7,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const data = useMemo(
    () => (Array.isArray(batchQuery.data?.items) ? batchQuery.data.items : []),
    [batchQuery.data]
  );

  const byKey = useMemo(() => {
    const map = new Map<string, any>();
    data.forEach((raw: any) => {
      const id = Number(raw?.tmdbId || raw?.tmdb_id || 0);
      const type = raw?.type === "tv" ? "tv" : "movie";
      if (id) map.set(`${type}:${id}`, raw);
    });
    return map;
  }, [data]);

  // Seed every title resolved by the batch, including explicit misses. Without
  // the miss seed, each visible card that had no SC match immediately repeated
  // the same work through /official-artwork, creating dozens of redundant GETs.
  useEffect(() => {
    if (!data.length) return;
    normalized.forEach((entry) => {
      const official = byKey.get(entry.key);
      if (!official) return;
      const fallback = buildMediaAssetFallback(entry.item, entry.type);
      queryClient.setQueryData(
        ["media-assets", MEDIA_ASSET_QUALITY_VERSION, entry.type, entry.id],
        official?.active ? mergeOfficialArtwork(fallback, official) : fallback
      );
    });
  }, [data, byKey, normalized, queryClient]);

  const getResolved = (item: any) => {
    const entry = normalizeItem(item);
    if (!entry) return null;
    const fallback = buildMediaAssetFallback(item, entry.type);
    const official = byKey.get(entry.key);
    return official?.active ? mergeOfficialArtwork(fallback, official) : fallback;
  };

  const isReady = (item: any, targetRole: "landscape" | "poster" = "landscape") => {
    const resolved = getResolved(item);
    if (!resolved) return false;
    return targetRole === "poster" ? !!resolved.top10_ready : !!resolved.card_ready;
  };

  return {
    data,
    byKey,
    getResolved,
    isReady,
    count: normalized.length,
    catalogCount: Number(batchQuery.data?.catalog_count || 0),
    isPending: batchQuery.isPending && !data.length,
    isFetching: batchQuery.isFetching,
    primaryPending: batchQuery.isPending,
    backgroundPending: false,
    error: batchQuery.error,
  };
}
