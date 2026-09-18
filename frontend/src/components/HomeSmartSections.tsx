// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomepageSlider from "./HomepageSlider";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { useLazyGetAppendedVideosQuery } from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import { useHomeDedupe, itemKey } from "src/store/homeDedupe";

// FLIX-IT adaptation of the behavioural ideas from
// IAmParadox27/jellyfin-plugin-home-sections.
// The upstream project is a C# Jellyfin plugin, so its runtime cannot be
// imported into this React app. We reproduce the section/card-selection logic
// against FLIX-IT/TMDB data and keep it live.
const SMART_REFRESH_MS = 5 * 60 * 1000;
const MAX_SMART_ITEMS = 24;
const RECENT_DAYS = 14;
const WATCH_AGAIN_DAYS = 28;
const LIKED_GENRE_WEIGHT = 125;
const RECENT_GENRE_WEIGHT = 50;
const PLAY_GENRE_WEIGHT = 1;

const API_PREFIX = "/api";

const toMediaType = (type) =>
  type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;

const toSlug = (type) => (type === MEDIA_TYPE.Tv ? "tv" : "movie");

const normalizeItems = (results, fallbackType) => {
  const seen = new Set();
  return (results || [])
    .map((item) => {
      const id = item?.id || item?.tmdbId || item?.tmdb_id || item?.media_id;
      const type = item?.type || item?.media_type || fallbackType || "movie";
      return {
        ...item,
        id,
        tmdbId: id,
        type,
        media_type: type,
        title: item?.title || item?.name || "",
        name: item?.name || item?.title || "",
        backdrop_path: item?.backdrop_path,
        poster_path: item?.poster_path,
        genre_ids: item?.genre_ids || [],
      };
    })
    .filter((item) => {
      if (!item.id || !(item.backdrop_path || item.poster_path)) return false;
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SMART_ITEMS);
};

function daysSince(dateValue) {
  if (!dateValue) return Number.POSITIVE_INFINITY;
  const value = new Date(dateValue).getTime();
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - value) / 86400000);
}

