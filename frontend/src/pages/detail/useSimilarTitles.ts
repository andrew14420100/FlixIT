// @ts-nocheck
import { useEffect, useState } from "react";
import { useLazyGetSimilarVideosQuery, useLazyGetVideosByMediaTypeAndGenreIdQuery } from "src/store/slices/discover";
import { filterAvailableAsync } from "src/hooks/useAvailability";
import { artUrl } from "./detailUtils";

const MAX_CANDIDATES = 40;
const MAX_RESULTS = 6;
const MIN_AVAILABLE = 6;

export default function useSimilarTitles(type, typeSlug, mediaId, genreId, enabled) {
  const [getSimilar] = useLazyGetSimilarVideosQuery();
  const [getGenrePage] = useLazyGetVideosByMediaTypeAndGenreIdQuery();
  const [state, setState] = useState({ items: [], loading: true });

  useEffect(() => {
    setState({ items: [], loading: true });
    if (!mediaId || !enabled) return undefined;
    let cancelled = false;

    const dedupe = (pool) => {
      const seen = new Set([mediaId]);
      return pool
        .filter((item) => {
          const id = Number(item?.id || 0);
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((item) => ({ ...item, media_type: typeSlug }))
        .slice(0, MAX_CANDIDATES);
    };

    const run = async () => {
      const similar = await getSimilar({ mediaType: type, id: mediaId }, true).unwrap().catch(() => null);
      let pool = (similar?.results || []).slice();
      let available = await filterAvailableAsync(dedupe(pool), () => typeSlug).catch(() => []);
      if (cancelled) return;

      for (let page = 1; page <= 2 && available.length < MIN_AVAILABLE && genreId; page += 1) {
        const genrePage = await getGenrePage({ mediaType: type, genreId, page }, true).unwrap().catch(() => null);
        if (cancelled) return;
        pool = pool.concat(genrePage?.results || []);
        available = await filterAvailableAsync(dedupe(pool), () => typeSlug).catch(() => available);
        if (cancelled) return;
      }
      if (!available.length) { setState({ items: [], loading: false }); return; }

      let artwork = [];
      try {
        const response = await fetch("/api/public/official-artwork/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ items: available.map((item) => ({ tmdbId: item.id, type: typeSlug })) }),
        });
        artwork = response.ok ? (await response.json())?.items || [] : [];
      } catch {}
      if (cancelled) return;

      const artById = new Map(artwork.map((entry) => [Number(entry?.tmdbId), entry]));
      const items = available
        .map((item) => {
          const art = artById.get(Number(item.id)) || {};
          const poster = artUrl(art.poster_url);
          const backdrop = artUrl(art.backdrop_url, art.hero_backdrop_url);
          return {
            id: Number(item.id),
            type: typeSlug,
            title: art.title || item.title || item.name || "",
            year: String(art.year || item.release_date || item.first_air_date || "").slice(0, 4),
            image: poster || backdrop,
            embeddedTitle: poster ? !!art.poster_embedded_title_treatment : !!art.backdrop_embedded_title_treatment,
          };
        })
        .filter((item) => item.image)
        .slice(0, MAX_RESULTS);
      setState({ items, loading: false });
    };

    const timer = window.setTimeout(run, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, genreId, getGenrePage, getSimilar, mediaId, type, typeSlug]);

  return state;
}
