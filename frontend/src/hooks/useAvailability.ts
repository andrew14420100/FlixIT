// @ts-nocheck
import { useEffect, useMemo, useState } from "react";

const cache = new Map<string, boolean>();
const keyOf = (type, id) => `${type === "tv" ? "tv" : "movie"}-${id}`;
const BATCH_MEMO_MS = 10 * 1000;
const batchMemo = new Map<string, { at: number; promise: Promise<any> }>();

function normalizedUnknown(items, getType) {
  const seen = new Set<string>();
  const out = [];
  for (const item of items || []) {
    const type = getType(item) === "tv" ? "tv" : "movie";
    const id = Number(item?.id ?? item?.tmdbId ?? item?.tmdb_id ?? 0);
    if (!id) continue;
    const key = keyOf(type, id);
    if (cache.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id });
  }
  return out;
}

function availabilityBatch(items) {
  const signature = items.map((item) => keyOf(item.type, item.id)).sort().join("|");
  const hit = batchMemo.get(signature);
  const now = Date.now();
  if (hit && now - hit.at < BATCH_MEMO_MS) return hit.promise;

  const promise = fetch("/api/public/availability", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ items }),
  })
    .then(async (response) => response.ok ? response.json() : null)
    .finally(() => {
      window.setTimeout(() => {
        const current = batchMemo.get(signature);
        if (current?.promise === promise && Date.now() - current.at >= BATCH_MEMO_MS) batchMemo.delete(signature);
      }, BATCH_MEMO_MS + 100);
    });

  batchMemo.set(signature, { at: now, promise });
  if (batchMemo.size > 30) {
    [...batchMemo.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, 10)
      .forEach(([key]) => batchMemo.delete(key));
  }
  return promise;
}

// Resolves which items exist in the backend source catalogue. Fail-open: if the
// catalogue is unavailable the original list is returned untouched. Requests
// for the same visible group are shared across Home rows/Detail/hover consumers.
export async function filterAvailableAsync(items, getType = (item) => item.media_type || item.type || "movie") {
  if (!items?.length) return [];
  const unknown = normalizedUnknown(items, getType);
  if (unknown.length) {
    try {
      const data = await availabilityBatch(unknown);
      if (!data?.catalog_loaded) return items;
      const ok = new Set((data.available || []).map((item) => keyOf(item.type, item.id)));
      unknown.forEach((item) => cache.set(keyOf(item.type, item.id), ok.has(keyOf(item.type, item.id))));
    } catch {
      return items;
    }
  }
  return items.filter((item) => cache.get(keyOf(getType(item), item.id ?? item.tmdbId ?? item.tmdb_id)) !== false);
}

export function useAvailableItems(items, mediaType?: string) {
  const [filtered, setFiltered] = useState(items || []);
  const signature = useMemo(
    () => (items || []).map((item) => `${item?.media_type || item?.type || mediaType || "movie"}:${item?.id ?? item?.tmdbId ?? item?.tmdb_id ?? 0}`).join("|"),
    [items, mediaType]
  );

  useEffect(() => {
    let alive = true;
    // Keep existing items visible while the availability filter resolves rather
    // than flashing an empty row on every navigation.
    if (Array.isArray(items)) setFiltered((current) => current?.length ? current : items);
    filterAvailableAsync(items || [], (item) => item.media_type || item.type || mediaType || "movie")
      .then((result) => alive && setFiltered(result));
    return () => { alive = false; };
  }, [signature, mediaType]);

  return filtered;
}
