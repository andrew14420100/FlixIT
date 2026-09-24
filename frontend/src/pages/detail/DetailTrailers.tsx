// @ts-nocheck
import { useEffect, useState } from "react";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import DetailTrailerModal from "./DetailTrailerModal";
import { clockText, isHlsUrl } from "./detailUtils";

/** Lightweight duration probe (metadata only, MP4 only - never touches HLS manifests). */
function useVideoDuration(url) {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setDuration(0);
    if (!url || isHlsUrl(url) || typeof document === "undefined") return undefined;
    let alive = true;
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;

    const release = () => {
      probe.removeEventListener("loadedmetadata", onMeta);
      probe.removeEventListener("error", release);
      probe.removeAttribute("src");
      try { probe.load(); } catch { /* detached probe */ }
    };
    const onMeta = () => {
      if (alive && Number.isFinite(probe.duration) && probe.duration > 0) setDuration(probe.duration);
      release();
    };

    probe.addEventListener("loadedmetadata", onMeta);
    probe.addEventListener("error", release);
    probe.src = url;

    return () => {
      alive = false;
      release();
    };
  }, [url]);

  return duration;
}

function TrailerCard({ item, index, title, backdropUrl, onOpen }) {
  const duration = useVideoDuration(item.url);
  const description = index === 0 && /trailer ufficiale/i.test(item.label)
    ? `Il trailer ufficiale di ${title || "questo titolo"}.`
    : `${item.label} di ${title || "questo titolo"}.`;

  const onKey = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(item.url);
    }
  };

  return (
    <div
      className="dp-trailer-card"
      role="button"
      tabIndex={0}
      aria-label={`Riproduci ${item.label}`}
      onClick={() => onOpen(item.url)}
      onKeyDown={onKey}
      data-testid={`detail-trailer-card-${index}`}
    >
      <div className="dp-trailer-card__thumb">
        {backdropUrl ? (
          <img src={backdropUrl} alt="" loading="lazy" decoding="async" style={{ objectPosition: index % 2 ? "62% 30%" : "center 28%" }} />
        ) : null}
        <span className="dp-play-circle" aria-hidden="true"><PlayArrowRoundedIcon /></span>
        {duration ? <span className="dp-trailer-card__duration" data-testid={`detail-trailer-duration-${index}`}>{clockText(duration)}</span> : null}
      </div>
      <div className="dp-trailer-card__body">
        <div className="dp-trailer-card__text">
          <h3 className="dp-trailer-card__title">{item.label}</h3>
          <p className="dp-trailer-card__desc">{description}</p>
        </div>
        <MoreVertRoundedIcon className="dp-trailer-card__menu" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function DetailTrailers({ data }) {
  const { trailerItems, backdropUrl, title } = data;
  const [modalUrl, setModalUrl] = useState(null);

  return (
    <div data-testid="detail-trailers">
      <h2 className="dp-section-title">Trailer &amp; altro</h2>
      <p className="dp-section-sub">Scopri trailer, contenuti speciali e uno sguardo esclusivo dietro le quinte.</p>
      {trailerItems.length ? (
        <div className="dp-trailer-grid">
          {trailerItems.slice(0, 8).map((item, index) => (
            <TrailerCard key={item.url} item={item} index={index} title={title} backdropUrl={backdropUrl} onOpen={setModalUrl} />
          ))}
        </div>
      ) : (
        <div className="dp-card dp-empty" data-testid="detail-trailers-empty">Trailer non disponibile</div>
      )}
      {modalUrl ? <DetailTrailerModal url={modalUrl} onClose={() => setModalUrl(null)} /> : null}
    </div>
  );
}
