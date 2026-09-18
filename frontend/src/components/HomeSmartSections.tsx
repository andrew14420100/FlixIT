// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomepageSlider from "./HomepageSlider";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { useLazyGetAppendedVideosQuery } from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import {
  useHomeDedupe,
  itemKey,
  claimedAbove,
  uniqueItems,
} from "src/store/homeDedupe";

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = "flix-home-smart-v5";
const WATCH_AGAIN_DAYS = 28;
const RECENT_DAYS = 14;
const MAX_HISTORY = 12;
const MAX_ROW_ITEMS = 16;

const toMediaType = (type) =>
  type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;
const toSlug = (type) => (type === MEDIA_TYPE.Tv ? "tv" : "movie");

function normalize(items, fallbackType = "movie") {
  return uniqueItems(
    (items || []).map((item) => {
      const id = item?.tmdbId || item?.tmdb_id || item?.media_id || item?.id;
      const type = item?.type || item?.media_type || fallbackType;
      return {
        ...item,
        id,
        tmdbId: id,
        tmdb_id: item?.tmdb_id || id,
        type,
        media_type: type,
        title: item?.title || item?.name || "",
        name: item?.name || item?.title || "",
      };
    })
  ).filter(
    (item) => item?.id && (item?.backdrop_path || item?.poster_path)
  );
}

function daysSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - time) / 86400000);
}

function cacheKey() {
  if (typeof window === "undefined") return `${CACHE_PREFIX}:guest`;
  return `${CACHE_PREFIX}:${localStorage.getItem("netflix_user_id") || "guest"}`;
}

function readCache(key) {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (!value?.savedAt || !value?.data) return null;
    return value;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {}
}

