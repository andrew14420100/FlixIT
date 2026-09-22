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

  const removeFromContinueWatching = (event: any) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    watch?.onRemove?.();
  };

  return (
    <div
      ref={ref}
      className={`netflix-standard-card-root${portrait ? " is-portrait" : ""}`}
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
          onClick={removeFromContinueWatching}
        >
          <CloseRoundedIcon className="netflix-standard-card-remove-icon" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
});

export default NetflixStandardCard;
