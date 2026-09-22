// @ts-nocheck
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";

import HeroSection from "src/components/HeroSection";
import ContinueWatchingSection from "src/components/ContinueWatchingSection";
import HomepageSlider from "src/components/HomepageSlider";
import Top10Slider from "src/components/Top10Slider";
import { MEDIA_TYPE } from "src/types/Common";

const HOME_BOOTSTRAP_URL = "/api/public/home-bootstrap";
const HOME_CACHE_KEY = "flix-home-bootstrap-v1";
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
  } catch {
    // localStorage is an optimization only.
  }
}

function itemKey(item) {
  const id = Number(item?.tmdbId || item?.tmdb_id || item?.id || 0);
  if (!id) return "";
  const type = item?.type === "tv" || item?.media_type === "tv" ? "tv" : "movie";
  return `${type}:${id}`;
}

function normalizeRows(rows = [], filterMediaType) {
  const claimed = new Set();
  return (rows || [])
    .map((row, rowIndex) => {
      const type = row?.section_type || "";
      const isTop10 = type === "top10";
      const seen = new Set();
      const items = (row?.items || []).filter((item) => {
        if (!item) return false;
        const key = itemKey(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);

        if (filterMediaType === "movie" || filterMediaType === "tv") {
          const itemType = item?.type === "tv" || item?.media_type === "tv" ? "tv" : "movie";
          if (row?.media_type !== "mixed" && itemType !== filterMediaType) return false;
        }

        if (!isTop10 && claimed.has(key)) return false;
        return true;
      });

      if (!isTop10) items.slice(0, 50).forEach((item) => claimed.add(itemKey(item)));
      return {
        ...row,
        key: row?.key || `${type || "row"}-${rowIndex}`,
        items: isTop10 ? items.slice(0, 10) : items.slice(0, 50),
      };
    })
    .filter((row) => row.items.length > 0);
}

export async function loader() {
  return null;
}

export function Component() {
  const { mediaType: filterMediaType } = useParams();
  const currentMediaType =
    filterMediaType === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;

  const initialCache = useMemo(() => readHomeCache(), []);
  const { data: bootstrap } = useQuery({
    queryKey: ["home-bootstrap-v1"],
    queryFn: async ({ signal }: any) => {
      const response = await fetch(HOME_BOOTSTRAP_URL, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Home bootstrap ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data?.rows)) throw new Error("Home bootstrap non valido");
      return data;
    },
    initialData: initialCache?.data,
    initialDataUpdatedAt: initialCache?.savedAt || 0,
    staleTime: HOME_STALE_MS,
    gcTime: HOME_GC_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  useEffect(() => {
    if (bootstrap?.rows?.length) writeHomeCache(bootstrap);
  }, [bootstrap]);

  if (typeof window !== "undefined" && bootstrap?.hero?.contentId) {
    window.__flixitHomeHero = bootstrap.hero;
  }

  const rows = useMemo(
    () => normalizeRows(bootstrap?.rows || [], filterMediaType),
    [bootstrap?.rows, filterMediaType]
  );
  const hasReadyHome = rows.length > 0;

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
          <ContinueWatchingSection />

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
