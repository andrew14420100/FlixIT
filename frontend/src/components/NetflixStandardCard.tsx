// @ts-nocheck
import { forwardRef, useEffect, useMemo, useState } from "react";
import "./NetflixMiniModalExact.css";

interface Props {
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  imageCandidates?: Array<string | null | undefined>;
  title?: string;
  href?: string;
  onClick?: any;
  onMouseEnter?: any;
  onMouseLeave?: any;
  watch?: any;
  testId?: string;
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
    title = "",
    href = "#",
    onClick,
    onMouseEnter,
    onMouseLeave,
    watch,
    testId,
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

  return (
    <div
      ref={ref}
      className="netflix-standard-card-root"
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
          <div className="netflix-standard-card-image-wrap">
            {src ? (
              <img
                src={src}
                alt=""
                width="342"
                height="192"
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={() => setCandidateIndex((index) => index + 1)}
                className="standard-card tracked-card netflix-standard-card-image"
              />
            ) : (
              <div className="netflix-standard-card-placeholder">{title}</div>
            )}

            {watch && Number(watch.percent || 0) > 0 && (
              <div
                className="netflix-standard-card-progress-track"
                aria-hidden="true"
              >
                <div
                  className="netflix-standard-card-progress-value"
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, Number(watch.percent || 0))
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </a>
    </div>
  );
});

export default NetflixStandardCard;
