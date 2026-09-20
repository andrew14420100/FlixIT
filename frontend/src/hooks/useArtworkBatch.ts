// @ts-nocheck
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MEDIA_ASSET_QUALITY_VERSION,
  mediaTypeSlug,
  buildMediaAssetFallback,
  mergeOfficialArtwork,
} from "./useAutomaticMediaAssets";

const SC_CATALOG_URL = "/sc-artwork-catalog.json";
const SC_CDN_BASE = "https://cdn.streamingcommunityz.ninja/images/";
const STATIC_CATALOG_KEY = ["sc-artwork-static-catalog", "v2-full-api"];

type NormalizedEntry = {
  item: any;
  id: number;
  type: "movie" | "tv";
  key: string;
};

type CatalogIndex = {
  count: number;
  byTitle: Map<string, any[]>;
};

let catalogPromise: Promise<CatalogIndex> | null = null;
let catalogMemory: CatalogIndex | null = null;

function normalizeText(value: any) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYear(value: any) {
  const match = String(value || "").match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function normalizeItem(item: any): NormalizedEntry | null {
  const id = Number(item?.id || item?.tmdbId || item?.tmdb_id || 0);
  if (!id) return null;
  const type = mediaTypeSlug(item?.media_type || item?.type, item) === "tv" ? "tv" : "movie";
  return { item, id, type, key: `${type}:${id}` };
}

function uniqueItems(items: any[]) {
  const seen = new Set<string>();
  const out: NormalizedEntry[] = [];
  for (const item of items || []) {
    const entry = normalizeItem(item);
    if (!entry || seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push(entry);
  }
  return out;
}

function titleVariants(item: any) {
  const raw = [
    item?.title,
    item?.name,
    item?.original_title,
    item?.original_name,
  ].filter(Boolean);
  const out = new Set<string>();
  raw.forEach((value) => {
    const text = String(value || "").trim();
    if (!text) return;
    [
      text,
      text.split(/[:|–—]/, 1)[0],
      text.replace(/\([^)]*\)/g, " "),
      text.replace(/\b(?:il|lo|la|i|gli|le|un|uno|una)\b/gi, " "),
    ].forEach((candidate) => {
      const normalized = normalizeText(candidate);
      if (normalized) out.add(normalized);
    });
  });
  return [...out];
}

function rowAliases(row: any) {
  const values = [row?.name, row?.title, row?.slug];
  const out = new Set<string>();
  values.forEach((value) => {
    const text = String(value || "").trim();
    if (!text) return;
    [text, text.replace(/-/g, " "), text.replace(/\([^)]*\)/g, " ")].forEach((candidate) => {
      const normalized = normalizeText(candidate);
      if (normalized) out.add(normalized);
    });
  });
  return [...out];
}

function buildIndex(payload: any): CatalogIndex {
  const rows = Array.isArray(payload?.titles) ? payload.titles : [];
  const byTitle = new Map<string, any[]>();
  rows.forEach((row: any) => {
    rowAliases(row).forEach((key) => {
      const bucket = byTitle.get(key) || [];
      bucket.push(row);
      byTitle.set(key, bucket);
    });
  });
  return { count: Number(payload?.count || rows.length || 0), byTitle };
}

async function loadCatalog(): Promise<CatalogIndex> {
  if (catalogMemory) return catalogMemory;
  if (catalogPromise) return catalogPromise;

  const preloaded = typeof window !== "undefined"
    ? (window as any).__FLIXIT_SC_CATALOG_PROMISE__
    : null;

  const payloadPromise = preloaded
    ? Promise.resolve(preloaded)
    : fetch(SC_CATALOG_URL, {
        cache: "no-cache",
        headers: { Accept: "application/json" },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`SC catalog ${response.status}`);
        return response.json();
      });

  catalogPromise = payloadPromise
    .then((payload: any) => {
      const index = buildIndex(payload);
      catalogMemory = index;
      return index;
    })
    .catch(() => {
      const empty = { count: 0, byTitle: new Map<string, any[]>() };
      catalogMemory = empty;
      return empty;
    });

  return catalogPromise;
}

function recordType(row: any) {
  const raw = String(row?.type || "").toLowerCase();
  if (raw === "tv" || raw.includes("serie") || raw.includes("show")) return "tv";
  if (raw === "movie" || raw.includes("film")) return "movie";
  return null;
}

