// @ts-nocheck
/**
 * FlixIT Detail Page v2 - "Titoli simili" (real catalogue data).
 * TMDB similar -> availability filter (vixsrc catalogue) -> genre fallback
 * -> official artwork batch -> per-title metadata (seasons/certification).
 * Runs in idle time so it never competes with hero/detail loading.
 */
import { useEffect, useState } from "react";
import { useLazyGetSimilarVideosQuery } from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import { API_ENDPOINT_URL, TMDB_V3_API_KEY } from "src/constant";
import { filterAvailableAsync } from "src/hooks/useAvailability";
import { API_URL, artUrl, formatCertification, genreNameFromIds } from "./detailUtils";

const MAX_CANDIDATES = 40;
const MAX_RESULTS = 5;
const MIN_AVAILABLE = 5;

async function fetchGenrePage(typeSlug, genreId, page, signal) {
  try {
    const params = new URLSearchParams({
      api_key: TMDB_V3_API_KEY,
      with_genres: String(genreId),
      page: String(page),
      language: "it-IT",
      sort_by: "popularity.desc",
    });
    const response = await fetch(`${API_ENDPOINT_URL}/discover/${typeSlug}?${params}`, { signal });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function fetchArtworkBatch(items, typeSlug, signal) {
  try {
    const response = await fetch(`${API_URL}/api/public/official-artwork/batch`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: items.map((item) => ({ tmdbId: item.id, type: typeSlug })) }),
    });
    return response.ok ? (await response.json())?.items || [] : [];
  } catch {
    return [];
  }
}

async function fetchMediaAssets(typeSlug, id, signal) {
  try {
    const response = await fetch(`${API_URL}/api/public/media-assets/${typeSlug}/${id}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

export default function useSimilarTitles({ typeSlug, mediaId, genreId, enabled }) {
  const [getSimilar] = useLazyGetSimilarVideosQuery();
  const [state, setState] = useState({ items: [], loading: true });

  useEffect(() => {
    setState({ items: [], loading: true });
    if (!mediaId || !enabled) return undefined;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;
    const type = typeSlug === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;

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
      if (cancelled) return;
      let pool = (similar?.results || []).slice();
      let available = await filterAvailableAsync(dedupe(pool), () => typeSlug).catch(() => []);
      if (cancelled) return;

      for (let page = 1; page <= 2 && available.length < MIN_AVAILABLE && genreId; page += 1) {
        const genrePage = await fetchGenrePage(typeSlug, genreId, page, signal);
        if (cancelled) return;
        pool = pool.concat(genrePage?.results || []);
        available = await filterAvailableAsync(dedupe(pool), () => typeSlug).catch(() => available);
        if (cancelled) return;
      }
      if (!available.length) {
        setState({ items: [], loading: false });
        return;
      }

      const shortlist = available.slice(0, MAX_RESULTS * 2);
      const artwork = await fetchArtworkBatch(shortlist, typeSlug, signal);
      if (cancelled) return;
      const artById = new Map(artwork.map((entry) => [Number(entry?.tmdbId), entry]));

      const withArt = shortlist
        .map((item) => {
          const art = artById.get(Number(item.id)) || {};
          const backdrop = artUrl(art.backdrop_url, art.hero_backdrop_url, art.detail_backdrop_url);
          const poster = artUrl(art.poster_url);
          const image = backdrop || poster;
          if (!image) return null;

          // Keep the exact artwork payload used by Home cards. VideoItemWithHover
          // can therefore render the same static card, poster/mobile variant,
          // hover expansion, logo and trailer behaviour without a second visual
          // implementation for the detail page.
          const embeddedArtwork = {
            ...art,
            active: true,
            tmdbId: Number(item.id),
            type: typeSlug,
            backdrop_url: backdrop || art.backdrop_url || null,
            poster_url: poster || art.poster_url || null,
          };

          return {
            ...item,
            id: Number(item.id),
            tmdbId: Number(item.id),
            tmdb_id: Number(item.id),
            type: typeSlug,
            media_type: typeSlug,
            title: art.title || item.title || item.name || "",
            name: art.title || item.name || item.title || "",
            release_date: item.release_date || "",
            first_air_date: item.first_air_date || "",
            genre_ids: item.genre_ids || [],
            year: String(art.year || item.release_date || item.first_air_date || "").slice(0, 4),
            genre: genreNameFromIds(item.genre_ids, typeSlug),
            image,
            backdrop_path: backdrop || null,
            poster_path: poster || null,
            embeddedTitle: backdrop ? !!art.backdrop_embedded_title_treatment : !!art.poster_embedded_title_treatment,
            __artwork: embeddedArtwork,
            seasons: 0,
            certification: "",
          };
        })
        .filter(Boolean)
        .slice(0, MAX_RESULTS);

      if (!withArt.length) {
        setState({ items: [], loading: false });
        return;
      }

      // Show cards immediately, then enrich metadata in the background.
      setState({ items: withArt, loading: false });
      const metas = await Promise.all(withArt.map((item) => fetchMediaAssets(typeSlug, item.id, signal)));
      if (cancelled) return;
      setState({
        items: withArt.map((item, index) => ({
          ...item,
          seasons: Number(metas[index]?.number_of_seasons || 0),
          certification: formatCertification(metas[index]?.certification),
          genre: item.genre || genreNameFromIds(metas[index]?.genre_ids, typeSlug),
        })),
        loading: false,
      });
    };

    let idleId = null;
    let timer = 0;
    const start = () => { run().catch(() => { if (!cancelled) setState({ items: [], loading: false }); }); };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(start, { timeout: 2500 });
    } else {
      timer = window.setTimeout(start, 600);
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
      if (idleId != null && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
    };
  }, [enabled, genreId, getSimilar, mediaId, typeSlug]);

  return state;
}
