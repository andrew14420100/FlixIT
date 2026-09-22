// @ts-nocheck
import { useState, useEffect, useCallback, useRef, useMemo, startTransition } from "react";
import { useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import HeroSection from "src/components/HeroSection";
import ContinueWatchingSection from "src/components/ContinueWatchingSection";
import HomeSmartSections from "src/components/HomeSmartSections";
import { genreSliceEndpoints } from "src/store/slices/genre";
import { MEDIA_TYPE } from "src/types/Common";
import store from "src/store";
import HomepageSlider from "src/components/HomepageSlider";
import Top10Slider from "src/components/Top10Slider";
import { useQuery } from "@tanstack/react-query";
import {
  useHomeDedupe,
  itemKey,
  claimedAbove,
  uniqueItems,
} from "src/store/homeDedupe";
import {
  readHomePreferences,
  preferenceBoost,
  stableProfileBias,
} from "src/store/homePersonalization";
import {
  DAILY_REFRESH_MS,
  romeDailyBucket,
  cacheBelongsToCurrentRomeWindow,
  msUntilNextRomeRefresh,
} from "src/utils/dailyRefresh";

// Three TMDB pages give ~60 candidates per row, which is already more than the
// UI exposes. The previous 10-page/240-item policy multiplied every Home row
// into a large burst of requests and artwork work with no visible benefit.
const INITIAL_ROWS = 4;
const ROWS_PER_LOAD = 3;
const ROW_ITEM_LIMIT = 60;
const CLAIM_LIMIT = 50;
const PAGES_PER_SECTION = 3;
const HOME_CACHE_PREFIX = "flix-home-v11";
const DYNAMIC_SHARE_DEFAULT = 0.25;
const DYNAMIC_SHARE_FAST_ROWS = 0.50;
const FLIXIT_TOP10_URL = "/api/public/flixit-top10?hours=48";

function readPersistedCache(key) {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
    if (!parsed || !parsed.savedAt || parsed.data == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedCache(key, data) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ savedAt: Date.now(), bucket: romeDailyBucket(), data })
    );
  } catch {}
}

