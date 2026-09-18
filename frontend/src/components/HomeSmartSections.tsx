// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomepageSlider from "./HomepageSlider";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { useLazyGetAppendedVideosQuery } from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import { useHomeDedupe, itemKey, claimedAbove, uniqueItems } from "src/store/homeDedupe";

// FLIX-IT adaptation of the behavioural ideas from
// IAmParadox27/jellyfin-plugin-home-sections.
// Recommendations are stable during the day: a fresh catalogue snapshot is
// calculated once every 24 hours and persisted so reloads paint immediately.
const SMART_REFRESH_MS = 24 * 60 * 60 * 1000;
const SMART_CACHE_PREFIX = "flix-home-smart-v4";
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
      const key = itemKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SMART_ITEMS);
};

function releaseTime(item) {
  const value =
    item?.release_date ||
    item?.first_air_date ||
    item?.available_at ||
    item?.created_at ||
    "";
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function newestFirst(items) {
  return [...(items || [])].sort((a, b) => releaseTime(b) - releaseTime(a));
}

function daysSince(dateValue) {
  if (!dateValue) return Number.POSITIVE_INFINITY;
  const value = new Date(dateValue).getTime();
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - value) / 86400000);
}

function getSmartCacheKey() {
  if (typeof window === "undefined") return `${SMART_CACHE_PREFIX}:guest`;
  const userId = window.localStorage.getItem("netflix_user_id") || "guest";
  return `${SMART_CACHE_PREFIX}:${userId}`;
}

function readSmartCache(key) {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
    if (!parsed || !parsed.savedAt || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSmartCache(key, data) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ savedAt: Date.now(), data })
    );
  } catch {
    // Recommendation cache is an optimization only.
  }
}

