// @ts-nocheck
import { forwardRef, useEffect, useMemo, useState } from "react";
import "./NetflixMiniModalExact.css";

interface Props {
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  imageCandidates?: Array<string | null | undefined>;
  logoUrl?: string | null;
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
    logoUrl,
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
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates.join("|")]);

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  const src = candidates[candidateIndex] || null;
  const showRealLogo = Boolean(logoUrl && !logoFailed);

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
          <div
            className="netflix-standard-card-image-wrap"
            style={{ position: "relative", overflow: "hidden" }}
          >
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
              <div className="netflix-standard-card-placeholder" aria-hidden="true" />
            )}

            {src && showRealLogo ? (
              <div
                aria-hidden="true"
                className="netflix-standard-card-title-treatment"
                style={{
                  position: "absolute",
                  left: "7%",
                  right: "7%",
                  bottom: watch && Number(watch.percent || 0) > 0 ? "12%" : "7%",
                  height: "34%",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              >
                <img
                  src={logoUrl || ""}
                  alt=""
                  draggable={false}
                  decoding="async"
                  onError={() => setLogoFailed(true)}
                  style={{
                    display: "block",
                    maxWidth: "78%",
                    maxHeight: "100%",
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                    filter: "drop-shadow(0 2px 5px rgba(0,0,0,.82))",
                  }}
                />
              </div>
            ) : null}

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
