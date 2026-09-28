// @ts-nocheck
import { forwardRef, useEffect, useMemo, useState } from "react";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import "./NetflixMiniModalExact.css";

interface Props {
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  imageCandidates?: Array<string | null | undefined>;
  embeddedTitleTreatment?: boolean;
  title?: string;
  href?: string;
  onClick?: any;
  onMouseEnter?: any;
  onMouseLeave?: any;
  watch?: any;
  testId?: string;
  portrait?: boolean;
}

function uniqueCandidates(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

const NetflixStandardCard = forwardRef<HTMLDivElement, Props>(function NetflixStandardCard(
  {
    imageUrl,
    fallbackImageUrl,
    imageCandidates = [],
    embeddedTitleTreatment = false,
    title = "",
    href = "#",
    onClick,
    onMouseEnter,
    onMouseLeave,
    watch,
    testId,
    portrait = false,
  },
  ref
) {
  const candidates = useMemo(
    () => uniqueCandidates([imageUrl, ...imageCandidates, fallbackImageUrl]),
    [imageUrl, imageCandidates, fallbackImageUrl]
  );
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates.join("|")]);

  const src = candidates[candidateIndex] || null;
  if (!src || !embeddedTitleTreatment) return null;

  const stopCardInteraction = (event: any) => {
    event.preventDefault?.();
    event.stopPropagation?.();
  };

  const removeFromContinueWatching = (event: any) => {
    stopCardInteraction(event);
    watch?.onRemove?.();
  };

  return (
    <div
      ref={ref}
      className={`netflix-standard-card-root flixit-mobile-poster${portrait ? " is-portrait" : ""}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid={testId}
    >
      <a
        href={href}
        aria-label={title}
        data-uia="standard-card"
        className="netflix-standard-card-link"
        onClick={onClick}
      >
        <div className="netflix-standard-card-frame">
          <div
            className="netflix-standard-card-image-wrap"
            style={{ position: "relative", overflow: "hidden" }}
          >
            <img
              src={src}
              alt=""
              width={portrait ? 500 : 342}
              height={portrait ? 750 : 192}
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setCandidateIndex((index) => index + 1)}
              className="standard-card tracked-card netflix-standard-card-image"
            />

            {watch && Number(watch.percent || 0) > 0 && (
              <div className="netflix-standard-card-progress-track" aria-hidden="true">
                <div
                  className="netflix-standard-card-progress-value"
                  style={{
                    width: `${Math.max(0, Math.min(100, Number(watch.percent || 0)))}%`,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </a>

      {watch?.onRemove ? (
        <button
          type="button"
          className="netflix-standard-card-remove"
          aria-label={`Rimuovi ${title || "contenuto"} da Continua a guardare`}
          title="Rimuovi da Continua a guardare"
          data-testid={`continue-watching-remove-${videoSafeId(title)}`}
          onMouseDown={stopCardInteraction}
          onTouchStart={(event) => event.stopPropagation?.()}
          onClick={removeFromContinueWatching}
          style={{
            position: "absolute",
            top: 7,
            right: 7,
            zIndex: 12,
            width: 30,
            height: 30,
            padding: 0,
            margin: 0,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,.72)",
            background: "rgba(8,8,8,.82)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 2px 10px rgba(0,0,0,.38)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <CloseRoundedIcon
            className="netflix-standard-card-remove-icon"
            aria-hidden="true"
            sx={{ fontSize: 20, pointerEvents: "none" }}
          />
        </button>
      ) : null}
    </div>
  );
});

function videoSafeId(value: any) {
  return String(value || "contenuto").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "contenuto";
}

export default NetflixStandardCard;