async function fetchJson(url, fallback = null) {
  try {
    const separator = url.includes("?") ? "&" : "?";
    const dailyVersion = Math.floor(Date.now() / SMART_REFRESH_MS);
    const response = await fetch(`${url}${separator}_flix_day=${dailyVersion}`, {
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
  return newestFirst(normalizeItems(data?.items || [], slug));
}

function buildWatchAgainItems(items) {
  return normalizeItems(
    (items || []).filter((item) => {
      const duration = Number(item?.duration || 0);
      const progress = Number(item?.progress || 0);
      if (!duration || progress / duration < 0.9) return false;
      return !item?.updated_at || daysSince(item.updated_at) >= WATCH_AGAIN_DAYS;
    }),
    "movie"
  );
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

  return [...scores.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.name).localeCompare(String(b.name), "it");
  });
}

function removeTaken(items, taken, limit = 16) {
  return uniqueItems(items)
    .filter((item) => !taken.has(itemKey(item)))
    .slice(0, limit);
}

export default function HomeSmartSections() {
  const { items: historyItems } = useContinueWatching();
  const [loadDetails] = useLazyGetAppendedVideosQuery();
  const requestId = useRef(0);
  const cacheKey = getSmartCacheKey();
  const initialCache = useMemo(() => readSmartCache(cacheKey), [cacheKey]);

  const [becauseItems, setBecauseItems] = useState(
    () => initialCache?.data?.becauseItems || []
  );
  const [becauseTitle, setBecauseTitle] = useState(
    () => initialCache?.data?.becauseTitle || ""
  );
  const [genreItems, setGenreItems] = useState(
    () => initialCache?.data?.genreItems || []
  );
  const [genreTitle, setGenreTitle] = useState(
    () => initialCache?.data?.genreTitle || ""
  );
  const [myListItems, setMyListItems] = useState(
    () => initialCache?.data?.myListItems || []
  );

  const rows = useHomeDedupe((state) => state.rows);
  const claim = useHomeDedupe((state) => state.claim);
  const release = useHomeDedupe((state) => state.release);

  const usableHistory = useMemo(
    () =>
      [...(historyItems || [])]
        .filter((item) => item?.tmdb_id && item?.media_type)
        .sort((a, b) => {
          const aTime = new Date(a?.updated_at || 0).getTime() || 0;
          const bTime = new Date(b?.updated_at || 0).getTime() || 0;
          return bTime - aTime;
        })
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

  const applySmartState = useCallback((next) => {
    setBecauseItems(next.becauseItems || []);
    setBecauseTitle(next.becauseTitle || "");
    setGenreItems(next.genreItems || []);
    setGenreTitle(next.genreTitle || "");
    setMyListItems(next.myListItems || []);
  }, []);

  const refreshSmartRows = useCallback(async (force = false) => {
    const cached = readSmartCache(cacheKey);
    if (
      !force &&
      cached?.savedAt &&
      Date.now() - cached.savedAt < SMART_REFRESH_MS
    ) {
      applySmartState(cached.data);
      return;
    }

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

    const next = {
      becauseItems: [],
      becauseTitle: "",
      genreItems: [],
      genreTitle: "",
      myListItems: normalizeItems(listData?.items || [], "movie"),
    };

    if (!usableHistory.length) {
      applySmartState(next);
      writeSmartCache(cacheKey, next);
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

    const source = usableHistory[0];
    const sourceRow = detailRows.find(
      (row) => Number(row.history.tmdb_id) === Number(source?.tmdb_id)
    );

    if (source && sourceRow?.detail) {
      const sourceGenres = (sourceRow.detail.genres || []).slice(0, 2);
      const pools = await Promise.all(
        sourceGenres.map((genre) => fetchAvailableGenre(genre.id, sourceRow.mediaType))
      );
      const watched = new Set(
        usableHistory.map((item) => `${item.media_type}-${item.tmdb_id}`)
      );
      const merged = newestFirst(
        normalizeItems(
          pools.flat().filter(
            (item) =>
              Number(item.id) !== Number(source.tmdb_id) &&
              !watched.has(itemKey(item))
          ),
          toSlug(sourceRow.mediaType)
        )
      );
      next.becauseItems = merged.slice(0, 16);
      next.becauseTitle =
        merged.length && source.title ? `Perché hai guardato ${source.title}` : "";
    }

    const rankedGenres = buildGenreScores(detailRows, likedKeys);
    const selectedGenre = rankedGenres[0];
    if (selectedGenre?.id) {
      const pool = await fetchAvailableGenre(selectedGenre.id, selectedGenre.mediaType);
      const watchedKeys = new Set(usableHistory.map((item) => `${item.media_type}-${item.tmdb_id}`));
      const clean = pool
        .filter((item) => !watchedKeys.has(itemKey(item)))
        .slice(0, 16);
      next.genreItems = clean;
      next.genreTitle = clean.length
        ? `${toSlug(selectedGenre.mediaType) === "tv" ? "Serie" : "Film"} ${selectedGenre.name}`
        : "";
    }

    if (currentRequest !== requestId.current) return;
    applySmartState(next);
    writeSmartCache(cacheKey, next);
  }, [usableHistory, loadDetails, cacheKey, applySmartState]);

  useEffect(() => {
    refreshSmartRows(false);
  }, [historyKey, refreshSmartRows]);

  useEffect(() => {
    const timer = window.setInterval(
      () => refreshSmartRows(true),
      SMART_REFRESH_MS
    );
    return () => window.clearInterval(timer);
  }, [refreshSmartRows]);

  // Build the personalized rows sequentially, exactly as they appear on screen.
  // Each lower row removes every title already selected above it. There is no
  // fallback that reintroduces duplicates just to fill a carousel.
  const visibleBecause = useMemo(() => {
    const taken = claimedAbove(rows, -40, "smart-because-watched");
    return removeTaken(becauseItems, taken);
  }, [becauseItems, rows]);

  const visibleWatchAgain = useMemo(() => {
    const taken = claimedAbove(rows, -30, "smart-watch-again");
    visibleBecause.forEach((item) => taken.add(itemKey(item)));
    return removeTaken(watchAgainItems, taken);
  }, [watchAgainItems, visibleBecause, rows]);

  const visibleMyList = useMemo(() => {
    const taken = claimedAbove(rows, -20, "smart-my-list");
    visibleBecause.forEach((item) => taken.add(itemKey(item)));
    visibleWatchAgain.forEach((item) => taken.add(itemKey(item)));
    return removeTaken(myListItems, taken);
  }, [myListItems, visibleBecause, visibleWatchAgain, rows]);

  const visibleGenre = useMemo(() => {
    const taken = claimedAbove(rows, -10, "smart-genre");
    visibleBecause.forEach((item) => taken.add(itemKey(item)));
    visibleWatchAgain.forEach((item) => taken.add(itemKey(item)));
    visibleMyList.forEach((item) => taken.add(itemKey(item)));
    return removeTaken(genreItems, taken);
  }, [genreItems, visibleBecause, visibleWatchAgain, visibleMyList, rows]);

  useEffect(() => {
    const ids = visibleBecause.map(itemKey).filter(Boolean);
    if (ids.length) claim("smart-because-watched", -40, ids);
    else release("smart-because-watched");
    return () => release("smart-because-watched");
  }, [visibleBecause, claim, release]);

  useEffect(() => {
    const ids = visibleWatchAgain.map(itemKey).filter(Boolean);
    if (ids.length) claim("smart-watch-again", -30, ids);
    else release("smart-watch-again");
    return () => release("smart-watch-again");
  }, [visibleWatchAgain, claim, release]);

  useEffect(() => {
    const ids = visibleMyList.map(itemKey).filter(Boolean);
    if (ids.length) claim("smart-my-list", -20, ids);
    else release("smart-my-list");
    return () => release("smart-my-list");
  }, [visibleMyList, claim, release]);

  useEffect(() => {
    const ids = visibleGenre.map(itemKey).filter(Boolean);
    if (ids.length) claim("smart-genre", -10, ids);
    else release("smart-genre");
    return () => release("smart-genre");
  }, [visibleGenre, claim, release]);

  return (
    <>
      {becauseTitle && visibleBecause.length > 0 && (
        <HomepageSlider title={becauseTitle} items={visibleBecause} />
      )}

      {visibleWatchAgain.length > 0 && (
        <HomepageSlider title="Guarda di nuovo" items={visibleWatchAgain} />
      )}

      {visibleMyList.length > 0 && (
        <HomepageSlider title="La mia lista" items={visibleMyList} />
      )}

      {genreTitle && visibleGenre.length > 0 && (
        <HomepageSlider title={genreTitle} items={visibleGenre} />
      )}
    </>
  );
}
