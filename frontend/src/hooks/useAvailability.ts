// @ts-nocheck
import { useEffect, useMemo, useState } from "react";

const keyOf = (type, id) => `${type === "tv" ? "tv" : "movie"}-${id}`;
const BATCH_MEMO_MS = 10 * 1000;
const POSITIVE_TTL_MS = 2 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 90 * 1000;
const AUTO_REFRESH_MS = 90 * 1000;
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

// Strict Italian/playability policy: unknown/unverified items stay hidden until
// the backend confirms both Italian-catalog membership and current provider
// reachability. Transient upstream failures remain unknown instead of being
// cached as a real "unavailable" result.
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
      const strictLivePolicy = String(data?.policy || "") === "streamportal-live-v1";
      const now = Date.now();
      unknown.forEach((item) => {
        const key = keyOf(item.type, item.id);
        if (ok.has(key)) {
          cache.set(key, { available: true, at: now });
          return;
        }
        // New backend distinguishes a confirmed negative from a temporary
        // timeout/outage. Older backends did not, so preserve their behavior.
        if (!strictLivePolicy || explicitlyUnavailable.has(key)) {
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
    setFiltered([]);

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
