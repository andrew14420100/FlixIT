// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

import {
  useLazyGetAppendedVideosQuery,
  useLazyGetVideosByMediaTypeAndGenreIdQuery,
} from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useAvailableItems } from "src/hooks/useAvailability";
import useAutomaticMediaAssets, { tmdbImageUrl } from "src/hooks/useAutomaticMediaAssets";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import TrailerPlayer from "src/components/TrailerPlayer";
import TrailerAudioButton from "src/components/TrailerAudioButton";
import VideoItemWithHover from "src/components/VideoItemWithHover";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const HERO_TRAILER_DELAY = 2200;
const TRAILER_LOOKUP_DELAY = 450;
const STREAM_PROFILE_TTL = 2 * 60 * 60 * 1000;
const WATCH_STREAM_CACHE_PREFIX = "watch_stream_cache:";

const DETAIL_TABS = [
  { id: "overview", label: "Panoramica" },
  { id: "trailers", label: "Trailer & altro" },
  { id: "download", label: "Scarica" },
  { id: "similar", label: "Titoli simili" },
];

export async function loader() {
  return null;
}

function firstRemote(...values: any[]) {
  for (const value of values) {
    const raw = typeof value === "string" ? value : value?.url;
    if (!raw) continue;
    const text = String(raw).trim();
    if (!text) continue;
    if (text.startsWith("data:") || text.startsWith("blob:")) return text;
    if (!/^https?:\/\//i.test(text)) continue;
    if (/^https?:\/\/image\.tmdb\.org\//i.test(text)) continue;
    return text;
  }
  return null;
}

function yearFrom(detail: any) {
  const raw = detail?.release_date || detail?.first_air_date || "";
  return raw ? String(raw).slice(0, 4) : "";
}

function runtimeText(detail: any, isTV: boolean) {
  if (isTV) {
    const seasons = Number(detail?.number_of_seasons || 0);
    if (!seasons) return "Serie TV";
    return `${seasons} ${seasons === 1 ? "stagione" : "stagioni"}`;
  }

  const minutes = Number(detail?.runtime || 0);
  if (!minutes) return "Film";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest ? `${rest}min` : ""}`.trim() : `${minutes}min`;
}

function secondsText(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  if (safe >= 3600) {
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    return `${hours}h ${minutes ? `${minutes}min` : ""}`.trim();
  }
  return `${Math.max(1, Math.ceil(safe / 60))} min`;
}

function certificationText(detail: any) {
  const direct = detail?.certification || detail?.content_rating || detail?.contentRating;
  if (direct) {
    const text = String(direct).trim();
    return /^\d{1,2}$/.test(text) ? `${text}+` : text;
  }

  const ratings = detail?.content_ratings?.results;
  if (Array.isArray(ratings)) {
    const match = ratings.find((entry: any) => entry?.iso_3166_1 === "IT")
      || ratings.find((entry: any) => entry?.iso_3166_1 === "US")
      || ratings.find((entry: any) => entry?.rating);
    if (match?.rating) {
      const text = String(match.rating).trim();
      return /^\d{1,2}$/.test(text) ? `${text}+` : text;
    }
  }

  const releases = detail?.release_dates?.results;
  if (Array.isArray(releases)) {
    const country = releases.find((entry: any) => entry?.iso_3166_1 === "IT")
      || releases.find((entry: any) => entry?.iso_3166_1 === "US")
      || releases[0];
    const value = country?.release_dates?.find((entry: any) => entry?.certification)?.certification;
    if (value) {
      const text = String(value).trim();
      return /^\d{1,2}$/.test(text) ? `${text}+` : text;
    }
  }

  return "";
}

function cacheResolvedStream(typeSlug: string, id: number, season: number, episode: number, payload: any) {
  if (!payload?.success || !payload?.stream) return;
  try {
    const logicalSeason = typeSlug === "tv" ? season || 1 : 0;
    const logicalEpisode = typeSlug === "tv" ? episode || 1 : 0;
    sessionStorage.setItem(
      `${WATCH_STREAM_CACHE_PREFIX}${typeSlug}:${id}:${logicalSeason}:${logicalEpisode}`,
      JSON.stringify({
        stream: payload.stream,
        type: payload.type || "hls",
        source: payload.source,
        savedAt: Date.now(),
      })
    );
  } catch {}
}

async function warmPlaybackRequest(typeSlug: string, id: number, season?: number, episode?: number) {
  const logicalSeason = typeSlug === "tv" ? Number(season || 1) : 0;
  const logicalEpisode = typeSlug === "tv" ? Number(episode || 1) : 0;
  const suffix = typeSlug === "tv" ? `:${logicalSeason}:${logicalEpisode}` : ":0:0";
  const cacheKey = `flixit-detail-stream-profile:${typeSlug}:${id}${suffix}`;

  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (cached && Date.now() - Number(cached.ts || 0) < STREAM_PROFILE_TTL) return cached.value || {};
  } catch {}

  const path = typeSlug === "tv"
    ? `${API_URL}/api/player/tv/${id}/${logicalSeason}/${logicalEpisode}`
    : `${API_URL}/api/player/movie/${id}`;

  try {
    const response = await fetch(path, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return {};
    const payload = await response.json();
    cacheResolvedStream(typeSlug, id, logicalSeason, logicalEpisode, payload);
    const value = { success: !!payload?.success };
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), value })); } catch {}
    return value;
  } catch {
    return {};
  }
}

function directTrailerUrl(value: any) {
  const raw = typeof value === "string"
    ? value
    : value?.url || value?.trailer_url || value?.manifest_url || value?.stream_url;
  const text = String(raw || "").trim();
  if (!text) return null;
  return /^https?:\/\//i.test(text) || text.startsWith("/") ? text : null;
}

function trailerLabel(item: any, index: number) {
  const raw = item?.label || item?.title || item?.name || item?.kind || item?.type;
  const text = String(raw || "").trim();
  if (text) return text;
  return index === 0 ? "Trailer ufficiale" : `Trailer ${index + 1}`;
}

export function Component() {
  const { mediaType, id } = useParams<{ mediaType: string; id: string }>();
  const navigate = useNavigate();
  const mediaId = Number(id) || 0;
  const typeSlug = mediaType === "tv" ? "tv" : "movie";
  const type = typeSlug === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;
  const isTV = typeSlug === "tv";

  const [getVideoDetail, { data: detail }] = useLazyGetAppendedVideosQuery();
  const [getGenrePage] = useLazyGetVideosByMediaTypeAndGenreIdQuery();

  const [trailerLookupEnabled, setTrailerLookupEnabled] = useState(false);
  const automaticAssets = useAutomaticMediaAssets(
    { ...(detail || {}), id: mediaId, type: typeSlug },
    type,
    !!mediaId
  );
  const resolvedTrailer = useResolvedTrailer(type, mediaId, trailerLookupEnabled && !!mediaId);
  const { items: continueWatchingItems } = useContinueWatching();

  const [activeTab, setActiveTab] = useState("overview");
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [modalTrailerUrl, setModalTrailerUrl] = useState<string | null>(null);
  const [modalMuted, setModalMuted] = useState(false);
  const [relatedPool, setRelatedPool] = useState<any[]>([]);
  const [playbackProfile, setPlaybackProfile] = useState<any>({});

  const progressItem = useMemo(
    () => continueWatchingItems.find((item: any) => Number(item.tmdb_id) === mediaId && item.media_type === typeSlug),
    [continueWatchingItems, mediaId, typeSlug]
  );

  const progressPercent = progressItem?.duration > 0
    ? Math.min(100, Math.max(0, (progressItem.progress / progressItem.duration) * 100))
    : 0;
  const remainingSeconds = progressItem?.duration > 0
    ? Math.max(0, progressItem.duration - progressItem.progress)
    : 0;

  useEffect(() => {
    if (!mediaId) return;
    getVideoDetail({ mediaType: type, id: mediaId });
  }, [getVideoDetail, mediaId, type]);

  useEffect(() => {
    setTrailerLookupEnabled(false);
    setShowTrailer(false);
    setTrailerPlaying(false);
    setMuted(true);
  setActiveTab("overview");
    setModalTrailerUrl(null);
    setModalMuted(false);
  setRelatedPool([]);
    setPlaybackProfile({});
  }, [mediaId, typeSlug]);

  useEffect(() => {
    if (!mediaId) return;
    const timer = window.setTimeout(() => setTrailerLookupEnabled(true), TRAILER_LOOKUP_DELAY);
    return () => window.clearTimeout(timer);
  }, [mediaId, typeSlug]);

  useEffect(() => {
    if (!resolvedTrailer.url) return;
    const timer = window.setTimeout(() => setShowTrailer(true), HERO_TRAILER_DELAY);
    return () => window.clearTimeout(timer);
  }, [resolvedTrailer.url, mediaId]);

  useEffect(() => {
    if (!detail?.genres?.length) return;
    const primaryGenre = Number(detail.genres[0]?.id || 0);
    if (!primaryGenre) return;
    let cancelled = false;
    let timer = 0;
    let idleId: any = null;

    const loadRelated = () => {
      Promise.all([
        getGenrePage({ mediaType: type, genreId: primaryGenre, page: 1 }).unwrap().catch(() => null),
        getGenrePage({ mediaType: type, genreId: primaryGenre, page: 2 }).unwrap().catch(() => null),
    ]).then((pages) => {
      if (cancelled) return;
      const merged = pages.flatMap((page: any) => page?.results || []);
      const seen = new Set<number>();
      const filtered = merged.filter((item: any) => {
        const itemId = Number(item?.id || item?.tmdbId || 0);
        if (!itemId || itemId === mediaId || seen.has(itemId)) return false;
        seen.add(itemId);
        return Array.isArray(item?.genre_ids) ? item.genre_ids.includes(primaryGenre) : true;
      }).slice(0, 30);
      setRelatedPool(filtered);
    });
  };

    if ("requestIdleCallback" in window) {
    idleId = (window as any).requestIdleCallback(loadRelated, { timeout: 2000 });
  } else {
    timer = window.setTimeout(loadRelated, 1100);
  }

  return () => {
    cancelled = true;
    if (timer) window.clearTimeout(timer);
    if (idleId != null && "cancelIdleCallback" in window) (window as any).cancelIdleCallback(idleId);
  };
  }, [detail?.genres, getGenrePage, mediaId, type]);

  const relatedItems = useAvailableItems(relatedPool, typeSlug);

  const title = detail?.title || detail?.name || automaticAssets?.title || "";
  const logoUrl = firstRemote(automaticAssets?.logo_path, automaticAssets?.logo, detail?.netflix_logo_url);
  const backdropUrl = firstRemote(
    automaticAssets?.detail_backdrop_path,
    automaticAssets?.hero_backdrop_path,
    automaticAssets?.backdrop_path,
    detail?.netflix_artwork_url,
    detail?.backdrop_path
  ) || tmdbImageUrl(
    automaticAssets?.detail_backdrop_path
      || automaticAssets?.hero_backdrop_path
      || automaticAssets?.backdrop_path
      || detail?.backdrop_path,
    "original"
  );

  const posterUrl = firstRemote(automaticAssets?.poster_path, detail?.poster_path)
    || tmdbImageUrl(automaticAssets?.poster_path || detail?.poster_path, "w500")
    || backdropUrl;
  const genres = (detail?.genres || []).map((genre: any) => genre?.name).filter(Boolean);
  const overview = String(detail?.overview || "").trim();
  const certification = certificationText(detail);

  const goPlay = useCallback(() => {
    const targetSeason = isTV ? Number(progressItem?.season || 1) : undefined;
    const targetEpisode = isTV ? Number(progressItem?.episode || 1) : undefined;
    warmPlaybackRequest(typeSlug, mediaId, targetSeason, targetEpisode).catch(() => {});
    const suffix = isTV ? `?s=${targetSeason}&e=${targetEpisode}` : "";
    window.scrollTo(0, 0);
    navigate(`${MAIN_PATH.watch}/${typeSlug}/${mediaId}${suffix}`);
  }, [isTV, mediaId, navigate, progressItem?.episode, progressItem?.season, typeSlug]);

  const freshPlay = useCallback(() => {
    warmPlaybackRequest(typeSlug, mediaId, isTV ? 1 : undefined, isTV ? 1 : undefined).catch(() => {});
    const suffix = isTV ? "?s=1&e=1" : "";
    window.scrollTo(0, 0);
    navigate(`${MAIN_PATH.watch}/${typeSlug}/${mediaId}${suffix}`);
  }, [isTV, mediaId, navigate, typeSlug]);

  const metadataItems = [
    isTV ? { text: "Serie" } : { text: "Film" },
    genres[0] ? { text: genres[0] } : null,
    yearFrom(detail) ? { text: yearFrom(detail) } : null,
    { text: runtimeText(detail, isTV) },
    certification ? { text: certification, badge: true } : null,
  ].filter(Boolean);

  const trailerItems = useMemo(() => {
    const items: any[] = [];
    const seen = new Set<string>();
    const push = (value: any, label?: string, source?: string) => {
      const url = directTrailerUrl(value);
      if (!url || seen.has(url)) return;
      seen.add(url);
      items.push({ url, label: label || `Trailer ${items.length + 1}`, source });
    };

    push(resolvedTrailer.url, "Trailer ufficiale", resolvedTrailer.source);

  const sourceArrays = [
    detail?.trailers,
    detail?.videos,
    detail?.trailer_alternatives,
    detail?.video_trailers,
    automaticAssets?.trailers,
    automaticAssets?.videos,
  ];
    sourceArrays.forEach((array) => {
      if (!Array.isArray(array)) return;
      array.forEach((item: any) => push(item, trailerLabel(item, items.length), item?.source));
    });
    return items.slice(0, 8);
  }, [automaticAssets?.trailers, automaticAssets?.videos, detail?.trailer_alternatives, detail?.trailers, detail?.video_trailers, detail?.videos, resolvedTrailer.source, resolvedTrailer.url]);

  const continueLine = progressItem
    ? `${isTV ? `S${Number(progressItem.season || 1)}:E${Number(progressItem.episode || 1)}` : "Riprendi"} $Â· ${remainingSeconds > 0 ? secondsText(remainingSeconds) + " rimanenti" : "Riprendi"}`
    : isTV ? "S1:E1 â€¢#¢"#° ¢–b‚FWF–Â’°¢&WGW&â€¢Ä&÷‚7ƒ×·²Ö–ä†V–v‡C¢#ƒ'f‚"Â&v6öÆ÷#¢"3S“B"ÂF—7Æ“¢&w&–B"ÂÆ6T—FV×3¢&6VçFW""×Óà¢Ä6—&7VÆ%&öw&W727ƒ×·²6öÆ÷#¢"6SS“B"×Òóà¢Âô&÷ƒà¢“°¢Ð ¢&WGW&â€¢Ä&÷€¢FF×FW7F–CÒ&FWF–Â×vR×&VFW6–vâ×c" ¢7ƒ×·°¢&v6öÆ÷#¢"3S“B"À¢6öÆ÷#¢"6ffb"À¢Ö–ä†V–v‡C¢#f‚"À¢÷fW&fÆ÷uƒ¢&†–FFVâ"À¢föçDfÖ–Ç“¢tæWFfÆ—‚6ç2Â$†VÇfWF–6æWVR"Â&–ÂÂ6ç2×6W&–brÀ¢×Ð¢à¢Ä&÷€¢7ƒ×·°¢÷6—F–öã¢'&VÆF—fR"À¢†V–v‡C¢&6Æ×ƒcS‚Âcã'f‚ÂƒC‚’"À¢Ö–ä†V–v‡C¢cSÀ¢÷fW&fÆ÷s¢&†–FFVâ"À¢&v6öÆ÷#¢"33s""À¢×Ð¢à¢¶&6¶G&÷W&Âò€¢Ä&÷€¢6ö×öæVçCÒ&–Ör ¢7&3×¶&6¶G&÷W&ÇÐ¢ÇCÒ" ¢FV6öF–æsÒ&7–æ2 ¢fWF6…&–÷&—G“Ò&†–v‚ ¢7ƒ×·°¢÷6—F–öã¢&'6öÇWFR"À¢–ç6WC¢À¢v–GFƒ¢#R"À¢†V–v‡C¢#R"À¢ö&¦V7Df—C¢&6÷fW""À¢ö&¦V7E÷6—F–öã¢&6VçFW"#BR"À¢÷6—G“¢6†÷uG&–ÆW"bbG&–ÆW%Æ––ærò¢À¢G&ç6—F–öã¢&÷6—G’3c×2V6R"À¢×Ð¢óà¢’¢çVÆÇÐ ¢·6†÷uG&–ÆW"bb&W6öÇfVEG&–ÆW"çW&Âò€¢Ä&÷‚7ƒ×·²÷6—F–öã¢&'6öÇWFR"Â–ç6WC¢Â÷6—G“¢G&–ÆW%Æ––ærò¢ÂG&ç6—F–öã¢&÷6—G’3c×2V6R"Âö–çFW$WfVçG3¢&æöæR"×Óà¢ÅG&–ÆW%Æ–W ¢¶W“×·&W6öÇfVEG&–ÆW"çW&ÇÐ¢f–FVô¶W“×·&W6öÇfVEG&–ÆW"çW&ÇÐ¢×WFVC×¶×WFVGÐ¢Æ––æp¢Æö÷ ¢¦ööÓ×³Ð¢öåÆ––æs×²‚’Óâ6WEG&–ÆW%Æ––ær‡G'VR—Ð¢öäW'&÷#×²‚’Óâ°¢6WE6†÷uG&–ÆW"†fÇ6R“°¢6WEG&–ÆW%Æ––ær†fÇ6R“°¢×Ð¢óà¢Âô&÷ƒà¢’¢çVÆÇÐ ¢Ä&÷‚7ƒ×·²÷6—F–öã¢&'6öÇWFR"Â–ç6WC¢Â&6¶w&÷VæC¢&Æ–æV"Öw&F–VçBƒ“FVrÂ&v&ƒ2ÃrÃÂã“b’RÂ&v&ƒ2ÃrÃÂãsB’#’RÂ&v&ƒ2ÃrÃÂã#B’SbRÂ&v&ƒ2ÃrÃÂã‚’s‚R’"×Òóà¢Ä&÷‚7ƒ×·²÷6—F–öã¢&'6öÇWFR"Â–ç6WC¢Â&6¶w&÷VæC¢&Æ–æV"Öw&F–VçBƒFVrÂ3S“BRÂ&v&ƒRÃ’Ã2Âãƒ‚’rRÂ&v&ƒRÃ’Ã2Âãb’"3‚R’"×Òóà¢Ä&÷‚7ƒ×·²÷6—F–öã¢&'6öÇWFR"Â–ç6WC¢Â&÷…6†F÷s¢&–ç6WBÓC‚ƒ‚&v&ƒBÃ2Ã#ÂãsB’"Âö–çFW$WfVçG3¢&æöæR"×Òóà ¢Ä&÷€¢7ƒ×·°¢÷6—F–öã¢&'6öÇWFR"À¢ÆVgC¢²‡3¢#Wgr"ÂÖC¢#Ggr'ÒÀ¢&÷GFöÓ¢²‡3¢“BÂÖC¢gÒÀ¢¤–æFWƒ¢BÀ¢v–GFƒ¢²‡3¢#“gr"Â6Ó¢#sgr"ÂÖC¢&Ö–âƒcC‚ÂCWgr’"ÒÀ¢×Ð¢à¢¶ÆövõW&Âò€¢Ä&÷€¢6ö×öæVçCÒ&–Ör ¢7&3×¶ÆövõW&ÇÐ¢ÇC×·F—FÆWÐ¢FV6öF–æsÒ&7–æ2 ¢7ƒ×·°¢F—7Æ“¢&&Æö6²"À¢v–GFƒ¢&WFò"À¢Ö…v–GFƒ¢&Ö–âƒSC‚ÂC'gr’"À¢Ö„†V–v‡C¢“À¢ö&¦V7Df—C¢&6öçF–â"À¢ö&¦V7E÷6—F–öã¢&ÆVgB6VçFW""À¢Ö#¢"ã"À¢×Ð¢óà¢’¢€¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢&6Æ×ƒC‚ÂRãgrÂsG‚’"ÂföçEvV–v‡C¢“ÂÆ–æT†V–v‡C¢ã“BÂÆWGFW%76–æs¢"ÒãCVVÒ"ÂÖ#¢"ã"ÂFW‡E6†F÷s¢#G‚#G‚&v&ƒÃÃÂãR’"×Óà¢·F—FÆWÐ¢ÂõG—öw&‡“à¢—Ð ¢Å7F6²F—&V7F–öãÒ'&÷r"W6TfÆW„vfÆW…w&Ò'w&"76–æs×³ãWÒ7ƒ×·²Æ–vä—FV×3¢&6VçFW""ÂÖ#¢ã‚Â6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãƒB’"×Óà¢¶ÖWFFF—FV×2æÖ‚†—FVÓ¢ç’Â–æFWƒ¢çVÖ&W"’Óâ€¢Å7F6²¶W“×¶G·FW‡GÒG¶–æFW‡ÖÒF—&V7F–öãÒ'&÷r"76–æs×³ãWÒ7ƒ×·²Æ–vä—FV×3¢&6VçFW""×Óà¢¶–æFW‚òÄ&÷‚6ö×öæVçCÒ'7â"7ƒ×·²6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãs"’"×Óî(
#Âô&÷ƒâ¢çVÆÇÐ¢Ä&÷‚6ö×öæVçCÒ'7â"7ƒ×·²föçE6—¦S¢bãRÂföçEvV–v‡C¢SƒÂƒ¢—FVÒæ&FvRò¢Â“¢—FVÒæ&FvRòãR¢Â&÷&FW#¢—FVÒæ&FvRò#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãR’"¢&æöæR"Â&÷&FW%&F—W3¢—FVÒæ&FvRò#G‚"¢×Óç¶—FVÒçFW‡GÓÂô&÷ƒà¢Âõ7F6³à¢’—Ð¢Âõ7F6³à ¢Ä&÷‚7ƒ×·²Ö#¢ãB×Óà¢ÅG—öw&‡’7ƒ×·²föçEvV–v‡C¢ƒÂföçE6—¦S¢rãRÂÖ#¢ãcR×Óà¢·&öw&W74—FVÒò$6öçF–çVwV&F&R"¢—5Ebò$wV&F3¤S"¢%&—&öGV6’'Ð¢ÂõG—öw&‡“à¢Å7F6²F—&V7F–öãÒ'&÷r"76–æs×³ãWÒ7ƒ×·²Æ–vä—FV×3¢&6VçFW""×Óà¢Ä&÷‚7ƒ×·²v–GFƒ¢#SÂÖ…v–GFƒ¢#C'gr"Â†V–v‡C¢RÂ&÷&FW%&F—W3¢““’Â&v6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂã‚’"Â÷fW&fÆ÷s¢&†–FFVâ"×Óà¢Ä&÷‚7ƒ×·²v–GFƒ¢Gµ&öw&W74—FVÒò&öw&W75W&6VçB¢ÒVÂ†V–v‡C¢#R"Â&6¶w&÷VæC¢"6SS“B"ÂG&ç6—F–öã¢'v–GF‚#S×2V6R"×Òóà¢Âô&÷ƒà¢·&öw&W74—FVÒòÅG—öw&‡’7ƒ×·²föçE6—¦S¢RãRÂ6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãsb’"×Óç¶6öçF–çVTÆ–æWÓÂõG—öw&‡“â¢çVÆÇÐ¢Âõ7F6³à¢Âô&÷ƒà ¢Å7F6²F—&V7F–öãÒ'&÷r"76–æs×³ã'Ò7ƒ×·²Æ–vä—FV×3¢&6VçFW""ÂfÆW…w&¢'w&"×Óà¢Ä'WGFöà¢öä6Æ–6³×¶võÆ—Ð¢öäÖ÷W6TVçFW#×²‚’Óâv&ÕÆ–&6µ&WVW7B‡G—U6ÇVrÂÖVF––BÂ—5EbòçVÖ&W"‡&öw&W74—FVÓòç6V6öâÇÂ’¢VæFVf–æVBÂ—5EbòçVÖ&W"‡&öw&W74—FVÓòæW—6öFRÇÂ’¢VæFVf–æVB’æ6F6‚‚‚’Óâ·Ò—Ð¢öäfö7W3×²‚’Óâv&ÕÆ–&6µ&WVW7B‡G—U6ÇVrÂÖVF––BÂ—5EbòçVÖ&W"‡&öw&W74—FVÓòç6V6öâÇÂ’¢VæFVf–æVBÂ—5EbòçVÖ&W"‡&öw&W74—FVÓòæW—6öFRÇÂ’¢VæFVf–æVB’æ6F6‚‚‚’Óâ·Ò—Ð¢7F'D–6öã×³ÅÆ”'&÷t–6öâ7ƒ×·²föçE6—¦S¢3"×ÒóçÐ¢7ƒ×·°¢&÷&FW%&F—W3¢#‡‚"À¢ƒ¢"ãbÀ¢“¢ãRÀ¢föçE6—¦S¢rãRÀ¢föçEvV–v‡C¢ƒSÀ¢&v6öÆ÷#¢"6ffb"À¢6öÆ÷#¢"3"À¢FW‡EG&ç6f÷&Ó¢&æöæR"À¢"c¦†÷fW"#¢²&v6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãƒb’"ÂG&ç6f÷&Ó¢'G&ç6ÆFU’‚Ó‚’"ÒÀ¢×Ð¢à¢·&öw&W74—FVÒò$6öçF–çVwV&F&R"¢—5Ebò$wV&F3¤S"¢%&—&öGV6’'Ð¢Âô'WGFöãà¢Âõ7F6³à¢Âô&÷ƒà ¢Ç·G&–ÆW%Æ––ærò†çVÆÂ’¢çVÆÇÐ ¢·&W6öÇfVEG&–ÆW"çW&Âò€¢Ä&÷‚7ƒ×·²÷6—F–öã¢&'6öÇWFR"Â&–v‡C¢²‡3¢‚ÂÖC¢CBÒÂ&÷GFöÓ¢bÂ¤–æFWƒ¢R×Óà¢ÅG&–ÆW$VF–ô'WGFöâ×WFVC×¶×WFVGÒöåFövvÆS×²‚’Óâ6WD×WFVB‚‡fÇVR’ÓâfÇVR—ÒFW7D–CÒ&FWF–ÂÖ†W&ò×G&–ÆW"ÖVF–ò×FövvÆR"óà¢Âô&÷ƒà¢’¢çVÆÇÐ¢Âô&÷ƒà ¢Ä&÷‚7ƒ×·²÷6—F–öã¢'&VÆF—fR"Â×C¢"ÓCG‚"Â¤–æFWƒ¢Â#¢Â&6¶w&÷VæC¢&Æ–æV"Öw&F–VçBƒƒFVrÂ3S“BRÂ3S“Bs"RÂ3sS2R’"×Óà¢Ä&÷€¢7ƒ×·°¢÷6—F–öã¢'7F–6·’"À¢F÷¢²‡3¢SbÂÖC¢s‚ÒÀ¢¤–æFWƒ¢#À¢F—7Æ“¢&fÆW‚"À¢§W7F–g”6öçFVçC¢&6VçFW""À¢ƒ¢"À¢×Ð¢à¢Ä&÷‚7ƒ×·²F—7Æ“¢&fÆW‚"ÂÆ–vä—FV×3¢&6VçFW""Âv¢ãRÂ¢#W‚"Â‚¢#w‚"Â&÷&FW%&F—W3¢##'‚"Â&v6öÆ÷#¢'&v&ƒRÃ"Ã‚Âã“B’"Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãR’"Â&÷…6†F÷s¢#'‚3'‚&v&ƒÃÃÂã#‚’"Â&6¶G&÷f–ÇFW#¢&&ÇW"ƒg‚’"×Óà¢´DUD”ÅõD%2æÖ‚‡F"’Óâ€¢Ä'WGFöà¢¶W“×·F"æ–GÐ¢öä6Æ–6³×²‚’Óâ6WD7F—fUF"‡F"æ–B—Ð¢FF×FW7F–C×¶FWF–Â×F"ÒG·F"æ–GÖÐ¢7ƒ×·°¢6öÆ÷#¢7F—fUF"ÓÓÒF"æ–Bò"6ffb"¢'&v&ƒ#SRÃ#SRÃ#SRÂãs"’"À¢FW‡EG&ç6f÷&Ó¢&æöæR"À¢föçE6—¦S¢²‡3¢2ÂÖC¢RãRÒÀ¢föçEvV–v‡C¢7F—fUF"ÓÓÒF"æ–BòsS¢SSÀ¢&÷&FW%&F—W3¢#‡‚"À¢†V–v‡C¢CbÀ¢ƒ¢²‡3¢ã‚ÂÖC¢2ã"ÒÀ¢÷6—F–öã¢'&VÆF—fR"À¢v†—FU76S¢&æ÷w&"À¢&v6öÆ÷#¢7F—fUF"ÓÓÒF"æ–Bò'&v&ƒ#SRÃ#SRÃ#SRÂã’’"¢'G&ç7&VçB"À¢"c¦†÷fW"#¢²&v6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãr’"Â6öÆ÷#¢"6ffb"ÒÀ¢"c£¦gFW"#¢°¢6öçFVçC¢tfÃrrÀ¢÷6—F–öã¢&'6öÇWFR"À¢ÆVgC¢##R"À¢&–v‡C¢##R"À¢&÷GFöÓ¢RÀ¢†V–v‡C¢2À¢&÷&FW%&F—W3¢““’À¢&v6öÆ÷#¢7F—fUF"ÓÓÒF"æ–Bò"6S“’"¢'G&ç7&VçB"À¢&÷…6†F÷s¢7F—fUF"ÓÓÒF"æ–Bò#'‚&v&ƒ##’Ã’ÃBÂãSR’"¢&æöæR"À¢ÒÀ¢×Ð¢à¢·F"æÆ&VÇÐ¢Âô'WGFöãà¢’—Ð¢Âô&÷ƒà¢Âô&÷ƒà ¢Ä&÷€¢¶W“×¶7F—fUF'Ð¢7ƒ×·°¢v–GFƒ¢&Ö–âƒS'‚Â“'gr’"À¢Ö…v–GFƒ¢S"À¢×ƒ¢&WFò"À¢C¢Bã‚À¢æ–ÖF–öã¢&FWF–ÅF&–â##×27V&–2Ö&W¦–W"‚ã#"ÂãcÂã3bÃ’&÷F‚"À¢$¶W–g&ÖW2FWF–ÅF$–â#¢°¢g&öÓ¢²÷6—G“¢ÂG&ç6f÷&Ó¢'G&ç6ÆFU’ƒG‚’'ÒÀ¢Fó¢²÷6—G“¢ÂG&ç6f÷&Ó¢'G&ç6ÆFU’ƒ‚’"ÒÀ¢ÒÀ¢×Ð¢à¢¶7F—fUF"ÓÓÒ&÷fW'f–Wr"ò€¢Ä&÷‚7ƒ×·²F—7Æ“¢&w&–B"Âw&–EFV×ÆFT6öÇVÖç3¢²‡3¢#g""ÂÆs¢#"ãVg"g""ÒÂv¢ãr×Óà¢Ä&÷‚7ƒ×·²&÷&FW%&F—W3¢##‚"Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂã’"Â&6¶w&÷VæC¢&Æ–æV"Öw&F–VçBƒ3VFVrÂ&v&ƒ’Ã#Ã3Âã“"’Â&v&ƒRÃRÃ#"Âãƒ2’’"Â&÷…6†F÷s¢##'‚s‚&v&ƒÃÃÂã#R’"Â¢²‡3¢"ãBÂÖC¢2ãBÒ×Óà¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢&6Æ×ƒ#‡‚Â"ã'grÂ3‡‚’"ÂföçEvV–v‡C¢“ÂÖ#¢ã"×Óåæ÷&Ö–6ÂõG—öw&‡“à¢¶÷fW'f–Wrò€¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢&6Æ×ƒg‚Âã3WgrÂ#‚’"ÂÆ–æT†V–v‡C¢ãS"Â6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãƒB’"ÂÖ…v–GFƒ¢ƒcÂÖ#¢"ãÂF—7Æ“¢"×vV&¶—BÖ&÷‚"ÂvV&¶—DÆ–æT6Æ×¢2ÂvV&¶—D&÷„÷&–VçC¢'fW'F–6Â"Â÷fW&f÷s¢&†–FFVâ"×Óà¢¶÷fW'f–WwÒ¶÷fW'f–WræÆVæwF‚â#cò"âââÇG&ò"¢"'Ð¢ÂõG—öw&‡“à¢’¢ÅG—öw&‡’7ƒ×·²6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãcB’"ÂÖ#¢"ã×ÓåG&ÖæöâF—7öæ–&–ÆRãÂõG—öw&‡“à ¢Ä&÷‚7ƒ×·²F—7Æ“¢&w&–B"Âw&–EFV×ÆFT6öÇVÖç3¢²‡3¢#g"g""ÂÖC¢'&WVBƒBÂg"’"ÒÂv¢ãÂ×C¢&WFò"×Óà¢µ°¢²$vVæW&R"ÂvVç&W5³ÒÇÂ.(	B%ÒÀ¢²$ææò"Â–V$g&öÒ†FWF–Â’ÇÂ.(	B%ÒÀ¢²$GW&F"Â'VçF–ÖUFW‡B†FWF–ÂÂ—5Eb•ÒÀ¢²$6Æ76–f–6¦–öæR"Â6W'F–f–6F–öâÇÂ.(	B%ÒÀ¢ÒæÖ‚…¶Æ&VÂÂfÇVUÒ’Óâ€¢Ä&÷‚¶W“×¶Æ&VÇÒ7ƒ×·²ƒ¢ãRÂ“¢ã3RÂ&÷&FW%&F—W3¢#7‚"Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂã’"Â&v6öÆ÷#¢'&v&ƒRÃ3ÃCÂãC‚’"ÂÖ–ä†V–v‡C¢sB×Óà¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢"ãRÂ6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãSB’"ÂÖ#¢ã3R×Óç¶Æ&VÇÓÂõG—öw&‡“à¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢bãRÂföçEvV–v‡C¢sS×Óç·fÇVWÓÂõG—öw&‡“à¢Âô&÷ƒà¢’—Ð¢Âô&÷ƒà¢Âô&÷ƒà ¢Ä&÷‚7ƒ×·²&÷&FW%&F—W3¢##‚"Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂã’"Â&6¶w&÷VæC¢&Æ–æV"Öw&F–VçBƒ3VFVrÂ&v&ƒÃ#RÃ3bÂã“"’Â&v&ƒRÃRÃ#"ÂãƒR’’"Â&÷…6†F÷s¢##'‚s‚&v&ƒÃÃÂã#R’"Â¢"×Óà¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢#BÂföçEvV–v‡C¢ƒSÂÖ#¢ãB×Óç·&öw&W74—FVÒò$6öçF–çVwV&F&R"¢$6öçFVçWFò'ÓÂõG—öw&‡“à¢·÷7FW%W&Âò€¢Ä&÷‚7ƒ×·²÷6—F–öã¢'&VÆF—fR"Â&÷&FW%&F—W3¢#W‚"Â÷fW&fÆ÷s¢&†–FFVâ"Â7V7E&F–ó¢#bòrãB"Â&v6öÆ÷#¢"3s‚"×Óà¢Ä&÷‚6ö×öæVçCÒ&–Ör"7&3×·÷7FW%W&ÇÒÇCÒ""ÆöF–æsÒ&Æ§’"FV6öF–æsÒ&7–æ2"7ƒ×·²v–GFƒ¢#R"Â†V–v‡C¢#R"Âö&¦V7Df—C¢&6÷fW""Âf–ÇFW#¢&'&–v‡FæW72‚ã‚’"×Òóà¢Ä&÷‚7ƒ×·²÷6—F–öã¢&'6öÇWFR"Â–ç6WC¢Â&6¶w&÷VæC¢&Æ–æV"Öw&F–VçBƒFVrÂ&v&ƒÃÃÂãS"’ÂG&ç7&VçBcR’"×Òóà¢Ä–6öä'WGFöâöä6Æ–6³×¶võÆ—Ò7ƒ×·²÷6—F–öã¢&'6öÇWFR"ÂÆVgC¢rÂ&÷GFöÓ¢rÂ&v6öÆ÷#¢'&v&ƒ#RÃCRÃS’Âãs"’"Â6öÆ÷#¢"6ffb"Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãr’"Âv–GFƒ¢C‚Â†V–v‡C¢C‚Â"c¦†÷fW"#¢²&v6öÆ÷#¢'&v&ƒ#RÃCRÃS’Âã’’"Ò×Óà¢ÅÆ”'&÷t–6öâóà¢Âô–6öä'WGFöãà¢Âô&÷ƒà¢’¢çVÆÇÐ¢Ä&÷‚7ƒ×·²C¢ãB×Óà¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢RãRÂföçEvV–v‡C¢sSÂÖ#¢ãB×Óç·&öw&W74—FVÒò†—5Ebò2G´çVÖ&W"‡&öw&W74—FVÒç6V6öâÇÂ—Ó¤RG´çVÖ&W"‡&öw&W74—FVÒæW—6öFRÇÂ—ÒÒG·F—FÆWÖ¢F—FÆR’¢F—FÆWÓÂõG—öw&‡“à¢·&öw&W74—FVÒò€¢Å7F6²F—&V7F–öãÒ'&÷r"76–æs×³ã'Ò7ƒ×·²Æ–vä—FV×3¢&6VçFW""×Óà¢Ä&÷‚7ƒ×·²fÆWƒ¢Â†V–v‡C¢RÂ&÷&FW%&F—W3¢““’Â&v6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãb’"Â÷fW&fÆ÷s¢&†–FFVâ"×Óà¢Ä&÷‚7ƒ×·²v–GFƒ¢G·&öw&W75W&6VçGÒVÂ†V–v‡C¢#R"Â&6¶w&÷VæC¢"6SS“B"×Òóà¢Âô&÷ƒà¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢2ãRÂ6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãs"’"Âv†—FU76S¢&æ÷w&"×Óç·&VÖ–æ–æu6V6öæG2òG·6V6öæG5FW‡B‡&VÖ–æ–æu6V6öæG2—Ò&–ÖæVçF–¢%&—&VæF’'ÓÂõG—öw&‡“à¢Âõ7F6³à¢’¢€¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢2ãRÂ6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãb’"×Óç¶—5Ebò$–æ—¦–F3¤S"¢%&—&öGV6’–Âf–ÆÒ'ÓÂõG—öw&‡“à¢—Ð¢Âô&÷ƒà¢Âô&÷ƒà¢’¢çVÆÇÐ ¢¶7F—fUF"ÓÓÒ'G&–ÆW'2"ò€¢Ä&÷ƒà¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢&6Æ×ƒ#‡‚Â"ãGgrÂ3—‚’"ÂföçEvV–v‡C¢“ÂÆWGFW%76–æs¢"ãVÒ"ÂFW‡EG&ç6f÷&Ó¢'WW&66R"ÂÖ#¢ãb×ÓåG&–ÆW"bÇG&óÂõG—öw&‡“à¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢rÂ6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãc‚’"ÂÖ#¢"ã‚×Óå66÷&’G&–ÆW"R6öçFVçWF’f–FVòF—7öæ–&–Æ’W"VW7FòF—FöÆòãÂõG—öw&‡“à ¢·G&–ÆW$—FV×2æÆVæwF‚ò€¢Ä&÷‚7ƒ×·²F—7Æ“¢&w&–B"Âw&–EFV×ÆFT6öÇVÖç3¢²‡3¢#g""ÂÖC¢'&WVBƒ"Âg"’"Â†Ã¢'&WVBƒBÂg"’"ÒÂv¢ãb×Óà¢·G&–ÆW$—FV×2æÖ‚†—FVÓ¢ç’Â–æFWƒ¢çVÖ&W"’Óâ€¢Ä&÷€¢¶W“×¶—FVÒçW&ÇÐ¢öä6Æ–6³×²‚’Óâ°¢6WDÖöFÄ×WFVB†fÇ6R“°¢6WDÖöFÅG&–ÆW%W&Â†—FVÒçW&Â“°¢×Ð¢7ƒ×·°¢7W'6÷#¢'ö–çFW""À¢&÷&FW%&F—W3¢#‡‚"À¢÷fW&f÷s¢&†–FFVâ"À¢&v6öÆ÷#¢'&v&ƒ’Ã#Ã3ÂãƒB’"À¢&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂã2’"À¢&÷…6†F÷s¢#‡‚Cg‚&v&ƒÃÃÂã#B’"À¢G&ç6—F–öã¢'G&ç6f÷&Òƒ×2V6RÂ&÷&FW"Ö6öÆ÷"ƒ×2V6RÂ&6¶w&÷VæBÖ6öÆ÷"ƒ×2V6R"À¢"c¦†÷fW"#¢²G&ç6f÷&Ó¢'G&ç6ÆFU’‚Ó7‚’"Â&÷&FW$6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂã#b’"Â&v6öÆ÷#¢'&v&ƒBÃ#’ÃCÂã“R’"ÒÀ¢×Ð¢à¢Ä&÷‚7ƒ×·²÷6—F–öã¢'&VÆF—fR"Â7V7E&F–ó¢#bò’"Â&v6öÆ÷#¢"3s‚"Â÷fW&fÆ÷s¢&†–FFVâ"×Óà¢¶&6¶G&÷W&ÂòÄ&÷‚6ö×öæVçCÒ&–Ör"7&3×¶&6¶G&÷W&ÇÒÇCÒ""ÆöF–æsÒ&Æ§’"FV6öF–æsÒ&7–æ2"7ƒ×·²v–GFƒ¢#R"Â†V–v‡C¢#R"Âö&¦V7Df—C¢&6÷fW""Âö&¦V7E÷6—F–öã¢–æFW‚R"ò&6VçFW""¢&6VçFW"3R"Âf–ÇFW#¢–æFW‚ò&'&–v‡FæW72‚ãs‚’"¢&æöæR"×Òóâ¢çVÆÇÐ¢Ä&÷‚7ƒ×·²÷6—F–öã¢&'6öÇWFR"Â–ç6WC¢Â&6¶w&÷VæC¢&Æ–æV"Öw&F–VçBƒFVrÂ&v&ƒÃÃÂãCB’Â&v&ƒÃÃÂã2’SRR’"×Òóà¢Ä&÷‚7ƒ×·²÷6—F–öã¢&'6öÇWFR"ÂÆVgC¢‚Â&÷GFöÓ¢bÂv–GFƒ¢C‚Â†V–v‡C¢C‚Â&÷&FW%&F—W3¢#SR"ÂF—7Æ“¢&w&–B"ÂÆ6T—FV×3¢&6VçFW""Â&v6öÆ÷#¢'&v&ƒ’ÃbÃ#BÂãc"’"Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãs‚’"Â&6¶G&÷f–ÇFW#¢&&ÇW"ƒ‡‚’"×Óà¢ÅÆ”'&÷t–6öâ7ƒ×·²föçE6—¦S¢3×Òóà¢Âô&÷ƒà¢Âô&÷ƒà¢Ä&÷‚7ƒ×·²¢"ã×Óà¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢’ÂföçEvV–v‡C¢ƒSÂÖ#¢ã3R×Óç¶—FVÒæÆ&VÇÓÂõG—öw&‡“à¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢Bã"Â6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãb’"×Óç¶—FVÒç6÷W&6RòföçFS¢G¶—FVÒç6÷W&6WÖ¢%&—&öGV6’–ÂG&–ÆW"'ÓÂõG—öw&‡“à¢Âô&÷ƒà¢Âô&÷ƒà¢’—Ð¢Âô&÷ƒà¢’¢€¢Ä&÷‚7ƒ×·²Ö–ä†V–v‡C¢#CÂ&÷&FW%&F—W3¢##‚"Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂã’"Â&v6öÆ÷#¢'&v&ƒ’Ã#Ã3Âãr’"ÂF—7Æ“¢&w&–B"ÂÆ6T—FV×3¢&6VçFW""ÂFW‡DÆ–vã¢&6VçFW""Âƒ¢2×Óà¢Ä&÷ƒà¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢#BÂföçEvV–v‡C¢ƒSÂÖ#¢ãr×ÓåG&–ÆW"æöâF—7öæ–&–ÆSÂõG—öw&‡“à¢ÅG—öw&‡’7ƒ×·²6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãc"’"×Óä–Â6—7FVÖ6öçF–çVW,:6W&6&RWFöÖF–6ÖVçFRVæ6÷&vVçFRF—7öæ–&–ÆRãÂõG—öw&‡“à¢Âô&÷ƒà¢Âô&÷ƒà¢—Ð¢Âô&÷ƒà¢’¢çVÆÇÐ ¢¶7F—fUF"ÓÓÒ&F÷væÆöB"ò€¢Ä&÷‚7ƒ×·²F—7Æ“¢&w&–B"ÂÆ6T—FV×3¢&6VçFW""ÂÖ–ä†V–v‡C¢3c×Óà¢Ä&÷‚7ƒ×·²v–GFƒ¢&Ö–âƒ“‚ÂR’"ÂÖ–ä†V–v‡C¢#“Â&÷&FW%&F—W3¢##'‚"Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂã2’"Â&v6öÆ÷#¢'&v&ƒ’Ã#Ã3Âãs‚’"Â&÷…6†F÷s¢##G‚ƒ‚&v&ƒÃÃÂã#R’"Â&6¶G&÷f–ÇFW#¢&&ÇW"ƒg‚’"ÂF—7Æ“¢&w&–B"ÂÆ6T—FV×3¢&6VçFW""ÂFW‡DÆ–vã¢&6VçFW""Âƒ¢BÂ“¢R×Óà¢Ä&÷ƒà¢Ä&÷‚7ƒ×·²v–GFƒ¢"Â†V–v‡C¢"Â×ƒ¢&WFò"ÂÖ#¢"ãBÂ&÷&FW%&F—W3¢#SR"ÂF—7Æ“¢&w&–B"ÂÆ6T—FV×3¢&6VçFW""Â&÷&FW#¢#‚6öÆ–B&v&ƒ#"Ãƒ‚Ã#SRÂãCb’"Â&v6öÆ÷#¢'&v&ƒ#rÃƒÃ#bÂãR’"Â&÷…6†F÷s¢&–ç6WB3'‚&v&ƒSÃ’Ãs‚Âã"’"×Óà¢ÄF÷væÆöE&÷VæFVD–6öâ7ƒ×·²föçE6—¦S¢SRÂ6öÆ÷#¢"3–fCfb"×Òóà¢Âô&÷ƒà¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢&6Æ×ƒ#w‚Â"ã7grÂ3‡‚’"ÂföçEvV–v‡C¢“ÂÖ#¢×ÓäF÷væÆöBæöâæ6÷&F—7öæ–&–ÆSÂõG—öw&‡“à¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢&6Æ×ƒW‚Âã#WgrÂ—‚’"Â6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãcb’"×Óå7F–ÖòÆf÷&æFòW"&VæFW&ÆòF—7öæ–&–ÆRæVÆÆR&÷76–ÖRfW'6–öæ’ãÂõG—öw&‡“à¢Âô&÷ƒà¢Âô&÷ƒà¢Âô&÷ƒà¢’¢çVÆÇÐ ¢¶7F—fUF"ÓÓÒ'6–Ö–Æ""ò€¢Ä&÷ƒà¢ÅG—öw&‡’7ƒ×·²föçE6—¦S¢&6Æ×ƒ#‡‚Â"ãGgrÂ3—‚’"ÂföçEvV–v‡C¢“ÂÆWGFW%76–æs¢"ãVÒ"ÂFW‡EG&ç6f÷&Ó¢'WW&66R"ÂÖ#¢"ã"×ÓåF—FöÆ’6–Ö–Æ“ÂõG—öw&‡“à¢·&VÆFVD—FV×2æÆVæwF‚ò€¢Ä&÷‚7ƒ×·²F—7Æ“¢&fÆW‚"Âv¢ãCRÂ÷fW&fÆ÷uƒ¢&WFò"Â÷fW&fÆ÷u“¢'f—6–&ÆR"Â#¢BãRÂ67&öÆÅ6æG—S¢'‚&÷†–Ö—G’"Â"c£¢×vV&¶—B×67&öÆÆ&"#¢²†V–v‡C¢RÒÂ"c£¢×vV&¶—B×67&öÆÆ&"×F‡VÖ"#¢²&v6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂã‚’"Â&÷&FW%&F—W3¢““’Ò×Óà¢·&VÆFVD—FV×2ç6Æ–6RƒÂ3’æÖ‚†—FVÓ¢ç’’Óâ€¢Ä&÷‚¶W“×¶—FVÒæ–BÇÂ—FVÒçFÖF$–GÒ7ƒ×·²fÆWƒ¢#6Æ×ƒ#3W‚Â‡grÂ3W‚’"Â67&öÆÅ6æÆ–vã¢'7F'B"×Óà¢Åf–FVô—FVÕv—F„†÷fW"f–FVó×·²ââæ—FVÒÂG—S¢G—U6ÇVrÂÖVF–÷G—S¢G—U6ÇVr×ÒÖVF–G—S×·G—WÒóà¢Âô&÷ƒà¢’—Ð¢Âô&÷ƒà¢’¢€¢Ä&÷‚7ƒ×·²Ö–ä†V–v‡C¢#CÂF—7Æ“¢&w&–B"ÂÆ6T—FV×3¢&6VçFW""Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂã’"Â&÷&FW%&F—W3¢##‚"Â&v6öÆ÷#¢'&v&ƒ’Ã#Ã3Âãr’"×Óà¢ÅG—öw&‡’7ƒ×·²6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÂãc"’"×ÓäæW77VâF—FöÆò6–Ö–ÆRF—7öæ–&–ÆRãÂõG—öw&‡“à¢Âô&÷ƒà¢—Ð¢Âô&÷ƒà¢’¢çVÆÇÐ¢Âô&÷ƒà¢Âô&÷ƒà ¢¶ÖöFÅG&–ÆW%W&Âò€¢Ä&÷€¢&öÆSÒ&F–Æör ¢&–ÖÖöFÃÒ'G'VR ¢&–ÖÆ&VÃÒ%G&–ÆW" ¢öä6Æ–6³×²‚’Óâ6WDÖöFÅG&–ÆW%W&Â†çVÆÂ—Ð¢7ƒ×·²÷6—F–öã¢&f—†VB"Â–ç6WC¢Â¤–æFWƒ¢SÂ&v6öÆ÷#¢'&v&ƒÃÃÂãƒb’"ÂF—7Æ“¢&w&–B"ÂÆ6T—FV×3¢&6VçFW""Â¢²‡3¢ãRÂÖC¢BÒÂ&6¶G&÷f–ÇFW#¢&&ÇW"ƒ'‚’"Âæ–ÖF–öã¢&FWF–ÄÖöFÄ–âƒ×2V6RÖ÷WB"Â$¶W–g&ÖW2FWF–ÄÖöFÄ–â#¢²g&öÓ¢²÷6—G“¢ÒÂFó¢²÷6—G“¢ÒÒ×Ð¢à¢Ä&÷‚öä6Æ–6³×²†WfVçB’ÓâWfVçBç7F÷&÷vF–öâ‚—Ò7ƒ×·²÷6—F–öã¢'&VÆF—fR"Âv–GFƒ¢&Ö–âƒƒ‚Â“ggr’"Â7V7E&F–ó¢#bò’"Â&v6öÆ÷#¢"3"Â&÷&FW%&F—W3¢#‡‚"Â÷fW&f÷s¢&†–FFVâ"Â&÷…6†F÷s¢#C‚‚&v&ƒÃÃÂãcR’"Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãb’"×Óà¢ÅG&–ÆW%Æ–W"f–FVô¶W“×¶ÖöFÅG&–ÆW%W&ÇÒ×WFVC×¶ÖöFÄ×WFVGÒÆ––ærÆö÷×¶fÇ6WÒ¦ööÓ×³ÒöäVæFVC×²‚’Óâ6WDÖöFÅG&–ÆW%W&Â†çVÆÂ—ÒöäW'&÷#×²‚’Óâ6WDÖöFÅG&–ÆW%W&Â†çVÆÂ—Òóà¢Ä–6öä'WGFöâöä6Æ–6³×²‚’Óâ6WDÖöFÅG&–ÆW%W&Â†çVÆÂ—Ò&–ÖÆ&VÃÒ$6†—VF’G&–ÆW""7ƒ×·²÷6—F–öã¢&'6öÇWFR"ÂF÷¢BÂ&–v‡C¢BÂ¤–æFWƒ¢2Â&v6öÆ÷#¢'&v&ƒÃÃÂãc"’"Â6öÆ÷#¢"6ffb"Â&÷&FW#¢#‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂã3"’"Â"c¦†÷fW"#¢²&v6öÆ÷#¢'&v&ƒÃÃÂãƒ"’"Ò×Óà¢Ä6Æ÷6T–6öâóà¢Âô–6öä'WGFöãà¢Ä&÷‚7ƒ×·²÷6—F–öã¢&'6öÇWFR"Â&–v‡C¢BÂ&÷GFöÓ¢BÂ¤–æFWƒ¢2×Óà¢ÅG&–ÆW$VF–ô'WGFöâ×WFVC×¶ÖöFÄ×WFVGÒöåFövvÆS×²‚’Óâ6WDÖöFÄ×WFVB‚‚fÇVR’ÓâfÇVR—ÒFW7D–CÒ&FWF–ÂÖÖöFÂ×G&–ÆW"ÖVF–ò×FövvÆR"óà¢Âô&÷ƒà¢Âô&÷ƒà¢Âô&÷ƒà¢’¢çVÆÇÐ¢Âô&÷ƒà¢“°§Ð ¦W‡÷'BFVfVÇB6ö×öæVçC° 