function bestRecord(entry: NormalizedEntry, index: CatalogIndex) {
  const variants = titleVariants(entry.item);
  const candidates: any[] = [];
  const seen = new Set<any>();

  variants.forEach((variant) => {
    (index.byTitle.get(variant) || []).forEach((row) => {
      if (!seen.has(row)) {
        seen.add(row);
        candidates.push(row);
      }
    });
  });
  if (!candidates.length) return null;

  const expectedYear = extractYear(
    entry.item?.release_date || entry.item?.first_air_date || entry.item?.year
  );

  return candidates
    .map((row) => {
      let score = 0;
      const type = recordType(row);
      if (type) score += type === entry.type ? 30 : -40;
      const rowYear = extractYear(row?.year);
      if (expectedYear && rowYear) {
        if (expectedYear === rowYear) score += 15;
        else if (Math.abs(expectedYear - rowYear) === 1) score += 4;
        else score -= 8;
      }
      const images = row?.images || {};
      if (images.cover || images.cover_desktop) score += 20;
      if (images.cover_mobile) score += 8;
      if (images.background) score += 4;
      if (images.logo) score += 3;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.row || null;
}

function cdnUrl(value: any) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SC_CDN_BASE}${raw.replace(/^\/+/, "")}`;
}

function role(images: any, keys: string[]) {
  for (const key of keys) {
    const value = cdnUrl(images?.[key]);
    if (value) return value;
  }
  return null;
}

function officialFromCatalog(entry: NormalizedEntry, row: any, catalogSize: number) {
  if (!row) return null;
  const images = row?.images || {};

  // SC "cover" is the merchandised horizontal card artwork with the title/logo
  // already baked in. Never substitute the clean background as a static card.
  const landscape = role(images, ["cover", "cover_desktop", "card", "cover_mobile"]);
  const poster = role(images, ["cover_mobile", "cover", "poster", "poster_mobile"]);
  if (!landscape && !poster) return null;

  const card = landscape || poster;
  const ranked = poster || landscape;
  const background = role(images, ["background", "backdrop", "hero", "wallpaper"]) || card;
  const logo = role(images, ["logo", "title_logo", "title-treatment", "title_treatment"]);

  return {
    active: true,
    type: entry.type,
    tmdbId: entry.id,
    title: entry.item?.title || entry.item?.name || row?.name || "",
    backdrop_url: card,
    poster_url: ranked,
    hero_backdrop_url: background,
    detail_backdrop_url: background,
    logo_url: logo,
    backdrop_source: "streamingcommunity",
    poster_source: "streamingcommunity",
    hero_backdrop_source: "streamingcommunity",
    logo_source: logo ? "streamingcommunity" : null,
    backdrop_locale: "it",
    poster_locale: "it",
    hero_backdrop_locale: "it",
    logo_locale: logo ? "it" : null,
    backdrop_embedded_title_treatment: !!card,
    poster_embedded_title_treatment: !!ranked,
    hero_embedded_title_treatment: background === card || background === ranked,
    embedded_title_treatment: !!card,
    landscape_card_ready: !!card,
    poster_card_ready: !!ranked,
    card_ready: !!card,
    top10_ready: !!ranked,
    complete: !!card && !!ranked,
    sc_cover_imported: true,
    sc_catalog_hit: true,
    sc_catalog_size: catalogSize,
    sc_provider_id: row?.id || row?.slug || null,
    sc_provider_name: row?.name || null,
    version: "official-artwork-v13-full-static-sc-catalog",
  };
}

export default function useArtworkBatch(items: any[] = [], enabled = true) {
  const queryClient = useQueryClient();
  const normalized = useMemo(() => uniqueItems(items), [items]);

  const catalogQuery = useQuery({
    queryKey: STATIC_CATALOG_KEY,
    queryFn: loadCatalog,
    enabled: !!enabled && normalized.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const data = useMemo(() => {
    const index = catalogQuery.data;
    if (!index || !index.count) return [];
    return normalized
      .map((entry) => officialFromCatalog(entry, bestRecord(entry, index), index.count))
      .filter(Boolean);
  }, [catalogQuery.data, normalized]);

  const byKey = useMemo(() => {
    const map = new Map<string, any>();
    data.forEach((raw: any) => {
      const id = Number(raw?.tmdbId || raw?.tmdb_id || 0);
      const type = raw?.type === "tv" ? "tv" : "movie";
      if (id) map.set(`${type}:${id}`, raw);
    });
    return map;
  }, [data]);

  useEffect(() => {
    if (!data.length) return;
    normalized.forEach((entry) => {
      const official = byKey.get(entry.key);
      if (!official) return;
      const fallback = buildMediaAssetFallback(entry.item, entry.type);
      queryClient.setQueryData(
        ["media-assets", MEDIA_ASSET_QUALITY_VERSION, entry.type, entry.id],
        mergeOfficialArtwork(fallback, official)
      );
    });
  }, [data, byKey, normalized, queryClient]);

  const getResolved = (item: any) => {
    const entry = normalizeItem(item);
    if (!entry) return null;
    const fallback = buildMediaAssetFallback(item, entry.type);
    const official = byKey.get(entry.key);
    return official ? mergeOfficialArtwork(fallback, official) : fallback;
  };

  const isReady = (item: any, targetRole: "landscape" | "poster" = "landscape") => {
    const resolved = getResolved(item);
    if (!resolved) return false;
    return targetRole === "poster" ? !!resolved.top10_ready : !!resolved.card_ready;
  };

  return {
    data,
    byKey,
    getResolved,
    isReady,
    count: normalized.length,
    catalogCount: Number(catalogQuery.data?.count || 0),
    isPending: catalogQuery.isPending && !data.length,
    isFetching: catalogQuery.isFetching,
    primaryPending: catalogQuery.isPending,
    backgroundPending: false,
    error: catalogQuery.error,
  };
}
