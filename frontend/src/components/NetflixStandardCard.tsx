// @ts-nocheck
import { forwardRef, useEffect, useState } from "react";
import "./NetflixMiniModalExact.css";

interface Props {
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  title?: string;
  href?: string;
  onClick?: any;
  onMouseEnter?: any;
  onMouseLeave?: any;
  watch?: any;
  testId?: string;
}

const NetflixStandardCard = forwardRef<HTMLDivElement, Props>(function NetflixStandardCard(
  {
    imageUrl,
    fallbackImageUrl,
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
  const [src, setSrc] = useState(imageUrl || fallbackImageUrl || null);

  useEffect(() => {
    setSrc(imageUrl || fallbackImageUrl || null);
  }, [imageUrl, fallbackImageUrl]);

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
                onError={() => {
                  if (fallbackImageUrl && src !== fallbackImageUrl) {
                    setSrc(fallbackImageUrl);
                  } else {
                    setSrc(null);
                  }
                }}
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
