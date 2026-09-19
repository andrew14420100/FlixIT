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
import { writeHomePreferences } from "src/store/homePersonalization";
import {
  romeDailyBucket,
  cacheBelongsToCurrentRomeWindow,
  msUntilNextRomeRefresh,
} from "src/utils/dailyRefresh";

const CACHE_PREFIX = "flix-home-smart-v8";
const WATCH_AGAIN_DAYS = 28;
const RECENT_DAYS = 14;
const MAX_HISTORY = 12;
const MAX_ROW_ITEMS = 36;

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

function releaseTime(item) {
  const raw = item?.release_date || item?.first_air_date || item?.available_at || "";
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function freshnessScore(item) {
  const ts = releaseTime(item);
  if (!ts) return 18;
  const days = (Date.now() - ts) / 86400000;
  if (days < 0) return 0;
  if (days <= 14) return 100;
  if (days <= 30) return 94;
  if (days <= 90) return 84;
  if (days <= 180) return 70;
  if (days <= 365) return 54;
  if (days <= 730) return 30;
  return 8;
}

function fameScore(item) {
  const popularity = Math.max(0, Number(item?.popularity || 0));
  const votes = Math.max(0, Number(item?.vote_count || 0));
  const rating = Math.max(0, Math.min(10, Number(item?.vote_average || 0)));
  return (
    Math.min(100, Math.log1p(popularity) * 17) * 0.52 +
    Math.min(100, Math.log1p(votes) * 11) * 0.30 +
    rating * 10 * 0.18
  );
}

function rankNewForYou(items, favoriteGenres = []) {
  const favorites = favoriteGenres.map(Number);
  return normalize(items)
    .map((item, index) => {
      const itemGenres = (item?.genre_ids || []).map(Number);
      let taste = 0;
      favorites.forEach((genreId, rank) => {
        if (itemGenres.includes(genreId)) taste += Math.max(8, 34 - rank * 9);
      });
      const fresh = freshnessScore(item);
      const famous = fameScore(item);
      const endpointRank = Math.max(0, 100 - index * 1.5);
      return {
        item,
        score: fresh * 0.48 + famous * 0.22 + taste * 0.24 + endpointRank * 0.06,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
    .slice(0, MAX_ROW_ITEMS);
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
    localStorage.setItem(
      key,
      JSON.stringify({ savedAt: Date.now(), bucket: romeDailyBucket(), data })
    );
  } catch {}
}

async function fetchJson(url, fallback = null) {
  try {
    const separator = url.includes("?") ? "&" : "?";
    const bucket = romeDailyBucket();
    const response = await fetch(`${url}${separator}_flix_window=${encodeURIComponent(bucket)}`, {
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
  const pages = await Promise.all(
    [1, 2, 3].map((page) =>
      fetchJson(
        `/api/public/tmdb/genre/${genreId}/${slug}?page=${page}`,
        { items: [] }
      )
    )
  );
  return normalize(pages.flatMap((part) => part?.items || []), slug);
}

async function freshCataloguePool() {
  const urls = [
    "/api/public/homepage/latest",
    "/api/public/tmdb/now_playing?page=1",
    "/api/public/tmdb/now_playing?page=2",
    "/api/public/tmdb/on_the_air?page=1",
    "/api/public/tmdb/on_the_air?page=2",
  ];
  const parts = await Promise.all(
    urls.map((url) => fetchJson(url, { items: [] }))
  );
  return normalize(parts.flatMap((part) => part?.items || []));
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
  // Paint the last good personalization snapshot immediately even after 06:00;
  // a stale snapshot is refreshed silently instead of blanking the Home.
  const initialCache = useMemo(() => readCache(key), [key]);
  const initial = initialCache?.data || {};

  const [becauseItems, setBecauseItems] = useState(initial.becauseItems || []);
  const [becauseTitle, setBecauseTitle] = useState(initial.becauseTitle || "");
  const [newForYouItems, setNewForYouItems] = useState(initial.newForYouItems || []);
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
    setNewForYouItems(next.newForYouItems || []);
    setGenreItems(next.genreItems || []);
    setGenreTitle(next.genreTitle || "");
    setMyListItems(next.myListItems || []);
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      const cached = readCache(key);
      if (cached?.data) applyState(cached.data);
      if (!force && cached && cacheBelongsToCurrentRomeWindow(cached.savedAt)) {
        return;
      }

      const request = ++requestRef.current;
      const userId = localStorage.getItem("netflix_user_id") || "guest";
      const [listData, likesData, freshPool] = await Promise.all([
        userId !== "guest"
          ? fetchJson(`/api/user/list/${encodeURIComponent(userId)}`, { items: [] })
          : Promise.resolve({ items: [] }),
        userId !== "guest"
          ? fetchJson(`/api/user/likes/${encodeURIComponent(userId)}`, { items: [] })
          : Promise.resolve({ items: [] }),
        freshCataloguePool(),
      ]);
      if (request !== requestRef.current) return;

      const next = {
        becauseItems: [],
        becauseTitle: "",
        newForYouItems: rankNewForYou(freshPool, []),
        genreItems: [],
        genreTitle: "",
        myListItems: normalize(listData?.items || []).slice(0, MAX_ROW_ITEMS),
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

        const rankedGenres = [...genreScores.values()].sort(
          (a, b) => b.score - a.score
        );
        const favoriteGenre = rankedGenres[0];
        const favoriteGenreIds = rankedGenres.slice(0, 3).map((genre) => genre.id);

        const movieCount = recentHistory.filter((item) => item.media_type !== "tv").length;
        const tvCount = recentHistory.filter((item) => item.media_type === "tv").length;
        const preferredMediaType = tvCount > movieCount ? "tv" : movieCount > tvCount ? "movie" : "mixed";

        if (favoriteGenreIds.length) {
          writeHomePreferences(userId, {
            favoriteGenres: favoriteGenreIds,
            preferredMediaType,
          });
        }

        if (favoriteGenre) {
          const pool = await genrePool(favoriteGenre.id, favoriteGenre.mediaType);
          const watched = new Set(recentHistory.map(itemKey));
          next.genreItems = pool
            .filter((item) => !watched.has(itemKey(item)))
            .slice(0, MAX_ROW_ITEMS);
          next.genreTitle = next.genreItems.length
            ? `${toSlug(favoriteGenre.mediaType) === "tv" ? "Serie" : "Film"} ${favoriteGenre.name}`
            : "";

          next.newForYouItems = rankNewForYou(
            [...freshPool, ...pool],
            favoriteGenreIds
          ).filter((item) => !watched.has(itemKey(item)));
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

  // Keep a long-lived tab aligned with the same 06:00 Europe/Rome window as
  // catalogue, artwork and trailer maintenance.
  useEffect(() => {
    const timer = window.setTimeout(() => refresh(true), msUntilNextRomeRefresh() + 2000);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const visibleBecause = useMemo(() => {
    const taken = claimedAbove(rows, -45, "smart-because-watched");
    return removeTaken(becauseItems, taken);
  }, [becauseItems, rows]);

  const visibleNewForYou = useMemo(() => {
    const taken = claimedAbove(rows, -40, "smart-new-for-you");
    visibleBecause.forEach((item) => taken.add(itemKey(item)));
    return removeTaken(newForYouItems, taken);
  }, [newForYouItems, visibleBecause, rows]);

  const visibleWatchAgain = useMemo(() => {
    const taken = claimedAbove(rows, -30, "smart-watch-again");
    visibleBecause.forEach((item) => taken.add(itemKey(item)));
    visibleNewForYou.forEach((item) => taken.add(itemKey(item)));
    return removeTaken(watchAgainItems, taken);
  }, [watchAgainItems, visibleBecause, visibleNewForYou, rows]);

  const visibleMyList = useMemo(() => {
    const taken = claimedAbove(rows, -20, "smart-my-list");
    visibleBecause.forEach((item) => taken.add(itemKey(item)));
    visibleNewForYou.forEach((item) => taken.add(itemKey(item)));
    visibleWatchAgain.forEach((item) => taken.add(itemKey(item)));
    return removeTaken(myListItems, taken);
  }, [myListItems, visibleBecause, visibleNewForYou, visibleWatchAgain, rows]);

  const visibleGenre = useMemo(() => {
    const taken = claimedAbove(rows, -10, "smart-genre");
    visibleBecause.forEach((item) => taken.add(itemKey(item)));
    visibleNewForYou.forEach((item) => taken.add(itemKey(item)));
    visibleWatchAgain.forEach((item) => taken.add(itemKey(item)));
    visibleMyList.forEach((item) => taken.add(itemKey(item)));
    return removeTaken(genreItems, taken);
  }, [genreItems, visibleBecause, visibleNewForYou, visibleWatchAgain, visibleMyList, rows]);

  useClaimRow("smart-because-watched", -45, visibleBecause);
  useClaimRow("smart-new-for-you", -40, visibleNewForYou);
  useClaimRow("smart-watch-again", -30, visibleWatchAgain);
  useClaimRow("smart-my-list", -20, visibleMyList);
  useClaimRow("smart-genre", -10, visibleGenre);

  return (
    <>
      {becauseTitle && visibleBecause.length > 0 && (
        <HomepageSlider title={becauseTitle} items={visibleBecause} />
      )}
      {visibleNewForYou.length > 0 && (
        <HomepageSlider title="Novità per te" items={visibleNewForYou} />
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
