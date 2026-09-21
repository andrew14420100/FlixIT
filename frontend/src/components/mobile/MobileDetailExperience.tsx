// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";

import {
  useLazyGetAppendedVideosQuery,
  useLazyGetTVSeasonDetailsQuery,
  useLazyGetVideosByMediaTypeAndGenreIdQuery,
} from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useAvailableItems } from "src/hooks/useAvailability";
import useAutomaticMediaAssets from "src/hooks/useAutomaticMediaAssets";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import useArtworkBatch from "src/hooks/useArtworkBatch";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { getMediaImageUrl } from "src/hooks/useCDNImage";
import TrailerPlayer from "src/components/TrailerPlayer";

const MOBILE_QUERY = "(max-width:899px)";
const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const TRAILER_DELAY = 5000;

function parseDetailPath(pathname: string) {
  const match = pathname.match(/^\/(?:detail|browse)\/(movie|tv)\/(\d+)(?:\/|$)/i);
  if (!match) return null;
  return { typeSlug: match[1].toLowerCase() === "tv" ? "tv" : "movie", id: Number(match[2]) || 0 };
}

function firstRemote(...values: any[]) {
  for (const value of values) {
    const raw = typeof value === "string" ? value : value?.url;
    const text = String(raw || "").trim();
    if (!text) continue;
    if (/^https?:\/\//i.test(text) || text.startsWith("data:") || text.startsWith("blob:")) return text;
  }
  return null;
}

function yearFrom(detail: any) {
  const value = detail?.release_date || detail?.first_air_date || detail?.year || "";
  return String(value || "").slice(0, 4);
}

function runtimeText(detail: any, isTV: boolean) {
  if (isTV) {
    const count = Number(detail?.number_of_seasons || 0);
    if (!count) return "Serie TV";
    return `${count} ${count === 1 ? "stagione" : "stagioni"}`;
  }
  const minutes = Number(detail?.runtime || 0);
  if (!minutes) return "Film";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${minutes}m`;
}

function formatPosition(seconds: any) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function playbackProfile(payload: any) {
  const qualityRaw = [
    payload?.quality,
    payload?.quality_label,
    payload?.resolution,
    payload?.video_quality,
    payload?.stream_quality,
    payload?.stream?.quality,
    payload?.stream?.resolution,
  ].map((value) => String(value || "")).join(" ");

  let quality = null;
  if (/4k|2160/i.test(qualityRaw)) quality = "4K";
  else if (/1440/i.test(qualityRaw)) quality = "1440p";
  else if (/1080|full\s*hd/i.test(qualityRaw)) quality = "Full HD";
  else if (/720|\bhd\b/i.test(qualityRaw)) quality = "HD";

  const hdrRaw = [
    payload?.hdr,
    payload?.hdr_format,
    payload?.video_range,
    payload?.dynamic_range,
    payload?.stream?.hdr,
    payload?.stream?.video_range,
  ].map((value) => String(value || "")).join(" ");

  let hdr = null;
  if (/dolby\s*vision|\bdv\b/i.test(hdrRaw)) hdr = "Dolby Vision";
  else if (/hdr10\+?/i.test(hdrRaw)) hdr = "HDR10";
  else if (/\bhdr\b|\bhlg\b|\bpq\b/i.test(hdrRaw) || payload?.hdr === true) hdr = "HDR";

  return { quality, hdr };
}

function episodeImage(episode: any, fallback: string | null, mediaId: number) {
  return firstRemote(
    episode?.still_url,
    episode?.image_url,
    episode?.thumbnail_url,
    episode?.still_path && getMediaImageUrl(mediaId, "backdrop", episode.still_path, "", "w500")
  ) || fallback || "/placeholder.jpg";
}

function DetailSkeleton() {
  return (
    <Box className="mobile-detail-v2 mobile-detail-skeleton" aria-hidden="true">
      <Box className="mobile-detail-skeleton-hero" />
      <Box className="mobile-detail-skeleton-body">
        <Box className="mobile-detail-skeleton-line is-logo" />
        <Box className="mobile-detail-skeleton-line is-button" />
        <Box className="mobile-detail-skeleton-line is-button" />
        <Box className="mobile-detail-skeleton-line is-meta" />
        <Box className="mobile-detail-skeleton-line" />
        <Box className="mobile-detail-skeleton-line is-short" />
      </Box>
    </Box>
  );
}

function RelatedRail({ items, typeSlug, navigate }: any) {
  const candidates = useMemo(() => (items || []).slice(0, 30), [items]);
  const artwork = useArtworkBatch(candidates, candidates.length > 0);
  const ready = useMemo(
    () => candidates.filter((item: any) => artwork.isReady(item, "poster")).slice(0, 24),
    [candidates, artwork.data]
  );

  if (!candidates.length) return null;

  return (
    <Box className="mobile-detail-related">
      <Typography component="h2" className="mobile-detail-section-title">Altri contenuti simili</Typography>
      {ready.length ? (
        <Box className="mobile-detail-related-rail">
          {ready.map((item: any) => {
            const assets = artwork.getResolved(item);
            const id = Number(item?.id || item?.tmdbId || item?.tmdb_id || 0);
            const poster = assets?.poster_url;
            if (!id || !poster) return null;
            return (
              <button
                type="button"
                className="mobile-detail-related-card"
                key={`${typeSlug}-${id}`}
                onClick={() => navigate(`/detail/${typeSlug}/${id}`)}
                aria-label={item?.title || item?.name || "Apri contenuto"}
              >
                <img src={poster} alt="" loading="lazy" decoding="async" />
              </button>
            );
          })}
        </Box>
      ) : (
        <Box className="mobile-detail-related-rail is-loading">
          {Array.from({ length: 4 }).map((_, index) => <span className="mobile-detail-poster-skeleton" key={index} />)}
        </Box>
      )}
    </Box>
  );
}

export default function MobileDetailExperience() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(() => parseDetailPath(location.pathname), [location.pathname]);
  const typeSlug = parsed?.typeSlug || "movie";
  const mediaId = parsed?.id || 0;
  const isTV = typeSlug === "tv";
  const type = isTV ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;

  const [getVideoDetail, { data: detail }] = useLazyGetAppendedVideosQuery();
  const [getSeasonDetails] = useLazyGetTVSeasonDetailsQuery();
  const [getGenrePage] = useLazyGetVideosByMediaTypeAndGenreIdQuery();
  const automaticAssets = useAutomaticMediaAssets({ ...(detail || {}), id: mediaId, type: typeSlug }, type, !!mediaId && isMobile && !!parsed);
  const resolvedTrailer = useResolvedTrailer(type, mediaId, !!mediaId && isMobile && !!parsed);
  const { items: continueWatchingItems } = useContinueWatching();

  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerFailed, setTrailerFailed] = useState(false);
  const [inMyList, setInMyList] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [seasons, setSeasons] = useState<any[]>([]);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [streamProfile, setStreamProfile] = useState<any>({ quality: null, hdr: null });
  const [relatedPool, setRelatedPool] = useState<any[]>([]);

  const progressItem = useMemo(
    () => (continueWatchingItems || []).find((item: any) => Number(item?.tmdb_id || item?.tmdbId || 0) === mediaId && String(item?.media_type || item?.type || "") === typeSlug),
    [continueWatchingItems, mediaId, typeSlug]
  );

  useEffect(() => {
    const root = document.documentElement;
    const active = !!isMobile && !!parsed;
    root.classList.toggle("flixit-mobile-detail-v2", active);
    return () => root.classList.remove("flixit-mobile-detail-v2");
  }, [isMobile, parsed]);

  useEffect(() => {
    if (!isMobile || !parsed || !mediaId) return;
    getVideoDetail({ mediaType: type, id: mediaId });
  }, [getVideoDetail, isMobile, mediaId, parsed, type]);

  useEffect(() => {
    setShowTrailer(false);
    setTrailerFailed(false);
    setOverviewExpanded(false);
    setSelectedSeason(1);
    setSeasons([]);
    setEpisodes([]);
    setStreamProfile({ quality: null, hdr: null });
    setRelatedPool([]);
  }, [mediaId, typeSlug]);

  useEffect(() => {
    if (!isMobile || !parsed || !resolvedTrailer?.url || trailerFailed) return;
    const timer = window.setTimeout(() => setShowTrailer(true), TRAILER_DELAY);
    return () => window.clearTimeout(timer);
  }, [isMobile, parsed, resolvedTrailer?.url, trailerFailed, mediaId]);

  useEffect(() => {
    if (!isMobile || !parsed || !mediaId) return;
    const userId = localStorage.getItem("netflix_user_id") || `user_${Math.random().toString(36).slice(2, 11)}`;
    if (!localStorage.getItem("netflix_user_id")) localStorage.setItem("netflix_user_id", userId);
    fetch(`${API_URL}/api/user/list/check/${userId}/${typeSlug}/${mediaId}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => data && setInMyList(!!data.in_list))
      .catch(() => {});
  }, [isMobile, mediaId, parsed, typeSlug]);

  useEffect(() => {
    if (!isMobile || !parsed || !mediaId) return;
    let cancelled = false;
    const inspect = async () => {
      const season = isTV ? Number(progressItem?.season || selectedSeason || 1) : null;
      const episode = isTV ? Number(progressItem?.episode || 1) : null;
      const path = isTV
        ? `${API_URL}/api/player/tv/${mediaId}/${season || 1}/${episode || 1}`
        : `${API_URL}/api/player/movie/${mediaId}`;
      try {
        const response = await fetch(path, { cache: "no-store", headers: { Accept: "application/json" } });
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) setStreamProfile(playbackProfile(payload));
      } catch {}
    };
    const idle = (window as any).requestIdleCallback
      ? (window as any).requestIdleCallback(inspect, { timeout: 2400 })
      : window.setTimeout(inspect, 1500);
    return () => {
      cancelled = true;
      if ((window as any).cancelIdleCallback) (window as any).cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [isMobile, parsed, mediaId, typeSlug, isTV, progressItem?.season, progressItem?.episode]);

  const loadSeason = useCallback(async (seasonNumber: number) => {
    if (!isTV || !mediaId) return;
    setEpisodesLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/public/tv/${mediaId}/season/${seasonNumber}`, { headers: { Accept: "application/json" } });
      if (response.ok) {
        const payload = await response.json();
        setEpisodes(Array.isArray(payload?.episodes) ? payload.episodes : []);
      } else {
        const fallback = await getSeasonDetails({ seriesId: mediaId, seasonNumber }).unwrap();
        setEpisodes(Array.isArray(fallback?.episodes) ? fallback.episodes : []);
      }
    } catch {
      try {
        const fallback = await getSeasonDetails({ seriesId: mediaId, seasonNumber }).unwrap();
        setEpisodes(Array.isArray(fallback?.episodes) ? fallback.episodes : []);
      } catch {
        setEpisodes([]);
      }
    } finally {
      setEpisodesLoading(false);
    }
  }, [getSeasonDetails, isTV, mediaId]);

  useEffect(() => {
    if (!isTV || !detail || !mediaId) return;
    let cancelled = false;
    fetch(`${API_URL}/api/public/tv/${mediaId}/seasons`, { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (cancelled) return;
        const list = (Array.isArray(payload?.seasons) ? payload.seasons : detail?.seasons || [])
          .filter((season: any) => Number(season?.season_number || 0) > 0);
        setSeasons(list);
        const progressSeason = Number(progressItem?.season || 0);
        const chosen = list.find((season: any) => Number(season?.season_number) === progressSeason) || list[0];
        const number = Number(chosen?.season_number || progressSeason || 1);
        setSelectedSeason(number);
        loadSeason(number);
      })
      .catch(() => {
        const list = (detail?.seasons || []).filter((season: any) => Number(season?.season_number || 0) > 0);
        setSeasons(list);
        const number = Number(progressItem?.season || list[0]?.season_number || 1);
        setSelectedSeason(number);
        loadSeason(number);
      });
    return () => { cancelled = true; };
  }, [detail, isTV, loadSeason, mediaId, progressItem?.season]);

  useEffect(() => {
    if (!detail?.genres?.length || !mediaId) return;
    const primaryGenre = Number(detail.genres[0]?.id || 0);
    if (!primaryGenre) return;
    let cancelled = false;
    Promise.all([
      getGenrePage({ mediaType: type, genreId: primaryGenre, page: 1 }).unwrap().catch(() => null),
      getGenrePage({ mediaType: type, genreId: primaryGenre, page: 2 }).unwrap().catch(() => null),
    ]).then((pages) => {
      if (cancelled) return;
      const seen = new Set<number>();
      const merged = pages.flatMap((page: any) => page?.results || []).filter((item: any) => {
        const id = Number(item?.id || item?.tmdbId || 0);
        if (!id || id === mediaId || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      setRelatedPool(merged.slice(0, 36));
    });
    return () => { cancelled = true; };
  }, [detail?.genres, getGenrePage, mediaId, type]);

  const relatedItems = useAvailableItems(relatedPool, typeSlug);

  if (!isMobile || !parsed) return null;
  if (!detail) return <DetailSkeleton />;

  const title = detail?.title || detail?.name || automaticAssets?.title || "";
  const logoUrl = firstRemote(automaticAssets?.logo_path, automaticAssets?.logo, automaticAssets?.logo_url, detail?.netflix_logo_url);
  const backdropUrl = firstRemote(
    automaticAssets?.detail_backdrop_path,
    automaticAssets?.detail_backdrop_url,
    automaticAssets?.hero_backdrop_path,
    automaticAssets?.hero_backdrop_url,
    automaticAssets?.backdrop_path,
    automaticAssets?.backdrop_url,
    detail?.netflix_artwork_url,
    detail?.backdrop_path
  );
  const posterUrl = firstRemote(automaticAssets?.poster_path, automaticAssets?.poster_url, detail?.poster_path) || backdropUrl;
  const genres = (detail?.genres || []).map((genre: any) => genre?.name).filter(Boolean);
  const overview = String(detail?.overview || "").trim();
  const canExpandOverview = overview.length > 220;

  const progressSeconds = Number(progressItem?.progress || 0);
  const resumeLabel = progressItem
    ? isTV
      ? `Riprendi S${progressItem?.season || selectedSeason || 1}:E${progressItem?.episode || 1}`
      : `Riprendi da ${formatPosition(progressSeconds)}`
    : "Riproduci";

  const goPlay = (season?: number, episode?: number) => {
    const suffix = isTV ? `?s=${season || progressItem?.season || selectedSeason || 1}&e=${episode || progressItem?.episode || 1}` : "";
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${mediaId}${suffix}`);
  };

  const toggleList = async () => {
    const userId = localStorage.getItem("netflix_user_id") || `user_${Math.random().toString(36).slice(2, 11)}`;
    if (!localStorage.getItem("netflix_user_id")) localStorage.setItem("netflix_user_id", userId);
    const next = !inMyList;
    setInMyList(next);
    try {
      const endpoint = next ? "/api/user/list/add" : "/api/user/list/remove";
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, media_id: mediaId, media_type: typeSlug, title, poster_path: posterUrl, backdrop_path: backdropUrl }),
      });
      if (response.ok) {
        const payload = await response.json();
        if (typeof payload?.in_list === "boolean") setInMyList(payload.in_list);
      }
    } catch {}
  };

  return (
    <Box className={`mobile-detail-v2 ${isTV ? "is-tv" : "is-movie"}`} data-testid="mobile-detail-v2">
      <Box className="mobile-detail-hero">
        {backdropUrl ? <img className="mobile-detail-backdrop" src={backdropUrl} alt="" /> : null}
        {showTrailer && resolvedTrailer?.url && !trailerFailed ? (
          <Box className="mobile-detail-trailer" aria-hidden="true">
            <TrailerPlayer
              key={resolvedTrailer.url}
              videoKey={resolvedTrailer.url}
              muted
              playing
              loop
              zoom={1.05}
              onError={() => {
                setTrailerFailed(true);
                setShowTrailer(false);
              }}
            />
          </Box>
        ) : null}
        <Box className="mobile-detail-hero-shade" />
        <Box className="mobile-detail-identity">
          {logoUrl ? <img className="mobile-detail-logo" src={logoUrl} alt={title} /> : <Typography className="mobile-detail-title-fallback">{title}</Typography>}
        </Box>
      </Box>

      <Box className="mobile-detail-body">
        <Stack className="mobile-detail-actions" spacing={1}>
          <Button data-testid="mobile-detail-play" onClick={() => goPlay()} startIcon={<PlayArrowRoundedIcon />} className="mobile-detail-play-button">
            {resumeLabel}
          </Button>
          <Button data-testid="mobile-detail-list" onClick={toggleList} startIcon={inMyList ? <CheckRoundedIcon /> : <AddRoundedIcon />} className="mobile-detail-list-button">
            La mia lista
          </Button>
        </Stack>

        <Box className="mobile-detail-meta" aria-label="Informazioni contenuto">
          {yearFrom(detail) ? <span>{yearFrom(detail)}</span> : null}
          <span>{runtimeText(detail, isTV)}</span>
          {streamProfile?.quality ? <span className="mobile-detail-badge">{streamProfile.quality}</span> : null}
          {streamProfile?.hdr ? <span className="mobile-detail-badge">{streamProfile.hdr}</span> : null}
        </Box>

        {overview ? (
          <Box className="mobile-detail-overview-wrap">
            <Typography className={`mobile-detail-overview ${overviewExpanded ? "is-expanded" : ""}`}>{overview}</Typography>
            {canExpandOverview ? (
              <button type="button" className="mobile-detail-more" onClick={() => setOverviewExpanded((value) => !value)}>
                {overviewExpanded ? "Riduci" : "Altro"}
              </button>
            ) : null}
          </Box>
        ) : null}

        {genres.length ? <Typography className="mobile-detail-genres"><span>Generi:</span> {genres.join(", ")}</Typography> : null}

        {isTV ? (
          <Box className="mobile-detail-seasons" data-testid="mobile-detail-seasons">
            <Box className="mobile-detail-season-header">
              <Typography component="h2" className="mobile-detail-section-title">Stagioni</Typography>
              <Select
                value={selectedSeason}
                onChange={(event) => {
                  const season = Number(event.target.value);
                  setSelectedSeason(season);
                  loadSeason(season);
                }}
                className="mobile-detail-season-select"
                MenuProps={{
                  PaperProps: { className: "mobile-detail-season-menu" },
                }}
              >
                {(seasons.length ? seasons : [{ season_number: selectedSeason }]).map((season: any) => (
                  <MenuItem key={season.season_number} value={Number(season.season_number)}>Stagione {season.season_number}</MenuItem>
                ))}
              </Select>
            </Box>

            {episodesLoading ? (
              <Box className="mobile-detail-episode-list is-loading">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Box className="mobile-detail-episode-skeleton" key={index}>
                    <span />
                    <Box><i /><i /></Box>
                  </Box>
                ))}
              </Box>
            ) : (
              <Box className="mobile-detail-episode-list">
                {episodes.map((episode: any, index: number) => {
                  const number = Number(episode?.episode_number || index + 1);
                  const duration = Number(episode?.runtime || 0);
                  const current = Number(progressItem?.season || 0) === selectedSeason && Number(progressItem?.episode || 0) === number;
                  const percent = current && Number(progressItem?.duration || 0) > 0
                    ? Math.min(100, Math.max(0, Number(progressItem.progress || 0) / Number(progressItem.duration) * 100))
                    : 0;
                  return (
                    <button
                      type="button"
                      className={`mobile-detail-episode ${current ? "is-current" : ""}`}
                      key={episode?.id || `${selectedSeason}-${number}`}
                      onClick={() => goPlay(selectedSeason, number)}
                    >
                      <span className="mobile-detail-episode-thumb">
                        <img src={episodeImage(episode, backdropUrl, mediaId)} alt="" loading="lazy" decoding="async" />
                        {percent > 0 ? <i className="mobile-detail-episode-progress"><b style={{ width: `${percent}%` }} /></i> : null}
                      </span>
                      <span className="mobile-detail-episode-copy">
                        <strong>{number}. {episode?.name || `Episodio ${number}`}</strong>
                        {duration ? <small>{duration} min</small> : null}
                      </span>
                    </button>
                  );
                })}
              </Box>
            )}
          </Box>
        ) : null}

        <RelatedRail items={relatedItems} typeSlug={typeSlug} navigate={navigate} />
      </Box>
    </Box>
  );
}
