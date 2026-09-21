// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useQueryClient } from "@tanstack/react-query";

const MOBILE_QUERY = "(max-width:899px)";
const FEED_QUERY_PREFIX = "home-feed-v11";
const FEED_CACHE_PREFIX = "flix-home-v11:feed:";

const FALLBACK_SECTIONS = [
  { name: "Top 10 titoli oggi", section_type: "top10", media_type: "mixed" },
  { name: "I titoli del momento", section_type: "trending", media_type: "mixed" },
  { name: "Aggiunti di recente", section_type: "latest", media_type: "mixed" },
  { name: "In arrivo", section_type: "upcoming", media_type: "movie" },
  { name: "Film popolari", section_type: "popular", media_type: "movie" },
  { name: "Serie TV popolari", section_type: "popular", media_type: "tv" },
  { name: "I più votati", section_type: "top_rated", media_type: "movie" },
];

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

async function fetchJson(url: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}_mobile_recover=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      });
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 220 * (attempt + 1)));
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

export default function MobileHomeSectionRecovery() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const queryClient = useQueryClient();
  const isHome = location.pathname === "/" || location.pathname === "/browse";

  useEffect(() => {
    if (!isMobile || !isHome) return;
    let cancelled = false;
    let feed: any[] = [];
    let interval = 0;

    const apply = () => {
      if (cancelled || !feed.length) return;
      const matching = queryClient.getQueryCache().findAll({ queryKey: [FEED_QUERY_PREFIX] });
      const empty = matching.length === 0 || matching.every((query: any) => !Array.isArray(query.state.data) || query.state.data.length === 0);
      if (!empty) return;
      queryClient.setQueriesData({ queryKey: [FEED_QUERY_PREFIX] }, feed);
      persistRecoveredFeed(feed);
    };

    const run = async () => {
      const [admin, templates] = await Promise.all([
        fetchJson("/api/public/sections"),
        fetchJson("/api/public/available-sections"),
      ]);
      if (cancelled) return;
      feed = normalizeSections(admin, templates);
      apply();
      interval = window.setInterval(apply, 1200);
      window.setTimeout(() => window.clearInterval(interval), 12000);
    };

    const timer = window.setTimeout(run, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (interval) window.clearInterval(interval);
    };
  }, [isMobile, isHome, location.pathname, queryClient]);

  return null;
}
