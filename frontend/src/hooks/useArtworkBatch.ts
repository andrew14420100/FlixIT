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
const PRIMARY_BATCH_SIZE = 32;
const MAX_ACTIVE_BATCHES = 2;
const STORAGE_PREFIX = `flix-artwork-raw:${MEDIA_ASSET_QUALITY_VERSION}:`;

// One scheduler is shared by every Home row. This prevents 10-20 rows from each
// opening several /batch requests at the same time while still letting the first
// visible candidates of every row resolve before the deep background pool.
const memoryCache = new Map<string, { savedAt: number; value: any }>();
const pendingJobs = new Map<string, any>();
let activeBatches = 0;
let sequence = 0;
let pumpScheduled = false;

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

function fresh(savedAt: number) {
  return !!savedAt && Date.now() - Number(savedAt) < DAILY_ARTWORK_REFRESH_MS;
}

function readStored(entry: any) {
  const cached = memoryCache.get(entry.key);
  if (cached && fresh(cached.savedAt)) return cached.value;
  if (cached) memoryCache.delete(entry.key);

  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + entry.key) || "null");
    if (!parsed || !fresh(parsed.savedAt) || !parsed.value) return null;
    memoryCache.set(entry.key, parsed);
    return parsed.value;
  } catch {
    return null;
  }
}

function writeStored(entry: any, value: any) {
  if (!value) return;
  const record = { savedAt: Date.now(), value };
  memoryCache.set(entry.key, record);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + entry.key, JSON.stringify(record));
  } catch {
    // Storage pressure must never block the Home.
  }
}

function cachedValues(entries: any[]) {
  return entries.map(readStored).filter(Boolean);
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  Promise.resolve().then(() => {
    pumpScheduled = false;
    pumpQueue();
  });
}

function takeNextBatch() {
  const jobs = [...pendingJobs.values()]
    .sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
    .slice(0, MAX_BATCH);
  jobs.forEach((job) => pendingJobs.delete(job.entry.key));
  return jobs;
}

async function runBatch(jobs: any[]) {
  if (!jobs.length) return;
  activeBatches += 1;
  try {
    const response = await fetch("/api/public/official-artwork/batch", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: jobs.map((job) => ({ type: job.entry.type, tmdbId: job.entry.id })),
      }),
    });

    if (!response.ok) throw new Error(`artwork batch ${response.status}`);
    const payload = await response.json();
    const resultMap = new Map<string, any>();
    for (const raw of payload?.items || []) {
      const id = Number(raw?.tmdbId || raw?.tmdb_id || 0);
      const type = raw?.type === "tv" ? "tv" : "movie";
      if (id) resultMap.set(`${type}:${id}`, raw);
    }

    for (const job of jobs) {
      const value = resultMap.get(job.entry.key) || null;
      if (value) writeStored(job.entry, value);
      job.waiters.forEach((resolve: any) => resolve(value));
    }
  } catch {
    // Do not cache transport failures. A later query/reload can retry them.
    jobs.forEach((job) => job.waiters.forEach((resolve: any) => resolve(null)));
  } finally {
    activeBatches -= 1;
    schedulePump();
  }
}

function pumpQueue() {
  while (activeBatches < MAX_ACTIVE_BATCHES && pendingJobs.size > 0) {
    const jobs = takeNextBatch();
    if (!jobs.length) break;
    void runBatch(jobs);
  }
}

function enqueue(entry: any, priority: number) {
  const cached = readStored(entry);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const existing = pendingJobs.get(entry.key);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      existing.waiters.push(resolve);
    } else {
      pendingJobs.set(entry.key, {
        entry,
        priority,
        sequence: sequence++,
        waiters: [resolve],
      });
    }
    schedulePump();
  });
}

async function resolveMany(entries: any[], priority: number) {
  const values = await Promise.all(entries.map((entry) => enqueue(entry, priority)));
  return values.filter(Boolean);
}

