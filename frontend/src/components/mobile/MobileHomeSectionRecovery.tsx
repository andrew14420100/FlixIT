// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useQueryClient } from "@tanstack/react-query";

const MOBILE_QUERY = "(max-width:899px)";
const FEED_QUERY_PREFIX = "home-feed-v11";
const FEED_CACHE_PREFIX = "flix-home-v11:feed:";
const RECOVERY_MEMORY_TTL = 5 * 60 * 1000;

const FALLBACK_SECTIONS = [
  { name: "Top 10 titoli oggi", section_type: "top10", media_type: "mixed" },
  { name: "I titoli del momento", section_type: "trending", media_type: "mixed" },
  { name: "Aggiunti di recente", section_type: "latest", media_type: "mixed" },
  { name: "In arrivo", section_type: "upcoming", media_type: "movie" },
  { name: "Film popolari", section_type: "popular", media_type: "movie" },
  { name: "Serie TV popolari", section_type: "popular", media_type: "tv" },
  { name: "I più votati", section_type: "top_rated", media_type: "movie" },
];

let recoveredMemo: { at: number; feed: any[] } | null = null;

function signature(section: any) {
  return [
    section?.section_type || section?.apiString || "",
    section?.media_type || section?.mediaType || "mixed",
    section?.genre_id || "",
    section?.origin_country || "",
  ].join("|");
}

function normalizeSections(adminPayload: any, templatePayload: any) {
  const admin = (Array.isArray(adminPayload?.sections) ? adminPayload.sections : [])
    .filter((section: any) => section?.active !== false && section?.visible !== false)
    .map((section: any) => ({ ...section, key: `recovered-admin-${section.name || "section"}-${signature(section)}` }));

  const seen = new Set(admin.map(signature));
  const templates = (Array.isArray(templatePayload?.sections) ? templatePayload.sections : [])
    .filter((section: any) => section?.active !== false && section?.visible !== false)
    .filter((section: any) => {
      const key = signature(section);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((section: any) => ({ ...section, key: `recovered-auto-${section.name || "section"}-${signature(section)}` }));

  const merged = [...admin, ...templates];
  const source = merged.length ? merged : FALLBACK_SECTIONS.map((section, index) => ({
    ...section,
    key: `recovered-fallback-${index}-${signature(section)}`,
  }));

  const top10 = source.filter((section: any) => (section.section_type || section.apiString) === "top10");
  const rest = source.filter((section: any) => (section.section_type || section.apiString) !== "top10");
  return [...top10, ...rest];
}

async function fetchJson(url: string, signal: AbortSignal) {
  try {
    const response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (response.ok) return await response.json();
  } catch (error: any) {
    if (error?.name === "AbortError") throw error;
  }
  return { sections: [] };
}

function persistRecoveredFeed(feed: any[]) {
  try {
    const payload = JSON.stringify({ savedAt: Date.now(), data: feed });
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(FEED_CACHE_PREFIX)) localStorage.setItem(key, payload);
    });
  } catch {}
}

function hasUsableFeed(queryClient: any) {
  const matching = queryClient.getQueryCache().findAll({ queryKey: [FEED_QUERY_PREFIX] });
  return matching.some((query: any) => Array.isArray(query.state.data) && query.state.data.length > 0);
}

function injectFeed(queryClient: any, feed: any[]) {
  if (!feed.length || hasUsableFeed(queryClient)) return false;
  const matching = queryClient.getQueryCache().findAll({ queryKey: [FEED_QUERY_PREFIX] });
  if (!matching.length) return false;
  queryClient.setQueriesData({ queryKey: [FEED_QUERY_PREFIX] }, feed);
  persistRecoveredFeed(feed);
  return true;
}

export default function MobileHomeSectionRecovery() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const queryClient = useQueryClient();
  const isHome = location.pathname === "/" || location.pathname === "/browse";

  useEffect(() => {
    if (!isMobile || !isHome) return;

    let cancelled = false;
    const controller = new AbortController();
    const timers: number[] = [];

    const applyWithShortRetry = (feed: any[]) => {
      if (cancelled || !feed.length || injectFeed(queryClient, feed)) return;
      // The Home query may be created a few frames after this runtime mounts.
      // Retry only the cache injection; never repeat the network request.
      timers.push(window.setTimeout(() => injectFeed(queryClient, feed), 350));
      timers.push(window.setTimeout(() => injectFeed(queryClient, feed), 1100));
    };

    const recoverOnlyIfNeeded = async () => {
      if (cancelled || hasUsableFeed(queryClient)) return;

      const now = Date.now();
      if (recoveredMemo && now - recoveredMemo.at < RECOVERY_MEMORY_TTL) {
        applyWithShortRetry(recoveredMemo.feed);
        return;
      }

      try {
        const [admin, templates] = await Promise.all([
          fetchJson("/api/public/sections", controller.signal),
          fetchJson("/api/public/available-sections", controller.signal),
        ]);
        if (cancelled) return;
        const feed = normalizeSections(admin, templates);
        recoveredMemo = { at: Date.now(), feed };
        applyWithShortRetry(feed);
      } catch (error: any) {
        if (error?.name === "AbortError" || cancelled) return;
        const feed = normalizeSections(null, null);
        recoveredMemo = { at: Date.now(), feed };
        applyWithShortRetry(feed);
      }
    };

    // Recovery is not part of the normal Home load. Give the real feed enough
    // time to arrive first; this removes two duplicate no-store requests and the
    // old 12-second polling loop from every successful mobile Home visit.
    timers.push(window.setTimeout(recoverOnlyIfNeeded, 1400));

    return () => {
      cancelled = true;
      controller.abort();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [isMobile, isHome, queryClient]);

  return null;
}
