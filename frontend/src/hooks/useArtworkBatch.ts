// @ts-nocheck
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MEDIA_ASSET_QUALITY_VERSION,
  DAILY_ARTWORK_REFRESH_MS,
  mediaTypeSlug,
  buildMediaAssetFallback,
  mergeOfficialArtwork,
} from "./useAutomaticMediaAssets";

const MAX_BATCH = 40;

function normalizeItem(item: any) {
  const id = item?.id || item?.tmdbId || item?.tmdb_id;
  if (!id) return null;
  const type = mediaTypeSlug(item?.media_type || item?.type, item);
  return { item, id: Number(id), type, key: `${type}:${Number(id)}` };
}

function uniqueItems(items: any[]) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const item of items || []) {
    const normalized = normalizeItem(item);
    if (!normalized || !normalized.id || seen.has(normalized.key)) continue;
    seen.add(normalized.key);
    out.push(normalized);
  }
  return out;
}

function chunks(values: any[], size: number) {
  const out = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

/**
 * Hydrate many cards with one HTTP request per <=40 titles, then seed the exact
 * individual React Query keys consumed by useAutomaticMediaAssets. This removes
 * the N-card request waterfall while keeping every card hook backwards-compatible.
 */
export default function useArtworkBatch(items: any[] = [], enabled = true) {
  const queryClient = useQueryClient();
  const normalized = useMemo(() => uniqueItems(items), [items]);
  const signature = useMemo(
    () => normalized.map((entry) => entry.key).join("|"),
    [normalized]
  );

  const query = useQuery({
    queryKey: ["artwork-batch", MEDIA_ASSET_QUALITY_VERSION, signature],
    queryFn: async ({ signal }: any) => {
      const all: any[] = [];
      for (const group of chunks(normalized, MAX_BATCH)) {
        if (signal?.aborted) break;
        const response = await fetch("/api/public/official-artwork/batch", {
          method: "POST",
          signal,
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: group.map((entry) => ({ type: entry.type, tmdbId: entry.id })),
          }),
        });
        if (!response.ok) continue;
        const payload = await response.json();
        all.push(...(payload?.items || []));
      }
      return all;
    },
    enabled: !!enabled && normalized.length > 0,
    staleTime: DAILY_ARTWORK_REFRESH_MS,
    gcTime: DAILY_ARTWORK_REFRESH_MS * 7,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const byKey = useMemo(() => {
    const map = new Map<string, any>();
    for (const raw of query.data || []) {
      const id = Number(raw?.tmdbId || raw?.tmdb_id || 0);
      const type = raw?.type === "tv" ? "tv" : "movie";
      if (id) map.set(`${type}:${id}`, raw);
    }
    return map;
  }, [query.data]);

  useEffect(() => {
    if (!query.data?.length) return;
    for (const entry of normalized) {
      const official = byKey.get(entry.key);
      if (!official) continue;
      const fallback = buildMediaAssetFallback(entry.item, entry.type);
      const merged = mergeOfficialArtwork(fallback, official);
      queryClient.setQueryData(
        ["media-assets", MEDIA_ASSET_QUALITY_VERSION, entry.type, entry.id],
        merged
      );
    }
  }, [query.data, byKey, normalized, queryClient]);

  const getResolved = (item: any) => {
    const entry = normalizeItem(item);
    if (!entry) return null;
    const fallback = buildMediaAssetFallback(item, entry.type);
    const official = byKey.get(entry.key);
    return official ? mergeOfficialArtwork(fallback, official) : fallback;
  };

  const isReady = (item: any, role: "landscape" | "poster" = "landscape") => {
    const resolved = getResolved(item);
    if (!resolved) return false;
    return role === "poster" ? !!resolved.top10_ready : !!resolved.card_ready;
  };

  return {
    ...query,
    byKey,
    getResolved,
    isReady,
    count: normalized.length,
  };
}
