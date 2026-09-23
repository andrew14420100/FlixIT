// @ts-nocheck
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import ReplayIcon from "@mui/icons-material/Replay";

import useOffSetTop from "src/hooks/useOffSetTop";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useGetAppendedVideosQuery } from "src/store/slices/discover";
import { useHeroData } from "src/hooks/useHeroData";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import useAutomaticMediaAssets, { tmdbImageUrl } from "src/hooks/useAutomaticMediaAssets";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import TrailerPlayer from "./TrailerPlayer";
import "./NetflixHeroExact.css";

const DEFAULT_FEATURED_ID = 202208;
const DEFAULT_FEATURED_TYPE = MEDIA_TYPE.Tv;
const TRAILER_DELAY_MS = 2000;
const STREAM_CACHE_PREFIX = "watch_stream_cache:";
const TMDB_HERO_LOGO_BASE = "https://image.tmdb.org/t/p/original";

function firstValue(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function heroLogoUrl(value: any) {
  const raw =
    typeof value === "string"
      ? value
      : typeof value?.url === "string"
      ? value.url
      : "";
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text) || text.startsWith("data:") || text.startsWith("blob:")) {
    return text;
  }
  // The public Hero endpoint already returns the official TMDB title-logo path
  // when one exists. Card artwork intentionally rejects TMDB imagery, but the
  // Hero title treatment is a separate identity asset and must not disappear
  // just because its path is relative.
  if (text.startsWith("/")) return `${TMDB_HERO_LOGO_BASE}${text}`;
  return null;
}

function firstHeroLogo(...values: any[]) {
  for (const value of values) {
    const resolved = heroLogoUrl(value);
    if (resolved) return resolved;
  }
  return null;
}

function cachePrefetchedStream(typeSlug: string, id: number, data: any) {
  if (!data?.success || !data?.stream || typeof window === "undefined") return;
  const season = typeSlug === "tv" ? 1 : 0;
  const episode = typeSlug === "tv" ? 1 : 0;
  const logicalKey = `${typeSlug}:${id}:${season}:${episode}`;
  const now = Date.now();

  try {
    sessionStorage.setItem(
      STREAM_CACHE_PREFIX + logicalKey,
      JSON.stringify({
        stream: data.stream,
        type: data.type || "hls",
        source: data.source,
        savedAt: now,
      })
    );

    const legacyPayload = JSON.stringify({ data, ts: now, timestamp: now });
    [
      `stream:${typeSlug}:${id}:${season}:${episode}`,
      `stream_${typeSlug}_${id}_${season}_${episode}`,
      `stream-${typeSlug}-${id}-${season}-${episode}`,
    ].forEach((key) => sessionStorage.setItem(key, legacyPayload));
  } catch {}
}

function initialHeroLogo(hero: any) {
  return firstHeroLogo(
    hero?.assets?.logo_path,
    hero?.assets?.logo_url,
    hero?.assets?.fallback_logo_path,
    hero?.logo_path,
    hero?.logoUrl,
    hero?.detail?.netflix_logo_url,
    hero?.detail?.logo_path
  );
}

