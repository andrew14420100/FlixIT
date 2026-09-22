// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "src/components/NetflixMiniModalExact.css";
import "src/components/NetflixMotionOverrides.css";

/*
 * StreamingCommunity hover behaviour, ported from the supplied sliders bundle.
 * Important values from SC:
 * - hover intent delay: 300ms
 * - preview width: source width * 1.5
 * - initial scale: .666667
 * - preview activation after mount: 25ms
 * - transform transition: 200ms (default CSS easing = ease)
 * - top: offsetY - (source height * 2 / 3)
 * - horizontal origin: left / center / right depending on source x
 * - opening translateY depends on viewport width
 * - close duration: 200ms
 */
const OPEN_DELAY_MS = 300;
const READY_DELAY_MS = 25;
const TRANSFORM_DURATION_MS = 200;
const INITIAL_SCALE = 0.666667;

type AnchorData = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  modalWidth: number;
  fadeImageOut: boolean;
  anchor: HTMLElement | null;
};

function isElement(value: any): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
}

function hasPreview() {
  return typeof document !== "undefined" && !!document.querySelector(".preview-wrap");
}

function scTranslateY(viewportWidth: number) {
  let value = (3 / 130) * viewportWidth - 69 / 13;
  if (viewportWidth < 1400) value = (9 / 299) * viewportWidth - 2126 / 299;
  if (viewportWidth < 1100) value = (9 / 299) * viewportWidth + 574 / 299;
  return value;
}

export function useHoverExpand(ref: React.RefObject<HTMLElement>) {
  const openTimerRef = useRef<any>(null);
  const removeTimerRef = useRef<any>(null);
  const openRef = useRef(false);

  const [intent, setIntent] = useState(false);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState<AnchorData | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (!openTimerRef.current) return;
    clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);

  const clearRemoveTimer = useCallback(() => {
    if (!removeTimerRef.current) return;
    clearTimeout(removeTimerRef.current);
    removeTimerRef.current = null;
  }, []);

  const finishClose = useCallback(() => {
    clearRemoveTimer();
    openRef.current = false;
    setOpen(false);
    setClosing(false);
    setIntent(false);
    setPosition(null);
  }, [clearRemoveTimer]);

  const closePreview = useCallback(() => {
    clearOpenTimer();
    setIntent(false);

    if (!openRef.current) {
      finishClose();
      return;
    }

    setClosing(true);
    clearRemoveTimer();
    removeTimerRef.current = setTimeout(() => {
      removeTimerRef.current = null;
      finishClose();
    }, TRANSFORM_DURATION_MS);
  }, [clearOpenTimer, clearRemoveTimer, finishClose]);

  const onEnter = useCallback((event?: any) => {
    const element = (event?.currentTarget || ref.current) as HTMLElement | null;
    if (!element || typeof window === "undefined") return;

    clearOpenTimer();
    clearRemoveTimer();
    setIntent(true);

    if (openRef.current) return;

    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;

      // SC refuses to create a second preview while one is already mounted.
      if (hasPreview() || !element.isConnected) return;

      const rect = element.getBoundingClientRect();
      let offsetY = rect.top + window.scrollY;
      const isTop10 = element.classList.contains("netflix-ranked-card-root") ||
        !!element.closest(".top10-row");

      // Exact extra vertical adjustment used by SC for Top 10.
      if (isTop10) offsetY += rect.top / 16;

      const width = element.clientWidth || rect.width;
      const height = element.clientHeight || rect.height;

      setPosition({
        offsetX: rect.left,
        offsetY,
        width,
        height,
        modalWidth: width * 1.5,
        fadeImageOut: isTop10,
        anchor: element,
      });

      openRef.current = true;
      setClosing(false);
      setOpen(true);
    }, OPEN_DELAY_MS);
  }, [clearOpenTimer, clearRemoveTimer, ref]);

  const onLeave = useCallback((event?: any) => {
    const related = event?.relatedTarget;

    // Exact SC hand-off: moving directly from the source card into the
    // teleported preview does not close it.
    if (isElement(related) && related.closest(".preview-wrap")) return;

    clearOpenTimer();
    closePreview();
  }, [clearOpenTimer, closePreview]);

  const onOverlayEnter = useCallback(() => {
    // SC does not restart the animation when the pointer enters the preview.
    clearRemoveTimer();
  }, [clearRemoveTimer]);

  const onOverlayLeave = useCallback(() => {
    closePreview();
  }, [closePreview]);

  useEffect(() => () => {
    clearOpenTimer();
    clearRemoveTimer();
  }, [clearOpenTimer, clearRemoveTimer]);

  return {
    open,
    intent,
    entered: open && !closing,
    display: open && !closing,
    closing,
    position,
    width: position?.modalWidth,
    align: "center",
    onEnter,
    onLeave,
    onOverlayEnter,
    onOverlayLeave,
    closePreview,
  };
}

