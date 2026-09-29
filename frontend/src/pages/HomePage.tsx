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

const HOME_BOOTSTRAP_FAST_URL = "/api/public/home-bootstrap-fast";
const HOME_BOOTSTRAP_FULL_URL = "/api/public/home-bootstrap";
const HOME_QUERY_KEY = ["home-bootstrap-v9-atomic-full-home"];
const HOME_CACHE_KEY = "flix-home-bootstrap-v9-atomic-full-home";
const HOME_STALE_MS = 10 * 60 * 1000;
const HOME_GC_MS = 24 * 60 * 60 * 1000;

function readHomeCache() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HOME_CACHE_KEY) || "null");
    if (!parsed?.savedAt || !parsed?.data || !Array.isArray(parsed.data?.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeHomeCache(data) {
  if (typeof window === "undefined" || !data?.rows?.length) return;
  try {
    // Store exactly what the page renders. Never truncate rows/items in the
    // persistence layer: refresh must start from the complete accepted snapshot.
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

function isScSource(value: any) {
  const source = String(value || "").trim().toLowerCase();
  return source === "streamingcommunity" || source.startsWith("streamingcommunity_");
}

function warmCriticalHero(hero: any) {
  if (!hero) return;
  const assets = hero?.assets || {};
  if (isScSource(assets?.logo_source)) {
    warmImage(assets?.logo_path || assets?.logo_url, "high");
  }
  warmImage(
    hero?.customBackdrop || assets?.hero_backdrop_path || assets?.backdrop_path,
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
  const filteredPage = filterMediaType === "movie" || filterMediaType === "tv";
  const claimed = new Set(initialClaimed);
  return (rows || [])
    .map((row, rowIndex) => {
      const type = row?.section_type || "";
      const seen = new Set();
      const items = (row?.items || []).filter((item) => {
        if (!item) return false;
        const key = itemKey(item);
        if (!key || seen.has(key) || (!filteredPage && claimed.has(key))) return false;
        seen.add(key);

        if (filteredPage) {
          const itemType = item?.type === "tv" || item?.media_type === "tv" ? "tv" : "movie";
          if (itemType !== filterMediaType) return false;
        }
        return true;
      });

      const limit = type === "top10" ? 10 : 50;
      const visible = items.slice(0, limit);
      if (!filteredPage) visible.forEach((item) => claimed.add(itemKey(item)));
      return {
        ...row,
        key: row?.key || `${type || "row"}-${rowIndex}`,
        items: visible,
      };
    })
    .filter((row) => row.items.length > 0 && (!filteredPage || row.section_type !== "top10"));
}

async function fetchBootstrapUrl(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Home bootstrap ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data?.rows)) throw new Error("Home bootstrap non valido");
  warmCriticalHero(data?.hero);
  return data;
}

let sharedFullPromise: Promise<any> | null = null;
function fetchFullHomeBootstrap(signal?: AbortSignal) {
  if (sharedFullPromise) return sharedFullPromise;
  let shared: Promise<any>;
  shared = fetchBootstrapUrl(HOME_BOOTSTRAP_FULL_URL, signal)
    .then((data) => ({ ...data, compact: false }))
    .finally(() => {
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          if (sharedFullPromise === shared) sharedFullPromise = null;
        }, 5000);
      } else if (sharedFullPromise === shared) {
        sharedFullPromise = null;
      }
    });
  sharedFullPromise = shared;
  return shared;
}

let sharedFastPromise: Promise<any> | null = null;
function fetchFastHomeBootstrap(signal?: AbortSignal) {
  if (sharedFastPromise) return sharedFastPromise;

  const headPromise = typeof window !== "undefined"
    ? (window as any).__FLIXIT_HOME_FAST_PROMISE__
    : null;

  const firstRequest = headPromise
    ? Promise.resolve(headPromise).then(async (data: any) => {
        try { (window as any).__FLIXIT_HOME_FAST_PROMISE__ = null; } catch {}
        if (data?.rows) {
          warmCriticalHero(data?.hero);
          return data;
        }
        return fetchFullHomeBootstrap(signal);
      })
    : fetchBootstrapUrl(HOME_BOOTSTRAP_FAST_URL, signal);

  let shared: Promise<any>;
  shared = firstRequest
    .then(async (data) => {
      // Never publish a partial/compact Home and append sections later. If the
      // fast endpoint says its snapshot is incomplete, resolve the complete one
      // before React accepts the new value.
      if (data?.compact === true) return fetchFullHomeBootstrap(signal);
      return data;
    })
    .catch(async (error) => {
      if (signal?.aborted) throw error;
      return fetchFullHomeBootstrap(signal);
    })
    .finally(() => {
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          if (sharedFastPromise === shared) sharedFastPromise = null;
        }, 1500);
      } else if (sharedFastPromise === shared) {
        sharedFastPromise = null;
      }
    });
  sharedFastPromise = shared;
  return shared;
}