function normalizeGenreNames(detail: any, assets: any) {
  const candidates = [detail?.genres, assets?.genres, assets?.genre_names, assets?.genreNames];
  for (const value of candidates) {
    if (!value) continue;

    if (Array.isArray(value)) {
      const names = value
        .map((entry: any) => (typeof entry === "string" ? entry : entry?.name))
        .filter(Boolean);
      if (names.length) return names;
    }

    if (typeof value === "string") {
      const names = value
        .split(/[|,•]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (names.length) return names;
    }
  }

  return [];
}

function yearFromDetail(detail: any) {
  const raw = firstValue(
    detail?.first_air_date,
    detail?.release_date,
    detail?.air_date,
    detail?.year
  );
  if (!raw) return "";

  const match = String(raw).match(/\d{4}/);
  return match?.[0] || "";
}

function runtimeLabel(detail: any) {
  const runtime = Number(firstValue(detail?.runtime, detail?.episode_run_time?.[0], 0));
  if (!runtime) return "";
  if (runtime < 60) return `${runtime} min`;

  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function certificationFromDetail(detail: any, hero: any, assets: any) {
  const direct = firstValue(
    hero?.certification,
    hero?.age,
    hero?.contentRating,
    detail?.certification,
    detail?.content_rating,
    detail?.contentRating,
    assets?.certification,
    assets?.content_rating,
    assets?.contentRating
  );
  if (direct) return String(direct);

  const ratings = detail?.content_ratings?.results;
  if (Array.isArray(ratings)) {
    const preferred =
      ratings.find((entry: any) => entry?.iso_3166_1 === "IT") ||
      ratings.find((entry: any) => entry?.iso_3166_1 === "US") ||
      ratings.find((entry: any) => entry?.rating);
    if (preferred?.rating) return String(preferred.rating);
  }

  const releases = detail?.release_dates?.results;
  if (Array.isArray(releases)) {
    const preferred =
      releases.find((entry: any) => entry?.iso_3166_1 === "IT") ||
      releases.find((entry: any) => entry?.iso_3166_1 === "US") ||
      releases[0];

    const certification = preferred?.release_dates?.find(
      (entry: any) => entry?.certification
    )?.certification;

    if (certification) return String(certification);
  }

  return "";
}

function normalizeAge(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{1,2}$/.test(text)) return `${text}+`;
  return text;
}

function normalizeCallouts(...values: any[]) {
  for (const value of values) {
    if (!value) continue;

    if (Array.isArray(value)) {
      const texts = value
        .map((entry: any) =>
          typeof entry === "string"
            ? entry
            : firstValue(entry?.text, entry?.label, entry?.title)
        )
        .filter(Boolean)
        .map(String);

      if (texts.length) return texts.slice(0, 2);
    }

    if (typeof value === "string") return [value];
  }

  return [];
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.2 3.2a1 1 0 0 1 1.51-.86l12.1 8.1a1.86 1.86 0 0 1 0 3.12l-12.1 8.1A1 1 0 0 1 6.2 20.8z"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 10.6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="7.3" r="1.15" fill="currentColor" />
    </svg>
  );
}

function NetflixNMark() {
  return (
    <svg viewBox="0 0 24 36" aria-hidden="true">
      <path fill="#b20710" d="M2 0h6v36H2zM16 0h6v36h-6z" />
      <path fill="#e50914" d="M8 0h6l8 36h-6z" />
    </svg>
  );
}

