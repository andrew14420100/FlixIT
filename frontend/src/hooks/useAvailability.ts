// @ts-nocheck
import { useEffect, useState } from "react";

const cache = new Map<string, boolean>();
const keyOf = (type, id) => `${type === "tv" ? "tv" : "movie"}-${id}`;

// Resolves which items exist on vixsrc (backend catalog). Fail-open: if the catalog is
// unavailable the original list is returned untouched.
export async function filterAvailableAsync(items, getType = (i) => i.media_type || i.type || "movie") {
  if (!items?.length) return [];
  const unknown = items
    .map((i) => ({ type: getType(i) === "tv" ? "tv" : "movie", id: i.id ?? i.tmdbId }))
    .filter((x) => x.id && !cache.has(keyOf(x.type, x.id)));
  if (unknown.length) {
    try {
      const res = await fetch("/api/public/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: unknown }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.catalog_loaded) return items;
      const ok = new Set(data.available.map((a) => keyOf(a.type, a.id)));
      unknown.forEach((u) => cache.set(keyOf(u.type, u.id), ok.has(keyOf(u.type, u.id))));
    } catch {
      return items;
    }
  }
  return items.filter((i) => cache.get(keyOf(getType(i), i.id ?? i.tmdbId)) !== false);
}

export function useAvailableItems(items, mediaType?: string) {
  const [filtered, setFiltered] = useState(items || []);
  useEffect(() => {
    let alive = true;
    filterAvailableAsync(items || [], (i) => i.media_type || i.type || mediaType || "movie")
      .then((r) => alive && setFiltered(r));
    return () => { alive = false; };
  }, [items, mediaType]);
  return filtered;
}
