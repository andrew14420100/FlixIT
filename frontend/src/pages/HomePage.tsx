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
import { useHomeDedupe, itemKey, claimedAbove } from "src/store/homeDedupe";

const INITIAL_ROWS = 4;
const ROWS_PER_LOAD = 3;
const FEED_REFRESH_MS = 5 * 60 * 1000;

const freshFetchJson = async (url, fallback) => {
  if (!url) return fallback;
  try {
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}_flix=${Date.now()}`, {
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

function sectionRefreshMs(section) {
  const type = section.section_type || section.apiString;
  switch (type) {
    case "top10":
      return 2 * 60 * 1000;
    case "trending":
    case "latest":
    case "new_releases":
    case "new_seasons":
    case "airing_today":
    case "on_the_air":
      return 5 * 60 * 1000;
    case "upcoming":
    case "now_playing":
      return 10 * 60 * 1000;
    case "genre":
    case "popular":
    case "top_rated":
    default:
      return 15 * 60 * 1000;
  }
}

// Home Screen Sections replaces the vanilla home with a modular feed. FLIX-IT
// now follows the same principle: configured rows stay first, then every other
// supported template is appended automatically (not just genres). Infinite
// loading keeps a large catalogue cheap to render.
function buildExtraSections(templates, adminSections) {
  const used = new Set(adminSections.map(sectionSignature));
  const usedNames = new Set(adminSections.map((s) => s.name));

  return (templates || [])
    .filter((template) => !!sectionUrl(template))
    .filter(
      (template) =>
        !used.has(sectionSignature(template)) && !usedNames.has(template.name)
    )
    .map((template) => ({
      ...template,
      key: `auto-${sectionSignature(template)}-${template.name}`,
      auto_generated: true,
    }));
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
  const refreshMs = sectionRefreshMs(section);

  const { data, isPending } = useQuery({
    queryKey: ["home-row", sectionSignature(section), url],
    queryFn: () => freshFetchJson(url, { items: [] }),
    staleTime: Math.min(refreshMs / 2, 2 * 60 * 1000),
    refetchInterval: refreshMs,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchIntervalInBackground: false,
  });

  const rows = useHomeDedupe((s) => s.rows);
  const claim = useHomeDedupe((s) => s.claim);
  const release = useHomeDedupe((s) => s.release);

  const items = useMemo(() => {
    if (isPending) return null;
    const all = (data?.items || []).filter(
      (item) => item && (item.backdrop_path || item.poster_path)
    );
    if (isTop10) return all.slice(0, 10);

    const taken = claimedAbove(rows, index);
    const kept = all.filter((item) => !taken.has(itemKey(item)));
    return (kept.length >= 6 ? kept : all).slice(0, 30);
  }, [data, isPending, rows, index, isTop10]);

  useEffect(() => {
    if (!isPending) onSettled();
  }, [isPending, onSettled]);

  const idsKey = items && !isTop10 ? items.map(itemKey).filter(Boolean).join("|") : "";
  useEffect(() => {
    if (idsKey) claim(section.key, index, idsKey.split("|"));
  }, [idsKey, section.key, index, claim]);

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

  const { data: feed = null } = useQuery({
    queryKey: ["home-feed"],
    queryFn: async () => {
      const [secData, tplData] = await Promise.all([
        freshFetchJson("/api/public/sections", { sections: [] }),
        freshFetchJson("/api/public/available-sections", { sections: [] }),
      ]);

      const admin = (secData.sections || [])
        .filter((s) => s.active !== false && s.visible !== false)
        .map((s) => ({ ...s, key: `admin-${s.name}-${sectionSignature(s)}` }));

      const automatic = buildExtraSections(tplData.sections || [], admin);
      return [...admin, ...automatic];
    },
    staleTime: 60 * 1000,
    refetchInterval: FEED_REFRESH_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchIntervalInBackground: false,
  });

  const onRowSettled = useCallback(() => setTick((t) => t + 1), []);
  const total = feed?.length || 0;
  const hasMore = visibleCount < total;

  useEffect(() => {
    // If an automatic refresh adds/removes sections, never leave the visible
    // counter outside the new feed length.
    if (feed) setVisibleCount((count) => Math.min(Math.max(INITIAL_ROWS, count), feed.length || INITIAL_ROWS));
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
        overflowX: "hidden",
        fontFamily: '"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
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