export function ExpandOverlay({
  position,
  closing = false,
  onMouseEnter,
  onMouseLeave,
  onClick,
  children,
  testId,
}: any) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const timer = setTimeout(() => setReady(true), READY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [position]);

  // SC starts observing the pointer globally only after the 200ms opening
  // transition. Leaving .preview-wrap then dispatches the close behaviour.
  useEffect(() => {
    if (!position || typeof window === "undefined") return;

    let handler: any = null;
    const timer = setTimeout(() => {
      handler = (event: MouseEvent) => {
        const target = event.target;
        if (!isElement(target) || !target.closest(".preview-wrap")) {
          onMouseLeave?.(event);
        }
      };
      window.addEventListener("mousemove", handler);
    }, TRANSFORM_DURATION_MS);

    return () => {
      clearTimeout(timer);
      if (handler) window.removeEventListener("mousemove", handler);
    };
  }, [position, onMouseLeave]);

  if (!position || typeof document === "undefined" || typeof window === "undefined") return null;

  const viewportWidth = window.innerWidth;
  const modalWidth = Math.round(position.width * 1.5);
  const top = Math.round(position.offsetY - (position.height / 3) * 2);

  let left = position.offsetX;
  let transformOrigin = "left center";

  if (left > (viewportWidth / 100) * 70) {
    left -= position.width / 2;
    transformOrigin = "right center";
  } else if (left > (viewportWidth / 100) * 5) {
    left -= position.width / 4;
    transformOrigin = "center center";
  }

  const startTranslateY = scTranslateY(viewportWidth);
  const expanded = ready && !closing;
  const transform = expanded
    ? "translateY(0px) scale(1)"
    : `translateY(${startTranslateY}px) scale(${INITIAL_SCALE})`;

  let opacity = ready ? 1 : 0;
  let transition = `transform ${TRANSFORM_DURATION_MS}ms`;
  let boxShadow = "none";

  if (expanded) {
    boxShadow = "rgb(0 0 0 / 75%) 0px 3px 10px";
  }

  // SC fades the Top 10 image out during close, while normal cards only shrink.
  if (position.fadeImageOut && closing) {
    opacity = 0;
    transition += `, opacity ${TRANSFORM_DURATION_MS}ms`;
  }

  const handleOverlayClick = (event: any) => {
    const target = event?.target;
    if (
      isElement(target) &&
      target.closest("button, a, [role='button'], input, select, textarea")
    ) return;
    onClick?.(event);
  };

  return createPortal(
    <div
      className="preview-wrap flix-sc-preview-portal"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: 0,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 150,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-uia="modal-motion-container-MINI_MODAL"
        data-testid={testId}
        className="previewModal--container preview-dialog has-smaller-buttons mini-modal"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={handleOverlayClick}
        style={{
          ["--flix-mini-modal-width" as any]: `${modalWidth}px`,
          position: "absolute",
          zIndex: 150,
          borderRadius: ".4em",
          top: `${top}px`,
          left: `${Math.round(left)}px`,
          width: `${modalWidth}px`,
          transform,
          transformOrigin,
          transition,
          opacity,
          boxShadow,
          fontFamily: '"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize: ".87vw",
          lineHeight: "inherit",
          userSelect: "none",
          boxSizing: "border-box",
          borderWidth: 0,
          borderStyle: "solid",
          borderColor: "#e5e7eb",
          pointerEvents: "auto",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
