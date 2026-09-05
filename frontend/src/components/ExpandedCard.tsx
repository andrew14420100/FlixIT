// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import AddIcon from "@mui/icons-material/Add";
import StarIcon from "@mui/icons-material/Star";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import CloseIcon from "@mui/icons-material/Close";
import { MEDIA_TYPE } from "src/types/Common";
import { useGetGenresQuery } from "src/store/slices/genre";
import TrailerPlayer from "./TrailerPlayer";

export const TMDB_IMG = "https://image.tmdb.org/t/p/";
const TRAILER_DELAY_MS = 5000;

const circleBtn = {
  width: 40, height: 40, color: "#fff",
  border: "2px solid rgba(255,255,255,0.5)", bgcolor: "rgba(30,30,30,0.6)",
  transition: "border-color 0.15s, background-color 0.15s",
  "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,0.12)" },
};

export const hasAssets = (item) => item && item.trailer_key !== undefined && item.logo_path !== undefined;

export function useMediaAssets(item, mediaType) {
  const [assets, setAssets] = useState(() => (hasAssets(item) ? item : null));
  const id = item?.id || item?.tmdbId;
  useEffect(() => {
    if (assets || !id) return;
    let alive = true;
    fetch(`/api/public/media-assets/${mediaType === MEDIA_TYPE.Tv ? "tv" : "movie"}/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setAssets(d))
      .catch(() => {});
    return () => { alive = false; };
  }, [assets, id, mediaType]);
  return assets || {};
}

export const formatRuntime = (min) => {
  if (!min) return null;
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}min` : ""}`.trim() : `${min} min`;
};

interface Props { item: any; mediaType: MEDIA_TYPE; onPlay: (e) => void; onDetail: (e?) => void; entered?: boolean; watch?: any; }

const MONTHS_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const formatReleaseLabel = (date) => {
  if (!date) return "Prossimamente";
  const [y, m, d] = String(date).split("-").map(Number);
  if (!y || !m || !d) return "Prossimamente";
  return `In arrivo il ${d} ${MONTHS_IT[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ""}`;
};

// Episode name for "Continua a guardare" entries (TV only)
function useEpisodeName(id, watch, enabled) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!enabled || !watch?.season || !id) return;
    let alive = true;
    fetch(`/api/public/tv/${id}/season/${watch.season}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { const ep = (d?.episodes || []).find((e) => e.episode_number === Number(watch.episode || 1)); if (alive && ep) setName(ep.name || ""); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id, watch?.season, watch?.episode, enabled]);
  return name;
}

export default function ExpandedCard({ item, mediaType, onPlay, onDetail, entered = true, watch }: Props) {
  const { data: genres } = useGetGenresQuery(mediaType);
  const assets = useMediaAssets(item, mediaType);
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const id = item.id || item.tmdbId;
  const isUpcoming = !!item.upcoming;
  const episodeName = useEpisodeName(id, watch, mediaType === MEDIA_TYPE.Tv && !!watch);

  const [trailerKey, setTrailerKey] = useState(null);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const mType = mediaType === MEDIA_TYPE.Tv ? "tv" : "movie";

  // Trailer starts after 5s: StreamingCommunity trailer when available, TMDB otherwise
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetch(`/api/public/trailer/${mType}/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return;
          setTrailerKey(d?.trailer_key || assetsRef.current.trailer_key || null);
          setShowTrailer(true);
        })
        .catch(() => {
          if (!alive) return;
          setTrailerKey(assetsRef.current.trailer_key || null);
          setShowTrailer(true);
        });
    }, TRAILER_DELAY_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [id, mType]);

  const titled = assets.titled_backdrop_path || item.titled_backdrop_path;
  const backdrop = titled || item.backdrop_path || assets.backdrop_path;
  const poster = item.poster_path || assets.poster_path;
  const imageUrl = backdrop ? `${TMDB_IMG}w780${backdrop}` : poster ? `${TMDB_IMG}w500${poster}` : null;
  const logoUrl = assets.logo_path ? `${TMDB_IMG}w300${assets.logo_path}` : null;
  const trailerOn = showTrailer && !!trailerKey;
  const trailerVisible = trailerOn && trailerPlaying;

  const rating = item.vote_average ? Number(item.vote_average).toFixed(1) : null;
  const year = (item.release_date || item.first_air_date || "").split("-")[0];
  const seasons = assets.number_of_seasons;
  const lengthStr = mediaType === MEDIA_TYPE.Tv && seasons
    ? `${seasons} stagion${seasons > 1 ? "i" : "e"}`
    : formatRuntime(assets.runtime || item.runtime);
  const cert = assets.certification;
  const genreNames = useMemo(() => {
    const ids = item.genre_ids?.length ? item.genre_ids : assets.genre_ids || [];
    if (!genres) return [];
    return genres.filter((g) => ids.includes(g.id)).map((g) => g.name).slice(0, 3);
  }, [genres, item.genre_ids, assets.genre_ids]);

  return (
    <div
      data-testid={`expanded-card-${id}`}
      style={{ borderRadius: 8, overflow: "hidden", background: "#181818", boxShadow: "0 24px 60px rgba(0,0,0,0.85)" }}
    >
      {/* Media area */}
      <div onClick={onDetail} style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: "#000", cursor: "pointer" }}>
        {imageUrl && (
          <img
            src={imageUrl} alt={item.title || item.name || ""} draggable={false}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
              opacity: trailerVisible ? 0 : 1, transition: "opacity 0.7s ease" }}
          />
        )}
        {trailerOn && (
          <div style={{ position: "absolute", inset: 0, opacity: trailerVisible ? 1 : 0, transition: "opacity 0.7s ease" }}>
            <TrailerPlayer videoKey={trailerKey} muted={muted} zoom={1.35} onPlaying={() => setTrailerPlaying(true)} />
          </div>
        )}
        <div style={{ position: "absolute", inset: 0, zIndex: 3, cursor: "pointer" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "55%", zIndex: 4, pointerEvents: "none",
          background: "linear-gradient(to top, rgba(24,24,24,0.95) 0%, rgba(24,24,24,0.4) 55%, transparent 100%)" }} />
        {logoUrl && (trailerVisible || !titled) && (
          <img
            src={logoUrl} alt="" data-testid={`card-logo-${id}`}
            style={{ position: "absolute", left: 14, bottom: 12, zIndex: 5, maxWidth: "42%", maxHeight: 52,
              objectFit: "contain", pointerEvents: "none", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.9))" }}
          />
        )}
        {trailerVisible && (
          <IconButton
            data-testid={`card-mute-${id}`}
            onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
            sx={{ ...circleBtn, width: 44, height: 44, position: "absolute", right: 12, bottom: 12, zIndex: 6, bgcolor: "rgba(0,0,0,0.45)", borderColor: "rgba(255,255,255,0.6)" }}
          >
            {muted ? <VolumeOffIcon sx={{ fontSize: 22 }} /> : <VolumeUpIcon sx={{ fontSize: 22 }} />}
          </IconButton>
        )}
      </div>

      {/* Info panel */}
      <div style={{ padding: "14px 16px 16px", opacity: entered ? 1 : 0, transition: "opacity 220ms ease 60ms" }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.4 }}>
          <IconButton
            onClick={onPlay} data-testid={`card-play-${id}`}
            sx={{ width: 40, height: 40, bgcolor: "#fff", color: "#000", "&:hover": { bgcolor: "rgba(255,255,255,0.85)" } }}
          >
            <PlayArrowIcon sx={{ fontSize: 26 }} />
          </IconButton>
          <IconButton sx={circleBtn} data-testid={`card-add-${id}`}><AddIcon sx={{ fontSize: 20 }} /></IconButton>
          <IconButton sx={circleBtn} data-testid={`card-star-${id}`}><StarIcon sx={{ fontSize: 18 }} /></IconButton>
          {watch?.onRemove && (
            <IconButton onClick={(e) => { e.stopPropagation(); watch.onRemove(); }} sx={circleBtn} data-testid={`card-remove-${id}`} aria-label="Rimuovi da Continua a guardare">
              <CloseIcon sx={{ fontSize: 20 }} />
            </IconButton>
          )}
          <div style={{ flex: 1 }} />
          <IconButton onClick={onDetail} sx={circleBtn} data-testid={`card-expand-${id}`}>
            <ExpandMoreIcon sx={{ fontSize: 22 }} />
          </IconButton>
        </Stack>

        {isUpcoming && (
          <Typography data-testid={`card-upcoming-${id}`} sx={{ fontSize: 14, fontWeight: 700, color: "#ff2e38", letterSpacing: "0.02em", mb: 0.6, textTransform: "uppercase" }}>
            {formatReleaseLabel(item.release_date)}
          </Typography>
        )}
        {watch && (
          <div data-testid={`card-watch-meta-${id}`} style={{ marginBottom: 10 }}>
            {mediaType === MEDIA_TYPE.Tv && watch.season && (
              <Typography sx={{ fontSize: 14.5, color: "#fff", fontWeight: 600, lineHeight: 1.3 }}>
                S{watch.season}:E{watch.episode || 1}{episodeName ? ` "${episodeName}"` : ""}
              </Typography>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.25)", borderRadius: 2 }}>
                <div style={{ width: `${watch.percent || 0}%`, height: "100%", background: "#e50914", borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap" }}>{watch.minutesLabel}</span>
            </div>
          </div>
        )}
        <Typography sx={{ fontSize: 15, lineHeight: 1.3, color: "rgba(255,255,255,0.85)", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
          {rating && <span style={{ color: "#46d369", fontWeight: 700 }}>Valutazione {rating}</span>}
          {rating && year && <span style={{ color: "rgba(255,255,255,0.5)" }}>-</span>}
          {year && <span>{year}</span>}
          {lengthStr && <span style={{ color: "rgba(255,255,255,0.5)" }}>-</span>}
          {lengthStr && <span>{lengthStr}</span>}
          {cert && (
            <span style={{ padding: "0 5px", border: "1px solid rgba(255,255,255,0.45)", borderRadius: 3,
              fontSize: 11, fontWeight: 600, lineHeight: "17px", color: "rgba(255,255,255,0.75)" }}>{cert}</span>
          )}
        </Typography>

        {genreNames.length > 0 && (
          <Typography data-testid={`card-genres-${id}`} sx={{ fontSize: 14, mt: 0.8, color: "rgba(255,255,255,0.75)" }}>
            {genreNames.join("  \u2022  ")}
          </Typography>
        )}
      </div>
    </div>
  );
}
