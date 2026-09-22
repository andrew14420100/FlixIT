// @ts-nocheck
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";

import HeroSection from "src/components/HeroSection";
import HomepageSlider from "src/components/HomepageSlider";
import Top10Slider from "src/components/Top10Slider";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { MEDIA_TYPE } from "src/types/Common";

const HOME_BOOTSTRAP_URL = "/api/public/home-bootstrap";
const HOME_CACHE_KEY = "flix-home-bootstrap-v4-fuller";
const HOME_STALE_MS = 10 * 60 * 1000;
const HOME_GC_MS = 24 * 60 * 60 * 1000;

function readHomeCache() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HOME_CACHE_KEY) || "null");
    if (!parsed?.savedAt || !parsed?.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeHomeCache(data) {
  if (typeof window === "undefined" || !data?.rows?.length) return;
  try {
    window.localStorage.setItem(
      HOME_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), data })
    );
  } catch {}
}

function warmImage(url: any, priority: "high" | "auto" = "auto") {
  const src = String(url || "").trim();
  if (!src || typeof Image === "undefined") return;
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = priority;
  image.src = src;
}

function warmCriticalHero(hero: any) {
  if (!hero) return;
  warmImage(hero?.assets?.logo_path || hero?.assets?.fallback_logo_path, "high");
  warmImage(
    hero?.customBackdrop ||
      hero?.assets?.hero_backdrop_path ||
      hero?.assets?.backdrop_path,
    "high"
  );
}

function itemKey(item) {
  const id = Number(item?.tmdbId || item?.tmdb_id || item?.id || 0);
  if (!id) return "";
  const type = item?.type === "tv" || item?.media_type === "tv" ? "tv" : "movie";
  return `${type}:${id}`;
}

function normalizeRows(rows = [], filterMediaType, initialClaimed = new Set()) {
  const claimed = new Set(initialClaimed);
  return (rows || [])
    .map((row, rowIndex) => {
      const type = row?.section_type || "";
      const seen = new Set();
      const items = (row?.items || []).filter((item) => {
        if (!item) return false;
        const key = itemKey(item);
        if (!key || seen.has(key) || claimed.has(key)) return false;
        seen.add(key);

        if (filterMediaType === "movie" || filterMediaType === "tv") {
          const itemType = item?.type === "tv" || item?.media_type === "tv" ? "tv" : "movie";
          if (itemType !== filterMediaType) return false;
        }
        return true;
      });

      const limit = type === "top10" ? 10 : 50;
      const visible = items.slice(0, limit);
      visible.forEach((item) => claimed.add(itemKey(item)));
      return {
        ...row,
        key: row?.key || `${type || "row"}-${rowIndex}`,
        items: visible,
      };
    })
    .filter((row) => row.items.length > 0);
}

let sharedHomeBootstrapPromise: Promise<any> | null = null;
function fetchHomeBootstrap(_signal?: AbortSignal) {
  if (sharedHomeBootstrapPromise) return sharedHomeBootstrapPromise;

  const request = fetch(HOME_BOOTSTRAP_URL, {
    headers: { Accept: "application/json" },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Home bootstrap ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data?.rows)) throw new Error("Home bootstrap non valido");
    warmCriticalHero(data?.hero);
    return data;
  });

  const shared = request.finally(() => {
    window.setTimeout(() => {
      if (sharedHomeBootstrapPromise === shared) {
        sharedHomeBootstrapPromise = null;
      }
    }, 1500);
  });
  sharedHomeBootstrapPromise = shared;
  return shared;
}

// Re-visits: warm the cached Hero before the component tree mounts.
const MODULE_HOME_CACHE = typeof window !== "undefined" ? readHomeCache() : null;
if (MODULE_HOME_CACHE?.data?.hero) warmCriticalHero(MODULE_HOME_CACHE.data.hero);

// First visits: start the single Home request as soon as this route module is
// evaluated. React Query reuses the same promise, so there is no duplicate call.
const EARLY_HOME_BOOTSTRAP_PROMISE =
  typeof window !== "undefined"
    ? fetchHomeBootstrap().catch(() => null)
    : null;

export async function loader() {
  return null;
}