const MODULE_HOME_CACHE = typeof window !== "undefined" ? readHomeCache() : null;
if (MODULE_HOME_CACHE?.data?.hero) warmCriticalHero(MODULE_HOME_CACHE.data.hero);

const EARLY_HOME_BOOTSTRAP_PROMISE =
  typeof window !== "undefined" ? fetchFastHomeBootstrap().catch(() => null) : null;
let earlyHomeBootstrapConsumed = false;

export async function loader() {
  return null;
}

export function Component() {
  const { mediaType: filterMediaType } = useParams();
  const filteredPage = filterMediaType === "movie" || filterMediaType === "tv";
  const currentMediaType = filterMediaType === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;
  const { items: progressItems, username, removeItem } = useContinueWatching();

  const continueItems = useMemo(() => {
    if (filteredPage) return [];
    return (progressItems || [])
      .filter((item) => {
        const duration = Number(item?.duration || 0);
        const progress = Number(item?.progress || 0);
        if (duration > 0 && progress / duration >= 0.95) return false;
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
          percent: item.duration > 0
            ? Math.min(100, Math.max(0, (item.progress / item.duration) * 100))
            : 0,
          season: item.season,
          episode: item.episode,
          onRemove: () => removeItem(item.tmdb_id),
        },
      }));
  }, [progressItems, filteredPage, removeItem]);

  const continueKeys = useMemo(
    () => new Set(continueItems.map(itemKey).filter(Boolean)),
    [continueItems]
  );

  const initialCache = useMemo(() => MODULE_HOME_CACHE || readHomeCache(), []);
  const { data: bootstrap } = useQuery({
    queryKey: HOME_QUERY_KEY,
    queryFn: async ({ signal }: any) => {
      if (!earlyHomeBootstrapConsumed && EARLY_HOME_BOOTSTRAP_PROMISE) {
        earlyHomeBootstrapConsumed = true;
        const early = await EARLY_HOME_BOOTSTRAP_PROMISE;
        if (early?.rows) return early;
      }
      return fetchFastHomeBootstrap(signal);
    },
    initialData: initialCache?.data,
    initialDataUpdatedAt: initialCache?.savedAt || 0,
    staleTime: HOME_STALE_MS,
    gcTime: HOME_GC_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
  });

  useEffect(() => {
    if (bootstrap?.rows?.length) writeHomeCache(bootstrap);
  }, [bootstrap]);

  const heroLogoUrl = isScSource(bootstrap?.hero?.assets?.logo_source)
    ? (bootstrap?.hero?.assets?.logo_path || bootstrap?.hero?.assets?.logo_url || null)
    : null;
  const heroBackdropUrl = bootstrap?.hero?.customBackdrop || bootstrap?.hero?.assets?.hero_backdrop_path || bootstrap?.hero?.assets?.backdrop_path || null;

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

  const hasHero = !!bootstrap?.hero?.contentId;
  const hasReadyRows = rows.length > 0 || continueItems.length > 0;
  const hasReadyHome = hasHero || hasReadyRows;
  const continueTitle = username ? `${username}, continua a guardare` : "Continua a guardare";

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
      {hasHero ? (
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

      {hasReadyRows && (
        <Stack
          spacing={0}
          sx={{
            position: "relative",
            zIndex: 12,
            mt: 0,
            pt: 0,
            pb: { xs: 6, md: 8 },
            bgcolor: "transparent",
            background: "transparent",
            "& > *": { position: "relative" },
          }}
          className="sliders"
          data-testid="home-rows"
        >
          {!filteredPage && continueItems.length > 0 ? (
            <HomepageSlider rowId="continua" title={continueTitle} items={continueItems} compactSpacing />
          ) : null}

          {rows.map((row) =>
            row.section_type === "top10" ? (
              <Top10Slider key={row.key} title={row.name} items={row.items} />
            ) : (
              <HomepageSlider key={row.key} rowId={row.key} title={row.name} items={row.items} />
            )
          )}
        </Stack>
      )}
    </Box>
  );
}
