// @ts-nocheck
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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

const INITIAL_ROWS = 4;
const ROWS_PER_LOAD = 3;
const DAILY_REFRESH_MS = 24 * 60 * 60 * 1000;
// v4 intentionally invalidates the previous daily snapshots: those snapshots
// could contain the same title in several rows.
const HOME_CACHE_PREFIX = "flix-home-v4";

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
      JSON.stringify({ savedAt: Date.now(), data })
    );
  } catch {
    // A full localStorage must never block the homepage.
  }
}

const freshFetchJson = async (url, fallback) => {
  if (!url) return fallback;
  try {
    const separator = url.includes("?") ? "&" : "?";
    const dailyVersion = Math.floor(Date.now() / DAILY_REFRESH_MS);
    const response = await fetch(`${url}${separator}_flix_day=${dailyVersion}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
};

export async function loader() {
  await Promise.all([
    store.dispatch(genreSliceEndpoints.getGenres.initiate(MEDIA_TYPE.Movie)),
    store.dispatch(genreSliceEndpoints.getGenres.initiate(MEDIA_TYPE.Tv)),
  ]);
  return null;
}

const mediaSlug = (s) =>
  s.media_type === "mixed" ? "mixed" : s.media_type === "tv" ? "tv" : "movie";

export function sectionUrl(section) {
  const t = section.section_type || section.apiString;
  switch (t) {
    case "trending": return "/api/public/homepage/trending";
    case "latest": return "/api/public/homepage/latest";
    case "top10": return "/api/public/top10";
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
    trending: 130,
    latest: 125,
    new_releases: 123,
    new_seasons: 121,
    popular: 116,
    top10: 114,
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
  // Future releases remain highly relevant only to rows which explicitly ask
  // for them. For normal rows this still prevents an old classic from beating
  // every recent title only because of lifetime vote count.
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

  // Logarithms prevent giant franchises from permanently crowding out fresh
  // releases while still giving well-known titles a strong signal.
  return (
    Math.min(100, Math.log1p(popularity) * 17) * 0.52 +
    Math.min(100, Math.log1p(voteCount) * 11) * 0.30 +
    rating * 10 * 0.18
  );
}

function rowScore(item, type, originalIndex) {
  const endpointRank = Math.max(0, 100 - originalIndex * 3.5);
  const fresh = freshnessScore(item);
  const famous = fameScore(item);

  switch (type) {
    case "latest":
    case "new_releases":
    case "new_seasons":
    case "now_playing":
    case "airing_today":
    case "on_the_air":
      return fresh * 0.58 + famous * 0.27 + endpointRank * 0.15;

    case "trending":
      return endpointRank * 0.45 + famous * 0.35 + fresh * 0.20;

    case "popular":
      return famous * 0.50 + endpointRank * 0.32 + fresh * 0.18;

    case "top_rated":
      return famous * 0.55 + endpointRank * 0.34 + fresh * 0.11;

    case "upcoming":
      return endpointRank * 0.55 + famous * 0.30 + fresh * 0.15;

    case "genre":
    default:
      return famous * 0.40 + fresh * 0.34 + endpointRank * 0.26;
  }
}

function rankDailyItems(items, type) {
  const valid = uniqueItems(items).filter(
    (item) => item && (item.backdrop_path || item.poster_path)
  );

  // Top 10 is already a meaningful rank supplied by the backend; preserve it.
  if (type === "top10") return valid;

  return valid
    .map((item, originalIndex) => ({
      item,
      originalIndex,
      score: rowScore(item, type, originalIndex),
    }))
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex)
    .map((entry) => entry.item);
}

function buildDailySnapshot(incomingData, type) {
  const ranked = rankDailyItems(incomingData?.items || [], type);
  return {
    ...(incomingData || {}),
    items: ranked.slice(0, type === "top10" ? 10 : 30),
  };
}

// Generate automatic rows once, without repeated signatures/names. Admin rows
// keep their chosen order; automatic discovery rows are then ordered so current,
// fresh and broadly popular catalogues are surfaced before narrow genre rows.
function buildExtraSections(templates, adminSections) {
  const used = new Set(adminSections.map(sectionSignature));
  const usedNames = new Set(
    adminSections.map((s) => String(s.name || "").trim().toLowerCase())
  );
  const result = [];

  for (const template of templates || []) {
    if (!sectionUrl(template)) continue;

    const signature = sectionSignature(template);
    const normalizedName = String(template.name || "").trim().toLowerCase();
    if (used.has(signature) || (normalizedName && usedNames.has(normalizedName))) {
      continue;
    }

    used.add(signature);
    if (normalizedName) usedNames.add(normalizedName);
    result.push({
      ...template,
      key: `auto-${signature}-${template.name}`,
      auto_generated: true,
    });
  }

  return result.sort((a, b) => sectionPriority(b) - sectionPriority(a));
}

function RowSkeleton({ title }) {
  return (
    <Box
      data-testid="row-skeleton"
      className="row-title"
      sx={{ pl: { xs: 2, sm: 3, md: "4vw" } }}
    >
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

function SectionRow({ section, index, onSettled }) {
  const url = sectionUrl(section);
  const type = section.section_type || section.apiString;
  const isTop10 = type === "top10";
  const cacheKey = `${HOME_CACHE_PREFIX}:row:${sectionSignature(section)}`;
  const initialCache = useMemo(() => readPersistedCache(cacheKey), [cacheKey]);

  const { data, isPending } = useQuery({
    queryKey: ["home-row", sectionSignature(section), url],
    queryFn: async () => {
      const incoming = await freshFetchJson(url, { items: [] });
      const snapshot = buildDailySnapshot(incoming, type);
      writePersistedCache(cacheKey, snapshot);
      return snapshot;
    },
    initialData: initialCache?.data,
    initialDataUpdatedAt: initialCache?.savedAt,
    staleTime: DAILY_REFRESH_MS,
    gcTime: DAILY_REFRESH_MS * 7,
    refetchInterval: DAILY_REFRESH_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: false,
  });

  const rows = useHomeDedupe((s) => s.rows);
  const claim = useHomeDedupe((s) => s.claim);
  const release = useHomeDedupe((s) => s.release);

  const items = useMemo(() => {
    if (isPending) return null;

    const ranked = rankDailyItems(data?.items || [], type);
    const taken = claimedAbove(rows, index, section.key);
    // Strict page-level diversity: never put a title back merely to fill a row.
    return ranked
      .filter((item) => !taken.has(itemKey(item)))
      .slice(0, isTop10 ? 10 : 30);
  }, [data, isPending, rows, index, section.key, isTop10, type]);

  useEffect(() => {
    if (!isPending) onSettled();
  }, [isPending, onSettled]);

  const idsKey = items ? items.map(itemKey).filter(Boolean).join("|") : "";
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
  const sentinelRef = useRef(null);
  const resetDedupe = useHomeDedupe((state) => state.reset);

  const feedCacheKey = `${HOME_CACHE_PREFIX}:feed`;
  const initialFeedCache = useMemo(
    () => readPersistedCache(feedCacheKey),
    [feedCacheKey]
  );

  const { data: feed = null } = useQuery({
    queryKey: ["home-feed-v4"],
    queryFn: async () => {
      const [secData, tplData] = await Promise.all([
        freshFetchJson("/api/public/sections", { sections: [] }),
        freshFetchJson("/api/public/available-sections", { sections: [] }),
      ]);

      const admin = (secData.sections || [])
        .filter((s) => s.active !== false && s.visible !== false)
        .map((s) => ({ ...s, key: `admin-${s.name}-${sectionSignature(s)}` }));

      const automatic = buildExtraSections(tplData.sections || [], admin);
      const nextFeed = [...admin, ...automatic];
      writePersistedCache(feedCacheKey, nextFeed);
      return nextFeed;
    },
    initialData: initialFeedCache?.data,
    initialDataUpdatedAt: initialFeedCache?.savedAt,
    staleTime: DAILY_REFRESH_MS,
    gcTime: DAILY_REFRESH_MS * 7,
    refetchInterval: DAILY_REFRESH_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    resetDedupe();
  }, [filterMediaType, resetDedupe]);

  const onRowSettled = useCallback(() => setTick((t) => t + 1), []);
  const total = feed?.length || 0;
  const hasMore = visibleCount < total;

  useEffect(() => {
    if (feed) {
      setVisibleCount((count) =>
        Math.min(Math.max(INITIAL_ROWS, count), feed.length || INITIAL_ROWS)
      );
    }
  }, [feed]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + ROWS_PER_LOAD, total));
        }
      },
      { rootMargin: "900px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, total, visibleCount, tick]);

  const visibleSections = useMemo(
    () => (feed || []).slice(0, visibleCount),
    [feed, visibleCount]
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
        spacing={{ xs: 3.2, md: 4.0 }}
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
        <HomeSmartSections />

        {visibleSections.map((section, index) => (
          <SectionRow
            key={section.key}
            section={section}
            index={index}
            onSettled={onRowSettled}
          />
        ))}

        {feed && feed.length === 0 && (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Typography color="grey.500">
              Nessuna sezione disponibile.
            </Typography>
          </Box>
        )}

        <Box
          ref={sentinelRef}
          data-testid="infinite-scroll-sentinel"
          sx={{ display: "flex", justifyContent: "center", py: 2, minHeight: 40 }}
        >
          {hasMore && (
            <CircularProgress
              size={26}
              sx={{ color: "#E50914" }}
              data-testid="infinite-scroll-loader"
            />
          )}
        </Box>
      </Stack>
    </Box>
  );
}
