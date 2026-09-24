// @ts-nocheck
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import TrailerPlayer from "src/components/TrailerPlayer";
import TrailerAudioButton from "src/components/TrailerAudioButton";

function TrailerModal({ url, onClose }) {
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fxd-modal" role="dialog" aria-modal="true" aria-label="Trailer" onClick={onClose} data-testid="detail-trailer-modal">
      <div className="fxd-modal__body" onClick={(event) => event.stopPropagation()}>
        {failed ? (
          <div className="fxd-empty" style={{ height: "100%" }} data-testid="detail-trailer-modal-error">Trailer non disponibile</div>
        ) : (
          <TrailerPlayer key={url} videoKey={url} muted={muted} playing loop={false} zoom={1} onEnded={onClose} onError={() => setFailed(true)} />
        )}
        <button type="button" className="fxd-modal__close" onClick={onClose} aria-label="Chiudi trailer" data-testid="detail-trailer-modal-close">
          <CloseRoundedIcon />
        </button>
        {!failed ? (
          <div className="fxd-modal__audio">
            <TrailerAudioButton muted={muted} onToggle={() => setMuted((value) => !value)} testId="detail-modal-trailer-audio-toggle" />
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

export default function TrailersTab({ data }) {
  const { trailerItems, backdropUrl, title } = data;
  const [modalUrl, setModalUrl] = useState(null);

  return (
    <div data-testid="detail-trailers">
      <h2 className="fxd-section-title">Trailer &amp; altro</h2>
      <p className="fxd-section-sub">Scopri trailer e contenuti video disponibili per {title || "questo titolo"}.</p>
      {trailerItems.length ? (
        <div className="fxd-trailer-grid">
          {trailerItems.slice(0, 4).map((item, index) => (
            <div
              key={item.url}
              className="fxd-trailer-card"
              role="button"
              tabIndex={0}
              onClick={() => setModalUrl(item.url)}
              onKeyDown={(event) => event.key === "Enter" && setModalUrl(item.url)}
              data-testid={`detail-trailer-card-${index}`}
            >
              <div className="fxd-trailer-card__thumb">
                {backdropUrl ? <img src={backdropUrl} alt="" loading="lazy" decoding="async" style={{ objectPosition: index % 2 ? "60% center" : "center 25%" }} /> : null}
                <span className="fxd-play-circle"><PlayArrowRoundedIcon /></span>
              </div>
              <div className="fxd-trailer-card__body">
                <div style={{ minWidth: 0 }}>
                  <h3 className="fxd-trailer-card__title">{item.label}</h3>
                  <p className="fxd-trailer-card__desc">
                    {item.source ? `Fonte: ${item.source}` : "Guarda il video in anteprima."}
                  </p>
                </div>
                <MoreVertRoundedIcon className="fxd-trailer-card__menu" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="fxd-card fxd-empty" data-testid="detail-trailers-empty">Trailer non disponibile</div>
      )}
      {modalUrl ? <TrailerModal url={modalUrl} onClose={() => setModalUrl(null)} /> : null}
    </div>
  );
}