const freshFetchJson = async (url, fallback, refreshBucket = romeDailyBucket()) => {
  if (!url) return fallback;
  try {
    const separator = url.includes("?") ? "&" : "?";
    // The daily bucket already changes the URL when content should refresh, so
    // normal browser/HTTP caching is safe within that window. `no-store` forced
    // a full network reload even for the same data after navigation/reload.
    const response = await fetch(
      `${url}${separator}_flix_window=${encodeURIComponent(refreshBucket)}`,
      { headers: { Accept: "application/json" } }
    );
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
};

function withPage(url, page) {
  if (!url) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}page=${page}`;
}

export async function loader() {
  // Warm genre data in the background but never block Home navigation on these
  // two auxiliary requests.
  store.dispatch(genreSliceEndpoints.getGenres.initiate(MEDIA_TYPE.Movie));
  store.dispatch(genreSliceEndpoints.getGenres.initiate(MEDIA_TYPE.Tv));
  return null;
}

const mediaSlug = (s) =>
  s.media_type === "mixed" ? "mixed" : s.media_type === "tv" ? "tv" : "movie";

export function sectionUrl(section) {
  const t = section.section_type || section.apiString;
  switch (t) {
    case "trending": return "/api/public/homepage/trending";
    case "latest": return "/api/public/homepage/latest";
    case "top10": return FLIXIT_TOP10_URL;
    case "upcoming": return "/api/public/tmdb/upcoming";
    case "new_releases": return "/api/public/new-releases/movie";
    case "new_seasons": return "/api/public/new-releases/tv";
    case "now_playing": return "/api/public/tmdb/now_playing";
    case "airing_today": return "/api/public/tmdb/airing_today";
    case "on_the_air": return "/api/public/tmdb/on_the_air";
    case "popular": return `/api/public/tmdb/popular/${mediaSlug(section)}`;
    case "top_rated": return `/api/public/tmdb/top_rated/${mediaSlug(section)}`;
    case "genre": {
      if (!section.genre_id) return null;
      const qs = section.origin_country
        ? `?origin_country=${encodeURIComponent(section.origin_country)}`
        : "";
      return `/api/public/tmdb/genre/${section.genre_id}/${mediaSlug(section)}${qs}`;
    }
    default: return null;
  }
}

function sectionSignature(section) {
  const type = section.section_type || section.apiString || "";
  const media = section.media_type || section.mediaType || "mixed";
  const genre = section.genre_id || "";
  const country = section.origin_country || "";
  return `${type}|${media}|${genre}|${country}`;
}

function sectionPriority(section) {
  const type = section.section_type || section.apiString;
  const priorities = {
    top10: 150,
    trending: 132,
    latest: 126,
    new_releases: 123,
    new_seasons: 121,
    popular: 116,
    now_playing: 108,
    airing_today: 108,
    on_the_air: 106,
    top_rated: 98,
    genre: 82,
    upcoming: 70,
  };
  return priorities[type] ?? 50;
}

function releaseTimestamp(item) {
  const raw =
    item?.release_date ||
    item?.first_air_date ||
    item?.available_at ||
    item?.created_at ||
    "";
  if (!raw) return 0;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : 0;
}

function freshnessScore(item) {
  const releasedAt = releaseTimestamp(item);
  if (!releasedAt) return 15;
  const days = (Date.now() - releasedAt) / 86400000;
  if (days < 0) return Math.max(20, 92 - Math.abs(days) * 0.3);
  if (days <= 14) return 100;
  if (days <= 30) return 92;
  if (days <= 90) return 78;
  if (days <= 180) return 64;
  if (days <= 365) return 50;
  if (days <= 730) return 34;
  if (days <= 1825) return 22;
  return 10;
}

function fameScore(item) {
  const popularity = Math.max(0, Number(item?.popularity || 0));
  const voteCount = Math.max(0, Number(item?.vote_count || 0));
  const rating = Math.max(0, Math.min(10, Number(item?.vote_average || 0)));
  return (
    Math.min(100, Math.log1p(popularity) * 17) * 0.52 +
    Math.min(100, Math.log1p(voteCount) * 11) * 0.30 +
    rating * 10 * 0.18
  );
}

function engagementRows(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.items,
    payload?.results,
    payload?.top10,
    payload?.data,
    payload?.data?.items,
    payload?.data?.results,
  ];
  return candidates.find(Array.isArray) || [];
}

function buildEngagementMap(payload) {
  const rows = engagementRows(payload);
  const map = {};
  rows.forEach((item, index) => {
    const key = itemKey(item);
    if (!key) return;

    if (Number.isFinite(Number(item?.flixit_score))) {
      map[key] = Math.max(0, Math.min(100, Number(item.flixit_score)));
      return;
    }

    const views = Math.max(
      0,
      Number(item?.views || item?.view_count || item?.viewCount || item?.plays || 0)
    );
    const completed = Math.max(
      0,
      Number(item?.completed || item?.completion_count || item?.completed_count || 0)
    );
    const localRating = Math.max(
      0,
      Math.min(10, Number(item?.user_rating || item?.rating || item?.average_rating || 0))
    );
    const rankSignal = Math.max(15, 100 - index * 8);
    const viewsSignal = views ? Math.min(100, Math.log1p(views) * 15) : rankSignal;
    const completionSignal = completed ? Math.min(100, Math.log1p(completed) * 18) : 0;
    const ratingSignal = localRating ? localRating * 10 : 0;
    map[key] = Math.min(
      100,
      rankSignal * 0.42 +
      viewsSignal * 0.38 +
      completionSignal * 0.12 +
      ratingSignal * 0.08
    );
  });
  return map;
}

function rowScore(item, type, originalIndex, engagementMap = {}) {
  const endpointRank = Math.max(0, 100 - originalIndex * 2.2);
  const fresh = freshnessScore(item);
  const famous = fameScore(item);
  const local = Number(engagementMap[itemKey(item)] || 0);

  switch (type) {
    case "latest":
    case "new_releases":
    case "new_seasons":
    case "now_playing":
    case "airing_today":
    case "on_the_air":
      return local * 0.34 + fresh * 0.36 + famous * 0.18 + endpointRank * 0.12;
    case "trending":
      return local * 0.40 + endpointRank * 0.26 + famous * 0.20 + fresh * 0.14;
    case "popular":
      return local * 0.42 + famous * 0.28 + endpointRank * 0.18 + fresh * 0.12;
    case "top_rated":
      return local * 0.40 + famous * 0.32 + endpointRank * 0.18 + fresh * 0.10;
    case "upcoming":
      return local * 0.20 + endpointRank * 0.36 + famous * 0.24 + fresh * 0.20;
    case "genre":
    default:
      return local * 0.42 + famous * 0.23 + fresh * 0.20 + endpointRank * 0.15;
  }
}

function dynamicShareForType(type) {
  return new Set([
    "latest",
    "new_releases",
    "new_seasons",
    "trending",
    "now_playing",
    "airing_today",
    "on_the_air",
  ]).has(type)
    ? DYNAMIC_SHARE_FAST_ROWS
    : DYNAMIC_SHARE_DEFAULT;
}

function rankDailyItems(items, type, engagementMap = {}) {
  const valid = uniqueItems(items).filter((item) => item && itemKey(item));
  if (type === "top10" || valid.length <= 3) return valid;

  const share = dynamicShareForType(type);
  const step = share >= 0.5 ? 2 : 4;
  const dynamicSlots = [];
  for (let index = step - 1; index < valid.length; index += step) {
    dynamicSlots.push(index);
  }
  if (!dynamicSlots.length) return valid;

  const ranked = valid
    .map((item, originalIndex) => ({
      item,
      originalIndex,
      score: rowScore(item, type, originalIndex, engagementMap),
    }))
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);

  const dynamicPicks = ranked.slice(0, dynamicSlots.length).map((entry) => entry.item);
  const dynamicKeys = new Set(dynamicPicks.map(itemKey));
  const stableQueue = valid.filter((item) => !dynamicKeys.has(itemKey(item)));
  const dynamicQueue = [...dynamicPicks];
  const dynamicSet = new Set(dynamicSlots);
  const out = [];

  for (let index = 0; index < valid.length; index += 1) {
    const candidate = dynamicSet.has(index) ? dynamicQueue.shift() : stableQueue.shift();
    if (candidate) out.push(candidate);
  }
  [...stableQueue, ...dynamicQueue].forEach((item) => {
    if (item && !out.some((existing) => itemKey(existing) === itemKey(item))) out.push(item);
  });
  return out;
}

function buildDailySnapshot(incomingData, type) {
  const valid = uniqueItems(incomingData?.items || []);
  return {
    ...(incomingData || {}),
    items: valid.slice(0, type === "top10" ? 10 : ROW_ITEM_LIMIT),
  };
}

const PAGED_TYPES = new Set([
  "trending",
  "new_releases",
  "new_seasons",
  "genre",
  "popular",
  "top_rated",
  "now_playing",
  "airing_today",
  "on_the_air",
  "upcoming",
]);

async function fetchPaged(url, refreshBucket, count = PAGES_PER_SECTION) {
  const pages = await Promise.all(
    Array.from({ length: count }, (_, index) => index + 1).map((page) =>
      freshFetchJson(withPage(url, page), { items: [] }, refreshBucket)
    )
  );
  return {
    ...(pages[0] || {}),
    items: uniqueItems(pages.flatMap((part) => part?.items || [])),
  };
}

async function fetchSectionPayload(section, url, refreshBucket) {
  const type = section.section_type || section.apiString;

  if (type === "latest") {
    const urls = ["/api/public/homepage/latest"];
    for (let page = 1; page <= PAGES_PER_SECTION; page += 1) {
      urls.push(withPage("/api/public/tmdb/now_playing", page));
      urls.push(withPage("/api/public/tmdb/on_the_air", page));
    }
    const parts = await Promise.all(
      urls.map((candidate) => freshFetchJson(candidate, { items: [] }, refreshBucket))
    );
    return {
      items: uniqueItems(parts.flatMap((part) => part?.items || [])),
      total: parts.reduce(
        (sum, part) => sum + Number(part?.total || part?.items?.length || 0),
        0
      ),
    };
  }

  if (PAGED_TYPES.has(type)) {
    return fetchPaged(url, refreshBucket);
  }

  return freshFetchJson(url, { items: [] }, refreshBucket);
}

function buildExtraSections(templates, adminSections, preferences, userId) {
  const used = new Set(adminSections.map(sectionSignature));
  const usedNames = new Set(
    adminSections.map((s) => String(s.name || "").trim().toLowerCase())
  );
  const result = [];

  for (const template of templates || []) {
    if (!sectionUrl(template)) continue;
    const signature = sectionSignature(template);
    const normalizedName = String(template.name || "").trim().toLowerCase();
    if (used.has(signature) || (normalizedName && usedNames.has(normalizedName))) continue;

    used.add(signature);
    if (normalizedName) usedNames.add(normalizedName);
    result.push({
      ...template,
      key: `auto-${signature}-${template.name}`,
      auto_generated: true,
    });
  }

  return result.sort((a, b) => {
    const aSignature = sectionSignature(a);
    const bSignature = sectionSignature(b);
    const aScore =
      sectionPriority(a) +
      preferenceBoost(a, preferences) +
      stableProfileBias(userId, aSignature);
    const bScore =
      sectionPriority(b) +
      preferenceBoost(b, preferences) +
      stableProfileBias(userId, bSignature);
    return bScore - aScore;
  });
}

function RowSkeleton({ title }) {
  return (
    <Box data-testid="row-skeleton" className="row-title" sx={{ pl: { xs: 2, sm: 3, md: "4vw" } }}>
      <Typography variant="h5" sx={{ fontWeight: 700, color: "#fff", mb: 1.5 }}>
        {title}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ overflow: "hidden" }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Box
            key={i}
            sx={{
              flex: "0 0 auto",
              width: { xs: "46vw", sm: "31vw", md: "15.1vw" },
              aspectRatio: "16/9",
              borderRadius: "6px",
              bgcolor: "#141414",
              animation: "flixPulse 1.4s ease-in-out infinite",
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}

function SectionRow({ section, index, onSettled, refreshBucket, engagementMap }) {
  const url = sectionUrl(section);
  const type = section.section_type || section.apiString;
  const isTop10 = type === "top10";
  const cacheKey = `${HOME_CACHE_PREFIX}:row:${sectionSignature(section)}`;
  const initialCache = useMemo(() => readPersistedCache(cacheKey), [cacheKey]);
  const cacheIsCurrent = cacheBelongsToCurrentRomeWindow(initialCache?.savedAt);

  const { data, isPending } = useQuery({
    queryKey: ["home-row-v11", refreshBucket, sectionSignature(section), url],
    queryFn: async () => {
      const incoming = await fetchSectionPayload(section, url, refreshBucket);
      const snapshot = buildDailySnapshot(incoming, type);
      writePersistedCache(cacheKey, snapshot);
      return snapshot;
    },
    initialData: initialCache?.data,
    initialDataUpdatedAt: cacheIsCurrent ? initialCache?.savedAt : 0,
    staleTime: DAILY_REFRESH_MS,
    gcTime: DAILY_REFRESH_MS * 7,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const rows = useHomeDedupe((s) => s.rows);
  const claim = useHomeDedupe((s) => s.claim);
  const release = useHomeDedupe((s) => s.release);

  const items = useMemo(() => {
    if (isPending && !data) return null;
    const ranked = rankDailyItems(data?.items || [], type, engagementMap);
    if (isTop10) return ranked.slice(0, 10);

    const taken = claimedAbove(rows, index, section.key);
    const uniqueFirst = ranked.filter((item) => !taken.has(itemKey(item)));
    const selected = [...uniqueFirst];
    const selectedKeys = new Set(selected.map(itemKey));

    if (selected.length < ROW_ITEM_LIMIT) {
      for (const item of ranked) {
        const key = itemKey(item);
        if (!key || selectedKeys.has(key)) continue;
        selectedKeys.add(key);
        selected.push(item);
        if (selected.length >= ROW_ITEM_LIMIT) break;
      }
    }

    return selected.slice(0, ROW_ITEM_LIMIT);
  }, [data, isPending, rows, index, section.key, isTop10, type, engagementMap]);

  useEffect(() => {
    if (!isPending || data) onSettled();
  }, [isPending, data, onSettled]);

  const idsKey = items
    ? items.slice(0, CLAIM_LIMIT).map(itemKey).filter(Boolean).join("|")
    : "";
  useEffect(() => {
    if (idsKey) claim(section.key, index, idsKey.split("|"));
    else release(section.key);
  }, [idsKey, section.key, index, claim, release]);

  useEffect(() => () => release(section.key), [section.key, release]);

  if (items === null) return <RowSkeleton title={section.name} />;
  if (!items.length) return null;
  if (isTop10) return <Top10Slider title={section.name} items={items} />;
  return <HomepageSlider title={section.name} items={items} />;
}

export function Component() {
  const { mediaType: filterMediaType } = useParams();
  const currentMediaType =
    filterMediaType === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;
  const [visibleCount, setVisibleCount] = useState(INITIAL_ROWS);
  const [tick, setTick] = useState(0);
  const [refreshBucket, setRefreshBucket] = useState(() => romeDailyBucket());
  const sentinelRef = useRef(null);
  const resetDedupe = useHomeDedupe((state) => state.reset);

  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setRefreshBucket(romeDailyBucket());
        schedule();
      }, msUntilNextRomeRefresh() + 1500);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  const userId =
    typeof window !== "undefined"
      ? window.localStorage.getItem("netflix_user_id") || "guest"
      : "guest";
  const preferences = useMemo(() => readHomePreferences(userId), [userId]);
  const preferenceSignature = `${(preferences?.favoriteGenres || []).join("-")}|${
    preferences?.preferredMediaType || "mixed"
  }`;

  const engagementCacheKey = `${HOME_CACHE_PREFIX}:engagement`;
  const initialEngagement = useMemo(
    () => readPersistedCache(engagementCacheKey),
    [engagementCacheKey]
  );
  const engagementCurrent = cacheBelongsToCurrentRomeWindow(initialEngagement?.savedAt);
  const { data: engagementPayload = initialEngagement?.data || {} } = useQuery({
    queryKey: ["home-engagement-v11", refreshBucket],
    queryFn: async () => {
      const payload = await freshFetchJson(
        FLIXIT_TOP10_URL,
        { items: [] },
        refreshBucket
      );
      writePersistedCache(engagementCacheKey, payload);
      return payload;
    },
    initialData: initialEngagement?.data,
    initialDataUpdatedAt: engagementCurrent ? initialEngagement?.savedAt : 0,
    staleTime: DAILY_REFRESH_MS,
    gcTime: DAILY_REFRESH_MS * 7,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
  const engagementMap = useMemo(
    () => buildEngagementMap(engagementPayload),
    [engagementPayload]
  );

  const feedCacheKey = `${HOME_CACHE_PREFIX}:feed:${userId}:${preferenceSignature}`;
  const initialFeedCache = useMemo(
    () => readPersistedCache(feedCacheKey),
    [feedCacheKey]
  );
  const feedCacheCurrent = cacheBelongsToCurrentRomeWindow(initialFeedCache?.savedAt);

  const { data: feed = null } = useQuery({
    queryKey: ["home-feed-v11", refreshBucket, userId, preferenceSignature],
    queryFn: async () => {
      const [secData, tplData] = await Promise.all([
        freshFetchJson("/api/public/sections", { sections: [] }, refreshBucket),
        freshFetchJson("/api/public/available-sections", { sections: [] }, refreshBucket),
      ]);

      const admin = (secData.sections || [])
        .filter((s) => s.active !== false && s.visible !== false)
        .map((s) => ({ ...s, key: `admin-${s.name}-${sectionSignature(s)}` }));

      const automatic = buildExtraSections(
        tplData.sections || [],
        admin,
        preferences,
        userId
      );
      const all = [...admin, ...automatic];
      const top10 = all.filter((s) => (s.section_type || s.apiString) === "top10");
      const rest = all.filter((s) => (s.section_type || s.apiString) !== "top10");
      const nextFeed = [...top10, ...rest];
      writePersistedCache(feedCacheKey, nextFeed);
      return nextFeed;
    },
    initialData: initialFeedCache?.data,
    initialDataUpdatedAt: feedCacheCurrent ? initialFeedCache?.savedAt : 0,
    staleTime: DAILY_REFRESH_MS,
    gcTime: DAILY_REFRESH_MS * 7,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  useEffect(() => {
    resetDedupe();
  }, [filterMediaType, refreshBucket, resetDedupe]);

  const onRowSettled = useCallback(() => {
    startTransition(() => setTick((t) => t + 1));
  }, []);

  const top10Section = useMemo(
    () => (feed || []).find((s) => (s.section_type || s.apiString) === "top10") || null,
    [feed]
  );
  const ordinaryFeed = useMemo(
    () => (feed || []).filter((s) => (s.section_type || s.apiString) !== "top10"),
    [feed]
  );
  const total = ordinaryFeed.length;
  const hasMore = visibleCount < total;

  useEffect(() => {
    if (feed) {
      startTransition(() => {
        setVisibleCount((count) =>
          Math.min(Math.max(INITIAL_ROWS, count), ordinaryFeed.length || INITIAL_ROWS)
        );
      });
    }
  }, [feed, ordinaryFeed.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          startTransition(() => {
            setVisibleCount((count) => Math.min(count + ROWS_PER_LOAD, total));
          });
        }
      },
      { rootMargin: "900px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, total, visibleCount, tick]);

  const visibleSections = useMemo(
    () => ordinaryFeed.slice(0, visibleCount),
    [ordinaryFeed, visibleCount]
  );

  return (
    <Box
      data-testid="home-page"
      sx={{
        width: "100%",
        maxWidth: "none",
        mx: 0,
        overflowX: "clip",
        fontFamily: '\"Netflix Sans\", \"Helvetica Neue\", Helvetica, Arial, sans-serif',
      }}
    >
      <HeroSection mediaType={currentMediaType} />

      <Stack
        spacing={{ xs: 2.5, md: 3.0 }}
        sx={{
          position: "relative",
          zIndex: 12,
          mt: { xs: "-7.5vh", md: "-7vh" },
          pt: { xs: 1.25, md: 1.5 },
          pb: 8,
          bgcolor: "transparent",
          background:
            "linear-gradient(to bottom, rgba(20,20,20,0) 0px, rgba(20,20,20,.18) 28px, rgba(20,20,20,.72) 92px, #141414 175px, #141414 100%)",
          "& > *": { position: "relative" },
        }}
        className="sliders"
        data-testid="home-rows"
      >
        <ContinueWatchingSection />

        {top10Section && (
          <SectionRow
            key={top10Section.key}
            section={top10Section}
            index={-50}
            onSettled={onRowSettled}
            refreshBucket={refreshBucket}
            engagementMap={engagementMap}
          />
        )}

        <HomeSmartSections />

        {visibleSections.map((section, index) => (
          <SectionRow
            key={section.key}
            section={section}
            index={index}
            onSettled={onRowSettled}
            refreshBucket={refreshBucket}
            engagementMap={engagementMap}
          />
        ))}

        {feed && feed.length === 0 && (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Typography color="grey.500">Nessuna sezione disponibile.</Typography>
          </Box>
        )}

        <Box
          ref={sentinelRef}
          data-testid="infinite-scroll-sentinel"
          sx={{ display: "flex", justifyContent: "center", py: 0, minHeight: 1 }}
        >
          {hasMore && (
            <CircularProgress
              size={20}
              sx={{ color: "#E50914" }}
              data-testid="infinite-scroll-loader"
            />
          )}
        </Box>
      </Stack>
    </Box>
  );
}
