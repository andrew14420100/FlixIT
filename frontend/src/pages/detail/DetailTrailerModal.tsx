// @ts-nocheck
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import TrailerPlayer from "src/components/TrailerPlayer";
import TrailerAudioButton from "src/components/TrailerAudioButton";

export default function DetailTrailerModal({ url, onClose }) {
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  // ESC closes; body scroll locked while open (restored on unmount).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="dp-modal" role="dialog" aria-modal="true" aria-label="Trailer" onClick={onClose} data-testid="detail-trailer-modal">
      <div className="dp-modal__body" onClick={(event) => event.stopPropagation()}>
        {failed ? (
          <div className="dp-modal__error" data-testid="detail-trailer-modal-error">Trailer non disponibile</div>
        ) : (
          <TrailerPlayer
            key={url}
            videoKey={url}
            muted={muted}
            playing
            loop={false}
            zoom={1}
            onEnded={onClose}
            onError={() => setFailed(true)}
          />
        )}
        <button type="button" className="dp-modal__close" onClick={onClose} aria-label="Chiudi trailer" data-testid="detail-trailer-modal-close">
          <CloseRoundedIcon />
        </button>
        {!failed ? (
          <div className="dp-modal__audio">
            <TrailerAudioButton muted={muted} onToggle={() => setMuted((value) => !value)} testId="detail-modal-toggle-mute" />
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