async function fetchJson(url, fallback = null) {
  try {
    const separator = url.includes("?") ? "&" : "?";
    const day = Math.floor(Date.now() / DAY_MS);
    const response = await fetch(`${url}${separator}_flix_day=${day}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
}

async function genrePool(genreId, mediaType) {
  if (!genreId) return [];
  const slug = toSlug(mediaType);
  const data = await fetchJson(
    `/api/public/tmdb/genre/${genreId}/${slug}`,
    { items: [] }
  );
  return normalize(data?.items || [], slug);
}

function removeTaken(items, taken) {
  return normalize(items)
    .filter((item) => !taken.has(itemKey(item)))
    .slice(0, MAX_ROW_ITEMS);
}

function useClaimRow(key, index, items) {
  const claim = useHomeDedupe((state) => state.claim);
  const release = useHomeDedupe((state) => state.release);
  const idsKey = useMemo(
    () => (items || []).map(itemKey).filter(Boolean).join("|"),
    [items]
  );

  useEffect(() => {
    if (idsKey) claim(key, index, idsKey.split("|"));
    else release(key);
    return () => release(key);
  }, [idsKey, key, index, claim, release]);
}

export default function HomeSmartSections() {
  const { items: progressItems } = useContinueWatching();
  const [loadDetails] = useLazyGetAppendedVideosQuery();
  const requestRef = useRef(0);
  const key = cacheKey();
  const initial = useMemo(() => readCache(key)?.data || {}, [key]);

  const [becauseItems, setBecauseItems] = useState(initial.becauseItems || []);
  const [becauseTitle, setBecauseTitle] = useState(initial.becauseTitle || "");
  const [genreItems, setGenreItems] = useState(initial.genreItems || []);
  const [genreTitle, setGenreTitle] = useState(initial.genreTitle || "");
  const [myListItems, setMyListItems] = useState(initial.myListItems || []);

  const rows = useHomeDedupe((state) => state.rows);

  const recentHistory = useMemo(
    () =>
      [...(progressItems || [])]
        .filter((item) => item?.tmdb_id && item?.media_type)
        .sort(
          (a, b) =>
            (new Date(b?.updated_at || 0).getTime() || 0) -
            (new Date(a?.updated_at || 0).getTime() || 0)
        )
        .slice(0, MAX_HISTORY),
    [progressItems]
  );

  const watchAgainItems = useMemo(
    () =>
      normalize(
        (progressItems || []).filter((item) => {
          const duration = Number(item?.duration || 0);
          const progress = Number(item?.progress || 0);
          return (
            duration > 0 &&
            progress / duration >= 0.9 &&
            (!item?.updated_at || daysSince(item.updated_at) >= WATCH_AGAIN_DAYS)
          );
        })
      ),
    [progressItems]
  );

  const historyKey = useMemo(
    () =>
      recentHistory
        .map(
          (item) =>
            `${item.media_type}:${item.tmdb_id}:${item.updated_at || ""}:${Math.round(
              Number(item.progress || 0)
            )}`
        )
        .join("|"),
    [recentHistory]
  );

  const applyState = useCallback((next) => {
    setBecauseItems(next.becauseItems || []);
    setBecauseTitle(next.becauseTitle || "");
    setGenreItems(next.genreItems || []);
    setGenreTitle(next.genreTitle || "");
    setMyListItems(next.myListItems || []);
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      const cached = readCache(key);
      if (!force && cached?.savedAt && Date.now() - cached.savedAt < DAY_MS) {
        applyState(cached.data);
        return;
      }

      const request = ++requestRef.current;
      const userId = localStorage.getItem("netflix_user_id") || "";
      const [listData, likesData] = await Promise.all([
        userId
          ? fetchJson(`/api/user/list/${encodeURIComponent(userId)}`, { items: [] })
          : Promise.resolve({ items: [] }),
        userId
          ? fetchJson(`/api/user/likes/${encodeURIComponent(userId)}`, { items: [] })
          : Promise.resolve({ items: [] }),
      ]);
      if (request !== requestRef.current) return;

      const next = {
        becauseItems: [],
        becauseTitle: "",
        genreItems: [],
        genreTitle: "",
        myListItems: normalize(listData?.items || []),
      };

      if (recentHistory.length) {
        const details = await Promise.all(
          recentHistory.slice(0, 8).map(async (history) => {
            const mediaType = toMediaType(history.media_type);
            try {
              const detail = await loadDetails(
                { mediaType, id: history.tmdb_id },
                false
              ).unwrap();
              return { history, mediaType, detail };
            } catch {
              return { history, mediaType, detail: null };
            }
          })
        );
        if (request !== requestRef.current) return;

        const source = recentHistory[0];
        const sourceDetail = details.find(
          (row) => Number(row.history.tmdb_id) === Number(source.tmdb_id)
        );

        if (sourceDetail?.detail) {
          const pools = await Promise.all(
            (sourceDetail.detail.genres || [])
              .slice(0, 2)
              .map((genre) => genrePool(genre.id, sourceDetail.mediaType))
          );
          const watched = new Set(recentHistory.map(itemKey));
          next.becauseItems = normalize(
            pools
              .flat()
              .filter(
                (item) =>
                  Number(item.id) !== Number(source.tmdb_id) &&
                  !watched.has(itemKey(item))
              ),
            toSlug(sourceDetail.mediaType)
          ).slice(0, MAX_ROW_ITEMS);
          next.becauseTitle = next.becauseItems.length
            ? `Perché hai guardato ${source.title || source.name || "questo titolo"}`
            : "";
        }

        const liked = new Set(
          (likesData?.items || []).map(
            (item) => `${item.media_type || "movie"}-${item.media_id || item.tmdb_id}`
          )
        );
        const genreScores = new Map();

        details.forEach(({ history, mediaType, detail }) => {
          if (!detail) return;
          const historyItemKey = `${history.media_type}-${history.tmdb_id}`;
          const recentBonus = daysSince(history.updated_at) <= RECENT_DAYS ? 50 : 0;
          const likeBonus = liked.has(historyItemKey) ? 125 : 0;
          const duration = Number(history.duration || 0);
          const completion = duration
            ? Math.min(1, Number(history.progress || 0) / duration)
            : 0;
          const weight = 1 + recentBonus + likeBonus + Math.round(completion * 10);

          (detail.genres || []).forEach((genre) => {
            if (!genre?.id) return;
            const current = genreScores.get(genre.id) || {
              id: genre.id,
              name: genre.name || "",
              score: 0,
              mediaType,
            };
            current.score += weight;
            genreScores.set(genre.id, current);
          });
        });

        const favoriteGenre = [...genreScores.values()].sort(
          (a, b) => b.score - a.score
        )[0];
        if (favoriteGenre) {
          const pool = await genrePool(favoriteGenre.id, favoriteGenre.mediaType);
          const watched = new Set(recentHistory.map(itemKey));
          next.genreItems = pool
            .filter((item) => !watched.has(itemKey(item)))
            .slice(0, MAX_ROW_ITEMS);
          next.genreTitle = next.genreItems.length
            ? `${toSlug(favoriteGenre.mediaType) === "tv" ? "Serie" : "Film"} ${favoriteGenre.name}`
            : "";
        }
      }

      if (request !== requestRef.current) return;
      applyState(next);
      writeCache(key, next);
    },
    [key, recentHistory, loadDetails, applyState]
  );

  useEffect(() => {
    refresh(false);
  }, [historyKey, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => refresh(true), DAY_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Stage-wise page allocation: each lower row excludes all content selected by
  // rows above it. This mirrors the page-level diversity principle and, unlike
  // the previous implementation, never re-adds duplicates to fill a carousel.
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

  useClaimRow("smart-because-watched", -40, visibleBecause);
  useClaimRow("smart-watch-again", -30, visibleWatchAgain);
  useClaimRow("smart-my-list", -20, visibleMyList);
  useClaimRow("smart-genre", -10, visibleGenre);

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
