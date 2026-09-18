// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import HomepageSlider from "./HomepageSlider";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import {
  useLazyGetAppendedVideosQuery,
  useLazyGetSimilarVideosQuery,
  useLazyGetVideosByMediaTypeAndGenreIdQuery,
} from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import { useHomeDedupe, itemKey } from "src/store/homeDedupe";

// Clean-room adaptation of the useful ideas from
// IAmParadox27/jellyfin-plugin-home-sections for FLIX-IT's React/TMDB stack.
// No Jellyfin runtime code is imported: the original project is a C# Jellyfin plugin.
const SMART_REFRESH_MS = 10 * 60 * 1000;
const MAX_SMART_ITEMS = 24;

const toMediaType = (type) =>
  type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;

const toSlug = (type) => (type === MEDIA_TYPE.Tv ? "tv" : "movie");

const normalizeTmdbItems = (results, type) =>
  (results || [])
    .filter((item) => item && (item.backdrop_path || item.poster_path))
    .map((item) => ({
      ...item,
      id: item.id || item.tmdbId,
      tmdbId: item.id || item.tmdbId,
      type: item.media_type || type,
      media_type: item.media_type || type,
      title: item.title || item.name,
      name: item.name || item.title,
      genre_ids: item.genre_ids || [],
    }))
    .slice(0, MAX_SMART_ITEMS);

function buildWatchAgainItems(items) {
  return (items || [])
    .filter(
      (item) =>
        item?.duration > 0 &&
        item?.progress > 0 &&
        item.progress / item.duration >= 0.9
    )
    .map((item) => ({
      id: item.tmdb_id,
      tmdbId: item.tmdb_id,
      type: item.media_type,
      media_type: item.media_type,
      title: item.title,
      name: item.title,
      backdrop_path: item.backdrop_path,
      poster_path: item.poster_path,
      genre_ids: item.genre_ids || [],
    }))
    .filter((item) => item.backdrop_path || item.poster_path)
    .slice(0, MAX_SMART_ITEMS);
}

function chooseWeightedGenre(details, preferredType) {
  const scores = new Map();

  details.forEach(({ detail, index, mediaType }) => {
    if (!detail || mediaType !== preferredType) return;
    const weight = Math.max(1, 6 - index);
    (detail.genres || []).forEach((genre) => {
      if (!genre?.id) return;
      const current = scores.get(genre.id) || {
        id: genre.id,
        name: genre.name || "",
        score: 0,
      };
      current.score += weight;
      if (!current.name && genre.name) current.name = genre.name;
      scores.set(genre.id, current);
    });
  });

  return [...scores.values()].sort((a, b) => b.score - a.score)[0] || null;
}

