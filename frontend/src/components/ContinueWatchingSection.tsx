// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { useHomeDedupe, itemKey } from "src/store/homeDedupe";
import HomepageSlider from "./HomepageSlider";

const formatMinutes = (s) => `${Math.max(1, Math.round((s || 0) / 60))}`;
const DEDUPE_KEY = "continue-watching";
const DEDUPE_INDEX = -50;
const CATALOG_URL = "/sc-artwork-catalog.json";

function normalize(value: any) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeType(value: any) {
  const raw = String(value || "").toLowerCase();
  return raw === "tv" || raw.includes("serie") || raw.includes("show") ? "tv" : "movie";
}

function absoluteAsset(value: any, cdnBase: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${cdnBase.replace(/\/+$/, "")}/${raw.replace(/^\/+/, "")}`;
}

type PosterBucket = { movie?: string; tv?: string; any?: string };
type ContinuePosterIndex = {
  byTmdb: Map<string, string>;
  byTitle: Map<string, PosterBucket>;
};

let continuePosterIndexPromise: Promise<ContinuePosterIndex> | null = null;

function loadContinuePosterIndex(): Promise<ContinuePosterIndex> {
  if (continuePosterIndexPromise) return continuePosterIndexPromise;

  continuePosterIndexPromise = fetch(CATALOG_URL, {
    cache: "force-cache",
    headers: { Accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`SC catalog ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      const rows = Array.isArray(payload?.titles) ? payload.titles : [];
      const cdnBase = String(payload?.cdn_base_url || "https://cdn.streamingunity.win/images/");
      const byTmdb = new Map<string, string>();
      const byTitle = new Map<string, PosterBucket>();

      rows.forEach((row: any) => {
        const images = row?.images || {};
        // Continue Watching must use a genuine vertical SC poster only.
        const poster = absoluteAsset(images.poster || images.poster_mobile, cdnBase);
        if (!poster) return;

        const type = normalizeType(row?.type);
        const tmdbId = Number(
          row?.tmdb_id || row?.tmdbId || row?.ids?.tmdbId || row?.ids?.tmdb_id || 0
        );
        if (tmdbId) byTmdb.set(`${type}:${tmdbId}`, poster);

        [
          row?.name,
          row?.title,
          row?.original_title,
          row?.original_name,
          row?.slug?.replace(/-/g, " "),
        ].forEach((alias) => {
          const key = normalize(alias);
          if (!key) return;
          const bucket = byTitle.get(key) || {};
          if (!bucket[type]) bucket[type] = poster;
          if (!bucket.any) bucket.any = poster;
          byTitle.set(key, bucket);
        });
      });

      return { byTmdb, byTitle };
    })
    .catch(() => ({ byTmdb: new Map(), byTitle: new Map() }));

  return continuePosterIndexPromise;
}

function resolvePoster(index: ContinuePosterIndex | null, item: any) {
  if (!index) return "";
  const type = normalizeType(item?.media_type || item?.type);
  const tmdbId = Number(item?.tmdb_id || item?.tmdbId || item?.id || 0);
  if (tmdbId) {
    const exact = index.byTmdb.get(`${type}:${tmdbId}`);
    if (exact) return exact;
  }

  const bucket = index.byTitle.get(normalize(item?.title || item?.name));
  if (!bucket) return "";
  return bucket[type] || bucket.any || "";
}

export default function ContinueWatchingSection() {
  const { items, username, removeItem } = useContinueWatching();
  const claim = useHomeDedupe((state) => state.claim);
  const release = useHomeDedupe((state) => state.release);
  const [posterIndex, setPosterIndex] = useState<ContinuePosterIndex | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadContinuePosterIndex().then((index) => {
      if (!cancelled) setPosterIndex(index);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sliderItems = useMemo(() => {
    if (!posterIndex) return [];

    return items
      .filter((item) => {
        const duration = Number(item?.duration || 0);
        const progress = Number(item?.progress || 0);
        return !duration || progress / duration < 0.95;
      })
      .map((item) => {
        const scPoster = resolvePoster(posterIndex, item);
        if (!scPoster) return null;

        return {
          tmdbId: item.tmdb_id,
          id: item.tmdb_id,
          type: item.media_type,
          media_type: item.media_type,
          title: item.title,
          name: item.title,
          // Keep the historical artwork for desktop behaviour, but provide the
          // mobile card with an explicit, verified SC poster so no cover can win.
          backdrop_path: item.backdrop_path,
          poster_path: item.poster_path,
          mobile_sc_poster_url: scPoster,
          poster_source: "streamingcommunity",
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
            minutesLabel: `${formatMinutes(item.progress)} di ${formatMinutes(
              item.duration
            )} min`,
            onRemove: () => removeItem(item.tmdb_id),
          },
        };
      })
      .filter(Boolean);
  }, [items, removeItem, posterIndex]);

  const idsKey = useMemo(
    () => sliderItems.map(itemKey).filter(Boolean).join("|"),
    [sliderItems]
  );

  useEffect(() => {
    if (idsKey) claim(DEDUPE_KEY, DEDUPE_INDEX, idsKey.split("|"));
    else release(DEDUPE_KEY);
    return () => release(DEDUPE_KEY);
  }, [idsKey, claim, release]);

  if (sliderItems.length === 0) return null;

  const title = username
    ? `${username}, continua a guardare:`
    : "Continua a guardare:";

  return (
    <HomepageSlider
      rowId="continua"
      title={title}
      items={sliderItems}
      compactSpacing
    />
  );
}
