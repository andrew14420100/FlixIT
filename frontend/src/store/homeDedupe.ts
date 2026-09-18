// @ts-nocheck
import { create } from "zustand";

// Page-level dedupe registry. Rows with a lower index are visually above rows
// with a higher index. Every row publishes the exact titles it actually renders
// so the rows below can remove those titles before painting.
export const useHomeDedupe = create((set) => ({
  rows: {},
  claim: (key, index, ids) =>
    set((s) => {
      const cleanIds = [...new Set((ids || []).filter(Boolean))];
      const prev = s.rows[key];
      if (
        prev &&
        prev.index === index &&
        prev.ids.length === cleanIds.length &&
        prev.ids.every((value, i) => value === cleanIds[i])
      ) {
        return s;
      }
      return { rows: { ...s.rows, [key]: { index, ids: cleanIds } } };
    }),
  release: (key) =>
    set((s) => {
      if (!s.rows[key]) return s;
      const rows = { ...s.rows };
      delete rows[key];
      return { rows };
    }),
  // Mounted rows clean themselves up on unmount. A global reset while child
  // effects are claiming rows can erase valid claims and briefly reintroduce
  // duplicates, so reset is intentionally non-destructive.
  reset: () => {},
}));

export const itemKey = (item) => {
  if (!item) return "";
  const id = item.tmdbId || item.tmdb_id || item.media_id || item.id;
  if (id === undefined || id === null || id === "") return "";

  const rawType =
    item.type || item.media_type || item.mediaType || item.media_type_slug || "movie";
  const type = String(rawType).toLowerCase().includes("tv") ? "tv" : "movie";
  return `${type}-${id}`;
};

export function claimedAbove(rows, index, excludeKey = null) {
  const claimed = new Set();
  Object.entries(rows || {}).forEach(([key, row]) => {
    if (key === excludeKey) return;
    if (row?.index < index) {
      (row.ids || []).forEach((id) => claimed.add(id));
    }
  });
  return claimed;
}

function artworkValue(...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string") return value;
    if (typeof value?.url === "string") return value.url;
  }
  return null;
}

function normalizeArtwork(item) {
  if (!item) return item;
  if (item.backdrop_path || item.poster_path) return item;

  const landscape = artworkValue(
    item.titled_backdrop_path,
    item.titledBackdropPath,
    item.netflix_artwork_url,
    item.netflixArtworkUrl,
    item.netflix_cover_url,
    item.contextualArtwork?.artwork,
    item.artwork,
    item.image,
    item.cover_path,
    item.cover,
    item.image_url,
    item.thumbnail_url
  );
  const poster = artworkValue(
    item.netflix_ranked_artwork_url,
    item.netflixRankedArtworkUrl,
    item.poster,
    item.netflix_cover_url,
    item.cover_path,
    item.cover,
    item.image,
    item.artwork
  );

  if (!landscape && !poster) return item;
  return {
    ...item,
    backdrop_path: landscape || poster || null,
    poster_path: poster || landscape || null,
  };
}

export function uniqueItems(items) {
  const seen = new Set();
  return (items || [])
    .map(normalizeArtwork)
    .filter((item) => {
      const key = itemKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