export function Component() {
  const { mediaType: filterMediaType } = useParams();
  const currentMediaType =
    filterMediaType === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;
  const {
    items: progressItems,
    username,
    removeItem,
  } = useContinueWatching();

  const continueItems = useMemo(() => {
    return (progressItems || [])
      .filter((item) => {
        const duration = Number(item?.duration || 0);
        const progress = Number(item?.progress || 0);
        if (duration > 0 && progress / duration >= 0.95) return false;
        if (filterMediaType === "movie" || filterMediaType === "tv") {
          return item?.media_type === filterMediaType;
        }
        return true;
      })
      .map((item) => ({
        tmdbId: item.tmdb_id,
        id: item.tmdb_id,
        type: item.media_type,
        media_type: item.media_type,
        title: item.title,
        name: item.title,
        backdrop_path: item.backdrop_path,
        poster_path: item.poster_path,
        genre_ids: item.genre_ids || [],
        watch: {
          progress: item.progress,
          duration: item.duration,
          percent:
            item.duration > 0
              ? Math.min(100, Math.max(0, (item.progress / item.duration) * 100))
              : 0,
          season: item.season,
          episode: item.episode,
          onRemove: () => removeItem(item.tmdb_id),
        },
      }));
  }, [progressItems, filterMediaType, removeItem]);

  const continueKeys = useMemo(
    () => new Set(continueItems.map(itemKey).filter(Boolean)),
    [continueItems]
  );

  const initialCache = useMemo(() => MODULE_HOME_CACHE || readHomeCache(), []);
  const { data: bootstrap } = useQuery({
    queryKey: ["home-bootstrap-v4-fuller"],
    queryFn: async ({ signal }: any) => {
      const early = EARLY_HOME_BOOTSTRAP_PROMISE
        ? await EARLY_HOME_BOOTSTRAP_PROMISE
        : null;
      if (early?.rows) return early;
      return fetchHomeBootstrap(signal);
    },
    initialData: initialCache?.data,
    initialDataUpdatedAt: initialCache?.savedAt || 0,
    staleTime: HOME_STALE_MS,
    gcTime: HOME_GC_MS,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });

  useEffect(() => {
    if (bootstrap?.rows?.length) writeHomeCache(bootstrap);
  }, [bootstrap]);

  const heroLogoUrl =
    bootstrap?.hero?.assets?.logo_path ||
    bootstrap?.hero?.assets?.fallback_logo_path ||
    null;
  const heroBackdropUrl =
    bootstrap?.hero?.customBackdrop ||
    bootstrap?.hero?.assets?.hero_backdrop_path ||
    bootstrap?.hero?.assets?.backdrop_path ||
    null;

  useEffect(() => {
    warmImage(heroLogoUrl, "high");
    warmImage(heroBackdropUrl, "high");
  }, [heroLogoUrl, heroBackdropUrl]);

  if (typeof window !== "undefined" && bootstrap?.hero?.contentId) {
    window.__flixitHomeHero = bootstrap.hero;
  }

  const rows = useMemo(
    () => normalizeRows(bootstrap?.rows || [], filterMediaType, continueKeys),
    [bootstrap?.rows, filterMediaType, continueKeys]
  );
  const hasReadyHome = rows.length > 0 || continueItems.length > 0;
  const continueTitle = username
    ? `${username}, continua a guardare:`
    : "Continua a guardare:";

  return (
    <Box
      data-testid="home-page"
      data-home-bootstrap={hasReadyHome ? "ready" : "warming"}
      sx={{
        width: "100%",
        maxWidth: "none",
        mx: 0,
        minHeight: "100vh",
        overflowX: "clip",
        bgcolor: "#141414",
        fontFamily: '\"Netflix Sans\", \"Helvetica Neue\", Helvetica, Arial, sans-serif',
      }}
    >
      {hasReadyHome ? (
        <HeroSection mediaType={currentMediaType} initialHero={bootstrap?.hero || null} />
      ) : (
        <Box
          aria-hidden="true"
          sx={{
            width: "100%",
            height: { xs: "34em", sm: "30em", md: "35em" },
            bgcolor: "#0f0f0f",
          }}
        />
      )}

      {hasReadyHome && (
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
          {continueItems.length > 0 ? (
            <HomepageSlider
              rowId="continua"
              title={continueTitle}
              items={continueItems}
              compactSpacing
            />
          ) : null}

          {rows.map((row) =>
            row.section_type === "top10" ? (
              <Top10Slider key={row.key} title={row.name} items={row.items} />
            ) : (
              <HomepageSlider
                key={row.key}
                rowId={row.key}
                title={row.name}
                items={row.items}
              />
            )
          )}
        </Stack>
      )}
    </Box>
  );
}
