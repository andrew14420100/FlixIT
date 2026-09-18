// @ts-nocheck
import { forwardRef, useState } from "react";
import "./NetflixMiniModalExact.css";

interface Props {
  imageUrl?: string | null;
  title?: string;
  href?: string;
  onClick?: any;
  onMouseEnter?: any;
  onMouseLeave?: any;
  watch?: any;
  testId?: string;
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 16, height: 16, display: "block" }}>
      <path
        d="M6.3 5 12 10.7 17.7 5 19 6.3 13.3 12 19 17.7 17.7 19 12 13.3 6.3 19 5 17.7 10.7 12 5 6.3z"
        fill="currentColor"
      />
    </svg>
  );
}

const NetflixStandardCard = forwardRef<HTMLDivElement, Props>(function NetflixStandardCard(
  {
    imageUrl,
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
  const [hovered, setHovered] = useState(false);
  const canRemove = typeof watch?.onRemove === "function";

  return (
    <div
      ref={ref}
      className="netflix-standard-card-root"
      onMouseEnter={(event) => {
        setHovered(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        onMouseLeave?.(event);
      }}
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
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                width="342"
                height="192"
                loading="lazy"
                draggable={false}
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

      {canRemove && (
        <button
          type="button"
          aria-label="Rimuovi da Continua a guardare"
          title="Rimuovi dalla riga"
          data-testid={`${testId || "video-card"}-remove`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            watch.onRemove?.();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          style={{
            position: "absolute",
            right: 8,
            top: 8,
            zIndex: 8,
            width: 30,
            height: 30,
            padding: 0,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,.72)",
            background: "rgba(24,24,24,.88)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            opacity: hovered ? 1 : 0,
            transform: hovered ? "scale(1)" : "scale(.88)",
            transition: "opacity 120ms linear, transform 160ms cubic-bezier(.21,0,.07,1), background-color 120ms linear",
            boxShadow: "0 1px 4px rgba(0,0,0,.45)",
            pointerEvents: hovered ? "auto" : "none",
          }}
        >
          <RemoveIcon />
        </button>
      )}
    </div>
  );
});

export default NetflixStandardCard;
