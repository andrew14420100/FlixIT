// @ts-nocheck
import { useEffect, useMemo, useState } from "react";

const keyOf = (type, id) => `${type === "tv" ? "tv" : "movie"}-${id}`;
const BATCH_MEMO_MS = 60 * 1000;
const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const AUTO_REFRESH_MS = 15 * 60 * 1000;
const cache = new Map<string, { available: boolean; at: number }>();
const batchMemo = new Map<string, { at: number; promise: Promise<any> }>();

function cacheValue(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  const ttl = hit.available ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return undefined;
  }
  return hit.available;
}

function normalizedUnknown(items, getType) {
  const seen = new Set<string>();
  const out = [];
  for (const item of items || []) {
    const type = getType(item) === "tv" ? "tv" : "movie";
    const id = Number(item?.id ?? item?.tmdbId ?? item?.tmdb_id ?? 0);
    if (!id) continue;
    const key = keyOf(type, id);
    if (cacheValue(key) !== undefined || seen.has(key)) continue;
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

// Rendering is intentionally cheap: the backend batch endpoint reads the
// cached VixSrc lang=it catalogue and never performs one live upstream probe per
// card. Strict per-episode Italian audio checks remain on the TV detail/season
// path, so English/original-only episodes stay hidden without slowing the home.
export async function filterAvailableAsync(items, getType = (item) => item.media_type || item.type || "movie") {
  if (!items?.length) return [];
  const unknown = normalizedUnknown(items, getType);
  if (unknown.length) {
    try {
      const data = await availabilityBatch(unknown);
      if (!data?.catalog_loaded) return [];
      const ok = new Set((data.available || []).map((item) => keyOf(item.type, item.id)));
      const explicitlyUnavailable = new Set(
        (data.unavailable || []).map((item) => keyOf(item.type, item.id))
      );
      const now = Date.now();
      unknown.forEach((item) => {
        const key = keyOf(item.type, item.id);
        if (ok.has(key)) {
          cache.set(key, { available: true, at: now });
        } else if (explicitlyUnavailable.has(key)) {
          cache.set(key, { available: false, at: now });
        }
      });
    } catch {
      return [];
    }
  }
  return items.filter((item) => {
    const id = Number(item?.id ?? item?.tmdbId ?? item?.tmdb_id ?? 0);
    const type = getType(item) === "tv" ? "tv" : "movie";
    return !!id && cacheValue(keyOf(type, id)) === true;
  });
}

export function useAvailableItems(items, mediaType?: string) {
  const [filtered, setFiltered] = useState([]);
  const signature = useMemo(
    () => (items || []).map((item) => `${item?.media_type || item?.type || mediaType || "movie"}:${item?.id ?? item?.tmdbId ?? item?.tmdb_id ?? 0}`).join("|"),
    [items, mediaType]
  );

  useEffect(() => {
    let alive = true;
    let running = false;

    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const result = await filterAvailableAsync(items || [], (item) => item.media_type || item.type || mediaType || "movie");
        if (alive) setFiltered(result);
      } finally {
        running = false;
      }
    };

    refresh();
    const timer = window.setInterval(refresh, AUTO_REFRESH_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [signature, mediaType]);

  return filtered;
}
