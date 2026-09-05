// @ts-nocheck
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import HeroSection from "src/components/HeroSection";
import ContinueWatchingSection from "src/components/ContinueWatchingSection";
import { genreSliceEndpoints } from "src/store/slices/genre";
import { MEDIA_TYPE } from "src/types/Common";
import store from "src/store";
import HomepageSlider from "src/components/HomepageSlider";
import Top10Slider from "src/components/Top10Slider";
import { useQuery } from "@tanstack/react-query";

const INITIAL_ROWS = 3;
const ROWS_PER_LOAD = 2;
// Every row (trending, latest, upcoming, genres...) refreshes on this cadence and when the tab regains focus.
const REFRESH_MS = 10 * 60 * 1000;
const liveQueryOptions = { staleTime: REFRESH_MS, refetchInterval: REFRESH_MS, refetchOnWindowFocus: true, refetchIntervalInBackground: false };
const fetchJson = (url, fallback) => fetch(url).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);

export async function loader() {
  await Promise.all([
    store.dispatch(genreSliceEndpoints.getGenres.initiate(MEDIA_TYPE.Movie)),
    store.dispatch(genreSliceEndpoints.getGenres.initiate(MEDIA_TYPE.Tv)),
  ]);
  return null;
}

const mediaSlug = (s) => (s.media_type === "mixed" ? "mixed" : s.media_type === "tv" ? "tv" : "movie");

export function sectionUrl(section) {
  const t = section.section_type || section.apiString;
  switch (t) {
    case "trending": return "/api/public/homepage/trending";
    case "latest": return "/api/public/homepage/latest";
    case "top10": return "/api/public/top10";
    case "upcoming": return "/api/public/tmdb/upcoming";
    case "now_playing": return "/api/public/tmdb/now_playing";
    case "airing_today": return "/api/public/tmdb/airing_today";
    case "on_the_air": return "/api/public/tmdb/on_the_air";
    case "popular": return `/api/public/tmdb/popular/${mediaSlug(section)}`;
    case "top_rated": return `/api/public/tmdb/top_rated/${mediaSlug(section)}`;
    case "genre": {
      if (!section.genre_id) return null;
      const qs = section.origin_country ? `?origin_country=${section.origin_country}` : "";
      return `/api/public/tmdb/genre/${section.genre_id}/${mediaSlug(section)}${qs}`;
    }
    default: return null;
  }
}

// Extra rows appended after the admin-configured ones so the homepage never "ends".
// Each genre is a single row mixing movies and TV shows (no "· Film" / "· Serie TV" split).
function buildExtraSections(templates, adminSections) {
  const used = new Set(adminSections.map((s) => s.name));
  return templates
    .filter((t) => t.section_type === "genre" && !used.has(t.name))
    .map((t) => ({ ...t, key: `extra-${t.name}` }));
}

function RowSkeleton({ title }) {
  return (
    <Box data-testid="row-skeleton" className="row-title">
      <Typography variant="h5" sx={{ fontWeight: 700, color: "#fff", mb: 1.5 }}>{title}</Typography>
      <Stack direction="row" spacing={1} sx={{ overflow: "hidden" }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Box key={i} sx={{ flex: "0 0 auto", width: { xs: "45%", sm: "30%", md: "16%" }, aspectRatio: "16/9", borderRadius: "6px", bgcolor: "#141414",
            animation: "flixPulse 1.4s ease-in-out infinite" }} />
        ))}
      </Stack>
    </Box>
  );
}

function SectionRow({ section, onSettled }) {
  const url = sectionUrl(section);
  const { data, isPending } = useQuery({
    queryKey: ["home-row", url],
    queryFn: () => (url ? fetchJson(url, { items: [] }) : { items: [] }),
    ...liveQueryOptions,
  });
  const items = isPending ? null : data?.items || [];

  useEffect(() => { if (!isPending) onSettled(); }, [isPending, onSettled]);

  if (items === null) return <RowSkeleton title={section.name} />;
  if (!items.length) return null;
  if ((section.section_type || section.apiString) === "top10") return <Top10Slider title={section.name} items={items} />;
  return <HomepageSlider title={section.name} items={items} />;
}

export function Component() {
  const { mediaType: filterMediaType } = useParams();
  const currentMediaType = filterMediaType === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;
  const [visibleCount, setVisibleCount] = useState(INITIAL_ROWS);
  const [tick, setTick] = useState(0);
  const sentinelRef = useRef(null);

  const { data: feed = null } = useQuery({
    queryKey: ["home-feed"],
    queryFn: async () => {
      const [secData, tplData] = await Promise.all([fetchJson("/api/public/sections", { sections: [] }), fetchJson("/api/public/available-sections", { sections: [] })]);
      const admin = (secData.sections || []).filter((s) => s.active !== false && s.visible !== false).map((s) => ({ ...s, key: `admin-${s.name}` }));
      return [...admin, ...buildExtraSections(tplData.sections || [], admin)];
    },
    ...liveQueryOptions,
  });

  const onRowSettled = useCallback(() => setTick((t) => t + 1), []);
  const total = feed?.length || 0;
  const hasMore = visibleCount < total;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisibleCount((c) => Math.min(c + ROWS_PER_LOAD, total));
    }, { rootMargin: "900px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, total, visibleCount, tick]);

  const visibleSections = useMemo(() => (feed || []).slice(0, visibleCount), [feed, visibleCount]);

  return (
    <Box data-testid="home-page">
      <HeroSection mediaType={currentMediaType} />

      <Stack spacing={{ xs: 4.5, md: 6 }} sx={{ position: "relative", zIndex: 5, mt: { xs: "-20vh", md: "-31vh" }, pb: 8 }} data-testid="home-rows">
        <ContinueWatchingSection />

        {visibleSections.map((section) => (
          <SectionRow key={section.key} section={section} onSettled={onRowSettled} />
        ))}

        {feed && feed.length === 0 && (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Typography color="grey.500">Nessuna sezione configurata. Aggiungi sezioni dal pannello admin.</Typography>
          </Box>
        )}

        <Box ref={sentinelRef} data-testid="infinite-scroll-sentinel" sx={{ display: "flex", justifyContent: "center", py: 2, minHeight: 40 }}>
          {hasMore && <CircularProgress size={26} sx={{ color: "#E50914" }} data-testid="infinite-scroll-loader" />}
        </Box>
      </Stack>
    </Box>
  );
}