function mergeRaw(...groups: any[][]) {
  const map = new Map<string, any>();
  groups.flat().forEach((raw) => {
    const id = Number(raw?.tmdbId || raw?.tmdb_id || 0);
    const type = raw?.type === "tv" ? "tv" : "movie";
    if (id) map.set(`${type}:${id}`, raw);
  });
  return [...map.values()];
}

/**
 * Progressive Netflix-like artwork hydration.
 *
 * - first 32 candidates of every row are priority 0 and paint quickly;
 * - the remaining candidate pool is priority 1 and fills the row toward 50;
 * - duplicate IDs across rows are coalesced globally;
 * - only two browser batch requests are active at once;
 * - successful raw provider decisions survive reloads for 24h in localStorage;
 * - individual useAutomaticMediaAssets query keys are still seeded for complete
 *   compatibility with cards, Hero, Cinema, Serie TV and Catalogo.
 */
export default function useArtworkBatch(items: any[] = [], enabled = true) {
  const queryClient = useQueryClient();
  const normalized = useMemo(() => uniqueItems(items), [items]);
  const primary = useMemo(() => normalized.slice(0, PRIMARY_BATCH_SIZE), [normalized]);
  const background = useMemo(() => normalized.slice(PRIMARY_BATCH_SIZE), [normalized]);
  const primarySignature = useMemo(() => primary.map((entry) => entry.key).join("|"), [primary]);
  const backgroundSignature = useMemo(() => background.map((entry) => entry.key).join("|"), [background]);

  const primaryQuery = useQuery({
    queryKey: ["artwork-batch-primary", MEDIA_ASSET_QUALITY_VERSION, primarySignature],
    queryFn: () => resolveMany(primary, 0),
    enabled: !!enabled && primary.length > 0,
    placeholderData: () => cachedValues(primary),
    staleTime: DAILY_ARTWORK_REFRESH_MS,
    gcTime: DAILY_ARTWORK_REFRESH_MS * 7,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const backgroundQuery = useQuery({
    queryKey: ["artwork-batch-background", MEDIA_ASSET_QUALITY_VERSION, backgroundSignature],
    queryFn: () => resolveMany(background, 1),
    enabled: !!enabled && background.length > 0,
    placeholderData: () => cachedValues(background),
    staleTime: DAILY_ARTWORK_REFRESH_MS,
    gcTime: DAILY_ARTWORK_REFRESH_MS * 7,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const data = useMemo(
    () => mergeRaw(primaryQuery.data || [], backgroundQuery.data || []),
    [primaryQuery.data, backgroundQuery.data]
  );

  const byKey = useMemo(() => {
    const map = new Map<string, any>();
    for (const raw of data) {
      const id = Number(raw?.tmdbId || raw?.tmdb_id || 0);
      const type = raw?.type === "tv" ? "tv" : "movie";
      if (id) map.set(`${type}:${id}`, raw);
    }
    return map;
  }, [data]);

  useEffect(() => {
    if (!data.length) return;
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
  }, [data, byKey, normalized, queryClient]);

  const getResolved = (item: any) => {
    const entry = normalizeItem(item);
    if (!entry) return null;
    const fallback = buildMediaAssetFallback(item, entry.type);
    const official = byKey.get(entry.key) || readStored(entry);
    return official ? mergeOfficialArtwork(fallback, official) : fallback;
  };

  const isReady = (item: any, role: "landscape" | "poster" = "landscape") => {
    const resolved = getResolved(item);
    if (!resolved) return false;
    return role === "poster" ? !!resolved.top10_ready : !!resolved.card_ready;
  };

  return {
    data,
    byKey,
    getResolved,
    isReady,
    count: normalized.length,
    isPending: primaryQuery.isPending && !primaryQuery.data?.length,
    isFetching: primaryQuery.isFetching || backgroundQuery.isFetching,
    primaryPending: primaryQuery.isPending,
    backgroundPending: backgroundQuery.isPending,
    error: primaryQuery.error || backgroundQuery.error,
  };
}