async function fetchJson(url, fallback = null) {
  try {
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}_flix=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

async function fetchAvailableGenre(genreId, mediaType) {
  if (!genreId) return [];
  const slug = toSlug(mediaType);
  const data = await fetchJson(
    `${API_PREFIX}/public/tmdb/genre/${genreId}/${slug}`,
    { items: [] }
  );
  return normalizeItems(data?.items || [], slug);
}

function chooseFreshSource(history, cycle) {
  const candidates = (history || []).slice(0, 15);
  if (!candidates.length) return null;
  // The Jellyfin plugin picks a recent watched source freshly each load. We
  // rotate deterministically every refresh so the row changes without jumping
  // on every React render.
  return candidates[Math.abs(cycle) % candidates.length];
}

function buildWatchAgainItems(items) {
  return normalizeItems(
    (items || []).filter((item) => {
      const duration = Number(item?.duration || 0);
      const progress = Number(item?.progress || 0);
      if (!duration || progress / duration < 0.9) return false;
      // Upstream uses a 28-day cutoff. If legacy FLIX-IT progress entries have
      // no timestamp we keep them eligible instead of silently dropping them.
      return !item?.updated_at || daysSince(item.updated_at) >= WATCH_AGAIN_DAYS;
    }),
    "movie"
  );
}

function weightedPick(entries, cycle) {
  const valid = (entries || []).filter((entry) => entry.score > 0);
  if (!valid.length) return null;
  const total = valid.reduce((sum, entry) => sum + entry.score, 0);
  // Stable pseudo-random value per refresh cycle; avoids layout flicker while
  // still reproducing weighted-random genre selection.
  let cursor = ((cycle * 9301 + 49297) % 233280) / 233280 * total;
  for (const entry of valid) {
    cursor -= entry.score;
    if (cursor <= 0) return entry;
  }
  return valid[valid.length - 1];
}

function buildGenreScores(detailRows, likedKeys) {
  const scores = new Map();

  detailRows.forEach(({ detail, history, mediaType }) => {
    if (!detail) return;
    const key = `${toSlug(mediaType)}:${history.tmdb_id}`;
    const isLiked = likedKeys.has(key);
    const isRecent = daysSince(history.updated_at) <= RECENT_DAYS;
    const completion = Number(history.duration || 0) > 0
      ? Math.min(1, Number(history.progress || 0) / Number(history.duration || 1))
      : 0;

    const weight =
      PLAY_GENRE_WEIGHT +
      (isRecent ? RECENT_GENRE_WEIGHT : 0) +
      (isLiked ? LIKED_GENRE_WEIGHT : 0) +
      Math.round(completion * 10);

    (detail.genres || []).forEach((genre) => {
      if (!genre?.id) return;
      const current = scores.get(genre.id) || {
        id: genre.id,
        name: genre.name || "",
        score: 0,
        mediaType,
      };
      current.score += weight;
      if (!current.name && genre.name) current.name = genre.name;
      scores.set(genre.id, current);
    });
  });

  return [...scores.values()].sort((a, b) => b.score - a.score);
}

export default function HomeSmartSections() {
  const { items: historyItems, refresh: refreshHistory } = useContinueWatching();
  const [loadDetails] = useLazyGetAppendedVideosQuery();
  const [cycle, setCycle] = useState(0);
  const requestId = useRef(0);

  const [becauseItems, setBecauseItems] = useState([]);
  const [becauseTitle, setBecauseTitle] = useState("");
  const [genreItems, setGenreItems] = useState([]);
  const [genreTitle, setGenreTitle] = useState("");
  const [myListItems, setMyListItems] = useState([]);

  const claim = useHomeDedupe((state) => state.claim);
  const release = useHomeDedupe((state) => state.release);

  const usableHistory = useMemo(
    () =>
      (historyItems || [])
        .filter((item) => item?.tmdb_id && item?.media_type)
        .slice(0, 15),
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
            )}:${item.updated_at || ""}`
        )
        .join("|"),
    [usableHistory]
  );

  const refreshSmartRows = useCallback(async () => {
    const currentRequest = ++requestId.current;
    const userId = localStorage.getItem("netflix_user_id") || "";

    const [listData, likesData] = await Promise.all([
      userId
        ? fetchJson(`${API_PREFIX}/user/list/${encodeURIComponent(userId)}`, { items: [] })
        : Promise.resolve({ items: [] }),
      userId
        ? fetchJson(`${API_PREFIX}/user/likes/${encodeURIComponent(userId)}`, { items: [] })
        : Promise.resolve({ items: [] }),
    ]);

    if (currentRequest !== requestId.current) return;

    setMyListItems(normalizeItems(listData?.items || [], "movie"));

    if (!usableHistory.length) {
      setBecauseItems([]);
      setBecauseTitle("");
      setGenreItems([]);
      setGenreTitle("");
      return;
    }

    const likedKeys = new Set(
      (likesData?.items || []).map(
        (item) => `${item.media_type || "movie"}:${item.media_id || item.tmdb_id}`
      )
    );

    const detailRows = await Promise.all(
      usableHistory.slice(0, 8).map(async (history) => {
        const mediaType = toMediaType(history.media_type);
        try {
          const detail = await loadDetails(
            { mediaType, id: history.tmdb_id },
            false
          ).unwrap();
          return { detail, history, mediaType };
        } catch {
          return { detail: null, history, mediaType };
        }
      })
    );

    if (currentRequest !== requestId.current) return;

    // Because You Watched: choose one of the 15 most recently watched titles
    // freshly each cycle and build a row from its strongest genres, excluding
    // items already watched. This keeps FLIX-IT availability filtering in the
    // loop instead of exposing arbitrary TMDB-only results.
    const source = chooseFreshSource(usableHistory, cycle);
    const sourceRow = detailRows.find(
      (row) => Number(row.history.tmdb_id) === Number(source?.tmdb_id)
    );

    if (source && sourceRow?.detail) {
      const sourceGenres = (sourceRow.detail.genres || []).slice(0, 2);
      const pools = await Promise.all(
        sourceGenres.map((genre) => fetchAvailableGenre(genre.id, sourceRow.mediaType))
      );
      const watched = new Set(
        usableHistory.map((item) => `${item.media_type}:${item.tmdb_id}`)
      );
      const merged = normalizeItems(
        pools.flat().filter(
          (item) =>
            Number(item.id) !== Number(source.tmdb_id) &&
            !watched.has(`${item.type}:${item.id}`)
        ),
        toSlug(sourceRow.mediaType)
      );
      setBecauseItems(merged.slice(0, 16));
      setBecauseTitle(
        merged.length && source.title ? `Perché hai guardato ${source.title}` : ""
      );
    } else {
      setBecauseItems([]);
      setBecauseTitle("");
    }

    const rankedGenres = buildGenreScores(detailRows, likedKeys);
    const selectedGenre = weightedPick(rankedGenres, cycle + 1);
    if (selectedGenre?.id) {
      const pool = await fetchAvailableGenre(selectedGenre.id, selectedGenre.mediaType);
      const watchedIds = new Set(usableHistory.map((item) => Number(item.tmdb_id)));
      const clean = pool.filter((item) => !watchedIds.has(Number(item.id))).slice(0, 16);
      setGenreItems(clean);
      setGenreTitle(
        clean.length
          ? `${toSlug(selectedGenre.mediaType) === "tv" ? "Serie" : "Film"} ${selectedGenre.name}`
          : ""
      );
    } else {
      setGenreItems([]);
      setGenreTitle("");
    }
  }, [usableHistory, loadDetails, cycle]);

  useEffect(() => {
    refreshSmartRows();
  }, [historyKey, refreshSmartRows]);

  useEffect(() => {
    const refreshAll = async () => {
      await refreshHistory?.();
      setCycle((value) => value + 1);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshAll();
    };

    const timer = window.setInterval(refreshAll, SMART_REFRESH_MS);
    window.addEventListener("focus", refreshAll);
    window.addEventListener("online", refreshAll);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshAll);
      window.removeEventListener("online", refreshAll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshHistory]);

  useEffect(() => {
    const ids = becauseItems.map(itemKey).filter(Boolean);
    if (ids.length) claim("smart-because-watched", -40, ids);
    return () => release("smart-because-watched");
  }, [becauseItems, claim, release]);

  useEffect(() => {
    const ids = watchAgainItems.map(itemKey).filter(Boolean);
    if (ids.length) claim("smart-watch-again", -30, ids);
    return () => release("smart-watch-again");
  }, [watchAgainItems, claim, release]);

  useEffect(() => {
    const ids = myListItems.map(itemKey).filter(Boolean);
    if (ids.length) claim("smart-my-list", -20, ids);
    return () => release("smart-my-list");
  }, [myListItems, claim, release]);

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

      {myListItems.length > 0 && (
        <HomepageSlider title="La mia lista" items={myListItems} />
      )}

      {genreTitle && genreItems.length > 0 && (
        <HomepageSlider title={genreTitle} items={genreItems} />
      )}
    </>
  );
}