export default function HeroSection({ mediaType: _mediaType, initialHero = null }) {
  const navigate = useNavigate();
  const { data: heroSettings, isLoading: heroLoading } = useHeroData(initialHero);
  const { getProgress } = useContinueWatching();

  const featuredId = useMemo(
    () =>
      heroSettings?.contentId
        ? parseInt(heroSettings.contentId)
        : DEFAULT_FEATURED_ID,
    [heroSettings?.contentId]
  );

  const featuredMediaType = useMemo(() => {
    if (heroSettings?.mediaType) {
      return heroSettings.mediaType === "movie"
        ? MEDIA_TYPE.Movie
        : MEDIA_TYPE.Tv;
    }

    return DEFAULT_FEATURED_TYPE;
  }, [heroSettings?.mediaType]);

  const typeSlug =
    featuredMediaType === MEDIA_TYPE.Movie ? "movie" : "tv";

  const skipQueries = heroLoading || !featuredId;
  const inlineDetail =
    heroSettings?.detail?.id === featuredId ? heroSettings.detail : null;
  const inlineAssets = heroSettings?.assets || null;

  const { data: fetchedDetail } = useGetAppendedVideosQuery(
    { mediaType: featuredMediaType, id: featuredId },
    { skip: skipQueries || !!inlineDetail }
  );

  const detailData = inlineDetail || fetchedDetail;

  const automaticAssets = useAutomaticMediaAssets(
    {
      id: featuredId,
      type: typeSlug,
      title:
        detailData?.name ||
        detailData?.title ||
        heroSettings?.customTitle ||
        "",
      original_title:
        detailData?.original_name ||
        detailData?.original_title ||
        "",
    },
    featuredMediaType,
    !skipQueries
  );

  const assets = useMemo(
    () => ({
      ...(automaticAssets || {}),
      ...(inlineAssets || {}),
      logo_path:
        automaticAssets?.logo_path ||
        automaticAssets?.fallback_logo_path ||
        inlineAssets?.logo_path ||
        inlineAssets?.logo_url ||
        inlineAssets?.fallback_logo_path ||
        null,
      fallback_logo_path:
        inlineAssets?.logo_path ||
        inlineAssets?.logo_url ||
        inlineAssets?.fallback_logo_path ||
        automaticAssets?.fallback_logo_path ||
        null,
      backdrop_path:
        inlineAssets?.backdrop_path ||
        automaticAssets?.backdrop_path ||
        null,
      titled_backdrop_path:
        inlineAssets?.titled_backdrop_path ||
        automaticAssets?.titled_backdrop_path ||
        null,
      hero_backdrop_path:
        inlineAssets?.hero_backdrop_path ||
        automaticAssets?.hero_backdrop_path ||
        null,
      detail_backdrop_path:
        inlineAssets?.detail_backdrop_path ||
        automaticAssets?.detail_backdrop_path ||
        null,
    }),
    [automaticAssets, inlineAssets]
  );

  const resolvedTrailer = useResolvedTrailer(
    featuredMediaType,
    featuredId,
    !skipQueries
  );
  const trailerKey = resolvedTrailer.url;

  const [muted, setMuted] = useState(true);
  const [trailerGateOpen, setTrailerGateOpen] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [infoTarget, setInfoTarget] = useState(false);
  const [heroImageSrc, setHeroImageSrc] = useState<string | null>(null);
  const [heroLogoSrc, setHeroLogoSrc] = useState<string | null>(
    () => initialHeroLogo(initialHero)
  );
  const [heroLogoFailed, setHeroLogoFailed] = useState(false);

  const isOffset = useOffSetTop(
    typeof window !== "undefined" ? window.innerHeight * 0.6 : 600
  );

  const logoPath = firstHeroLogo(
    automaticAssets?.logo_path,
    automaticAssets?.fallback_logo_path,
    inlineAssets?.logo_path,
    inlineAssets?.logo_url,
    inlineAssets?.fallback_logo_path,
    heroSettings?.logo_path,
    heroSettings?.logoUrl,
    detailData?.netflix_logo_url,
    detailData?.logo_path,
    assets?.logo_path
  );
  const fallbackLogoPath = firstHeroLogo(
    inlineAssets?.logo_path,
    inlineAssets?.logo_url,
    inlineAssets?.fallback_logo_path,
    automaticAssets?.fallback_logo_path,
    detailData?.logo_path,
    detailData?.netflix_logo_url
  );

  const backdropUrl = useMemo(() => {
    if (heroSettings?.customBackdrop) return heroSettings.customBackdrop;

    return tmdbImageUrl(
      assets?.hero_backdrop_path ||
        assets?.backdrop_path ||
        detailData?.backdrop_path ||
        assets?.detail_backdrop_path ||
        assets?.titled_backdrop_path,
      "original"
    );
  }, [
    heroSettings?.customBackdrop,
    assets?.hero_backdrop_path,
    assets?.backdrop_path,
    assets?.detail_backdrop_path,
    assets?.titled_backdrop_path,
    detailData?.backdrop_path,
  ]);

  const fallbackBackdropUrl = useMemo(
    () => tmdbImageUrl(assets?.fallback_backdrop_path, "original"),
    [assets?.fallback_backdrop_path]
  );

  useEffect(() => {
    setHeroImageSrc(backdropUrl);
    setImageLoaded(false);
  }, [backdropUrl]);

  useEffect(() => {
    setHeroLogoSrc(logoPath || fallbackLogoPath || null);
    setHeroLogoFailed(false);
  }, [logoPath, fallbackLogoPath, featuredId]);

  const displayTitle =
    heroSettings?.customTitle ||
    detailData?.name ||
    detailData?.title ||
    assets?.title ||
    "";

  const displayDescription =
    heroSettings?.customDescription ||
    detailData?.overview ||
    "";

  const seasonLabel = heroSettings?.seasonLabel || "";

  const attributes = useMemo(() => {
    const genres = normalizeGenreNames(detailData, assets);
    const year = yearFromDetail(detailData);
    const age = normalizeAge(
      certificationFromDetail(detailData, heroSettings, assets)
    );

    let duration = seasonLabel;

    if (!duration && typeSlug === "tv") {
      const seasons = Number(
        firstValue(
          detailData?.number_of_seasons,
          detailData?.seasons_count,
          0
        )
      );

      if (seasons) {
        duration = `${seasons} ${seasons === 1 ? "stagione" : "stagioni"}`;
      }
    }

    if (!duration && typeSlug === "movie") {
      duration = runtimeLabel(detailData);
    }

    return [
      { text: typeSlug === "tv" ? "Serie" : "Film" },
      genres[0] ? { text: genres[0] } : null,
      year ? { text: year } : null,
      duration ? { text: duration } : null,
      age ? { text: age, age: true } : null,
    ].filter(Boolean);
  }, [
    detailData,
    assets,
    heroSettings,
    seasonLabel,
    typeSlug,
  ]);

  const callouts = useMemo(() => {
    const explicit = normalizeCallouts(
      heroSettings?.callouts,
      heroSettings?.heroCallouts,
      detailData?.callouts,
      assets?.callouts
    );

    if (explicit.length) return explicit;

    const derived: string[] = [];

    if (detailData?.next_episode_to_air) {
      derived.push("Nuovi episodi in arrivo");
    }

    const weeks = Number(
      firstValue(
        heroSettings?.top10Weeks,
        detailData?.top10_weeks,
        detailData?.weeks_in_top10,
        assets?.top10Weeks,
        0
      )
    );

    if (weeks > 0) {
      derived.push(
        `${weeks} ${weeks === 1 ? "settimana" : "settimane"} nella Top 10`
      );
    }

    if (!derived.length) {
      derived.push("Disponibile ora");
      derived.push(typeSlug === "tv" ? "Serie" : "Film");
    }

    return derived.slice(0, 2);
  }, [heroSettings, detailData, assets, typeSlug]);

  useEffect(() => {
    setTrailerGateOpen(false);
    setVideoEnded(false);
    setVideoPlaying(false);
    setInfoTarget(false);
    setMuted(true);

    const timer = window.setTimeout(
      () => setTrailerGateOpen(true),
      TRAILER_DELAY_MS
    );

    return () => window.clearTimeout(timer);
  }, [featuredId, typeSlug]);

  const videoMounted = !!trailerKey && !videoEnded;
  const videoShouldPlay =
    trailerGateOpen && !!trailerKey && !videoEnded && !isOffset;
  const videoActive = videoShouldPlay && videoPlaying;

  const handleVideoEnded = useCallback(() => {
    setVideoEnded(true);
    setVideoPlaying(false);
    setInfoTarget(false);
  }, []);

  const handleVideoPlaying = useCallback(() => {
    setVideoPlaying(true);
    setInfoTarget(true);
  }, []);

  const handleReplay = useCallback(() => {
    setVideoEnded(false);
    setVideoPlaying(false);
    setInfoTarget(false);
    setTrailerGateOpen(false);

    window.setTimeout(() => {
      setTrailerGateOpen(true);
    }, 60);
  }, []);

  const prefetchedRef = useRef("");

  useEffect(() => {
    prefetchedRef.current = "";
  }, [featuredId, typeSlug]);

  const prefetchStream = useCallback(() => {
    const identity = `${typeSlug}:${featuredId}`;

    if (!featuredId || prefetchedRef.current === identity) return;
    prefetchedRef.current = identity;

    const url =
      typeSlug === "tv"
        ? `/api/player/tv/${featuredId}/1/1`
        : `/api/player/movie/${featuredId}`;

    fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      })
      .then((data) => cachePrefetchedStream(typeSlug, featuredId, data))
      .catch(() => {
        prefetchedRef.current = "";
      });
  }, [typeSlug, featuredId]);

  const handlePlay = () => {
    const progress = getProgress(featuredId);
    const startTime = progress?.progress
      ? Math.floor(progress.progress)
      : 0;

    navigate(
      `/${MAIN_PATH.watch}/${typeSlug}/${featuredId}${
        startTime > 0 ? `?t=${startTime}` : ""
      }`
    );
  };

  const handleMoreInfo = () => {
    navigate(`/${MAIN_PATH.browse}/${typeSlug}/${featuredId}`);
  };

  return (
    <Box
      component="section"
      data-uia="billboard"
      aria-label={`Contenuti consigliati: ${displayTitle}`}
      data-testid="hero-section"
      data-compact={infoTarget ? "true" : "false"}
      className="netflix-home-billboard"
    >
      {heroImageSrc ? (
        <Box
          component="img"
          src={heroImageSrc}
          alt=""
          aria-hidden="true"
          data-uia="billboard-background-media+image"
          data-testid="hero-backdrop"
          className="netflix-home-backdrop"
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            if (
              fallbackBackdropUrl &&
              heroImageSrc !== fallbackBackdropUrl
            ) {
              setHeroImageSrc(fallbackBackdropUrl);
              setImageLoaded(false);
            } else {
              setHeroImageSrc(null);
            }
          }}
          fetchPriority="high"
          loading="eager"
          decoding="async"
          sx={{
            opacity: imageLoaded
              ? videoActive
                ? 0
                : 1
              : 0,
            transition: "opacity 420ms ease-in-out",
          }}
        />
      ) : null}

      {videoMounted ? (
        <Box
          data-uia="billboard-background-media+player"
          data-testid="hero-trailer"
          className="netflix-home-video-layer"
          sx={{
            opacity: videoActive ? 1 : 0,
            transition: "opacity 420ms ease-in-out",
            pointerEvents: "none",
          }}
        >
          <TrailerPlayer
            videoKey={trailerKey}
            muted={muted}
            playing={videoShouldPlay}
            loop={false}
            zoom={1}
            onEnded={handleVideoEnded}
            onPlaying={handleVideoPlaying}
          />
        </Box>
      ) : null}

      <Box aria-hidden="true" className="netflix-home-shade" />

      <Box
        aria-hidden="true"
        className="netflix-home-brand-mark"
      >
        <NetflixNMark />
      </Box>

      {trailerKey ? (
        <Box
          className="netflix-home-volume-wrap"
          data-uia="billboard-controls"
          data-testid="hero-controls"
        >
          {videoEnded ? (
            <IconButton
              aria-label="Riproduci di nuovo il trailer"
              onClick={handleReplay}
              className="netflix-home-replay-button"
            >
              <ReplayIcon />
            </IconButton>
          ) : (
            <IconButton
              aria-label={
                muted ? "Volume disattivato" : "Volume attivato"
              }
              onClick={() => setMuted((value) => !value)}
              data-testid="hero-audio-toggle"
              className="netflix-home-volume-button"
            >
              {muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
            </IconButton>
          )}
        </Box>
      ) : null}

      <Box
        className="netflix-home-content"
        data-testid="hero-content"
      >
        <Box
          className="netflix-home-title-block"
          data-uia="billboard-title"
        >
          {heroLogoSrc ? (
            <Box
              component="img"
              src={heroLogoSrc}
              alt={displayTitle}
              data-uia="billboard-logo"
              data-testid="hero-logo"
              className="netflix-home-logo"
              fetchPriority="high"
              loading="eager"
              decoding="async"
              onError={() => {
                if (
                  fallbackLogoPath &&
                  heroLogoSrc !== fallbackLogoPath
                ) {
                  setHeroLogoSrc(fallbackLogoPath);
                } else {
                  setHeroLogoFailed(true);
                  setHeroLogoSrc(null);
                }
              }}
            />
          ) : heroLogoFailed || displayTitle ? (
            <Box
              className="netflix-home-title-fallback"
              data-testid="hero-title-fallback"
            >
              {displayTitle}
            </Box>
          ) : null}

          {attributes.length ? (
            <Box
              className="netflix-home-attributes"
              data-uia="attributes-elements"
            >
              {attributes.map(
                (attribute: any, index: number) => (
                  <Box
                    key={`${attribute.text}-${index}`}
                    sx={{ display: "contents" }}
                  >
                    {index > 0 ? (
                      <span
                        className="netflix-home-attribute-dot"
                        aria-hidden="true"
                      >
                        •
                      </span>
                    ) : null}

                    <span
                      className={
                        attribute.age
                          ? "netflix-home-attribute netflix-home-age"
                          : "netflix-home-attribute"
                      }
                    >
                      {attribute.text}
                    </span>
                  </Box>
                )
              )}
            </Box>
          ) : null}
        </Box>

        <Box
          className="netflix-home-metadata"
          data-uia="billboard-metadata"
          data-testid="hero-overview"
        >
          {displayDescription}
        </Box>

        <Box className="netflix-home-actions-row">
          <Box
            className="netflix-home-actions"
            data-uia="billboard-actions"
          >
            <Box
              component="button"
              type="button"
              aria-label="Riproduci"
              data-uia="play-video-button"
              data-testid="hero-play-button"
              className="netflix-home-action netflix-home-action-play"
              onClick={handlePlay}
              onMouseEnter={prefetchStream}
              onFocus={prefetchStream}
            >
              <PlayIcon />
              <span>Riproduci</span>
            </Box>

            <Box
              component="button"
              type="button"
              data-uia="billboard-more-info"
              data-testid="hero-info-button"
              className="netflix-home-action netflix-home-action-info"
              onClick={handleMoreInfo}
            >
              <InfoIcon />
              <span>Altre info</span>
            </Box>
          </Box>

          <Box
            className="netflix-home-callouts"
            data-uia="billboard-callouts"
          >
            {callouts.map((text, index) => (
              <Box
                className="netflix-home-callout"
                data-uia="billboard-callout"
                key={`${text}-${index}`}
              >
                <span className="netflix-home-callout-mark">
                  {/top\s*10/i.test(text)
                    ? "10"
                    : index === 0
                    ? "◢"
                    : "N"}
                </span>
                <span>{text}</span>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