export default function HomeSmartSections() {
  const { items: historyItems, refresh: refreshHistory } = useContinueWatching();
  const [loadSimilar] = useLazyGetSimilarVideosQuery();
  const [loadDetails] = useLazyGetAppendedVideosQuery();
  const [loadGenre] = useLazyGetVideosByMediaTypeAndGenreIdQuery();

  const [becauseItems, setBecauseItems] = useState([]);
  const [becauseTitle, setBecauseTitle] = useState("");
  const [genreItems, setGenreItems] = useState([]);
  const [genreTitle, setGenreTitle] = useState("");

  const claim = useHomeDedupe((state) => state.claim);
  const release = useHomeDedupe((state) => state.release);

  const usableHistory = useMemo(
    () =>
      (historyItems || [])
        .filter((item) => item?.tmdb_id && item?.media_type)
        .slice(0, 8),
    [historyItems]
  );

  const watchAgainItems = useMemo(
    () => buildWatchAgainItems(historyItems),
    [historyItems]
  );

  const historyKey = useMemo(
    () =>
      usableHistory
        .map(
          (item) =>
            `${item.media_type}:${item.tmdb_id}:${Math.round(
              Number(item.progress || 0)
            )}`
        )
        .join("|"),
    [usableHistory]
  );

  const refreshSmartRows = useCallback(async () => {
    if (!usableHistory.length) {
      setBecauseItems([]);
      setBecauseTitle("");
      setGenreItems([]);
      setGenreTitle("");
      return;
    }

    const source = usableHistory[0];
    const sourceMediaType = toMediaType(source.media_type);
    const sourceSlug = toSlug(sourceMediaType);

    try {
      const similar = await loadSimilar(
        { mediaType: sourceMediaType, id: source.tmdb_id },
        false
      ).unwrap();

      const normalized = normalizeTmdbItems(similar?.results, sourceSlug).filter(
        (item) => Number(item.id) !== Number(source.tmdb_id)
      );

      setBecauseItems(normalized);
      setBecauseTitle(
        normalized.length && source.title
          ? `Perché hai guardato ${source.title}`
          : ""
      );
    } catch {
      setBecauseItems([]);
      setBecauseTitle("");
    }

    try {
      const detailResults = await Promise.all(
        usableHistory.slice(0, 5).map(async (entry, index) => {
          const mediaType = toMediaType(entry.media_type);
          try {
            const detail = await loadDetails(
              { mediaType, id: entry.tmdb_id },
              false
            ).unwrap();
            return { detail, index, mediaType };
          } catch {
            return { detail: null, index, mediaType };
          }
        })
      );

      const weightedGenre = chooseWeightedGenre(detailResults, sourceMediaType);
      if (!weightedGenre?.id) {
        setGenreItems([]);
        setGenreTitle("");
        return;
      }

      const genreResult = await loadGenre(
        {
          mediaType: sourceMediaType,
          genreId: weightedGenre.id,
          page: 1,
        },
        false
      ).unwrap();

      const normalizedGenre = normalizeTmdbItems(
        genreResult?.results,
        sourceSlug
      ).filter(
        (item) =>
          !usableHistory.some(
            (history) => Number(history.tmdb_id) === Number(item.id)
          )
      );

      setGenreItems(normalizedGenre);
      setGenreTitle(
        normalizedGenre.length
          ? `${sourceSlug === "tv" ? "Serie" : "Film"} ${weightedGenre.name}`
          : ""
      );
    } catch {
      setGenreItems([]);
      setGenreTitle("");
    }
  }, [usableHistory, loadSimilar, loadDetails, loadGenre]);

  useEffect(() => {
    refreshSmartRows();
  }, [historyKey, refreshSmartRows]);

  useEffect(() => {
    const refreshAll = () => {
      refreshHistory?.();
      refreshSmartRows();
    };

    const timer = window.setInterval(refreshAll, SMART_REFRESH_MS);
    window.addEventListener("focus", refreshAll);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshAll);
    };
  }, [refreshHistory, refreshSmartRows]);

  useEffect(() => {
    const ids = becauseItems.map(itemKey).filter(Boolean);
    if (ids.length) claim("smart-because-watched", -30, ids);
    return () => release("smart-because-watched");
  }, [becauseItems, claim, release]);

  useEffect(() => {
    const ids = watchAgainItems.map(itemKey).filter(Boolean);
    if (ids.length) claim("smart-watch-again", -20, ids);
    return () => release("smart-watch-again");
  }, [watchAgainItems, claim, release]);

  useEffect(() => {
    const ids = genreItems.map(itemKey).filter(Boolean);
    if (ids.length) claim("smart-genre", -10, ids);
    return () => release("smart-genre");
  }, [genreItems, claim, release]);

  return (
    <>
      {becauseTitle && becauseItems.length > 0 && (
        <HomepageSlider title={becauseTitle} items={becauseItems} />
      )}

      {watchAgainItems.length > 0 && (
        <HomepageSlider title="Guarda di nuovo" items={watchAgainItems} />
      )}

      {genreTitle && genreItems.length > 0 && (
        <HomepageSlider title={genreTitle} items={genreItems} />
      )}
    </>
  );
}
