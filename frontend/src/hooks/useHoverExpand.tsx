// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "src/components/NetflixMiniModalExact.css";
import "src/components/NetflixMotionOverrides.css";
import "src/components/NetflixHoverMotionExact.css";

/*
 * Netflix mini-modal motion reconstructed from the user's live Netflix captures.
 * Captured opening state:
 *   width: source width * 1.5 (366px from a ~244px card)
 *   transform-origin: 50% 50%
 *   transform: translateX(0px) translateY(0px) scale(.666667) translateZ(0px)
 *   box-shadow: none
 *   opacity: 1
 *
 * Captured final state:
 *   transform: none
 *   box-shadow: rgba(0,0,0,.75) 0 3px 10px
 *   opacity: 1
 *
 * Web Animations inspection from Netflix:
 *   duration: 150ms
 *   easing: linear
 *   two keyframes
 *
 * The 300ms hover-intent delay is kept separate from the 150ms Netflix motion.
 */
const OPEN_DELAY_MS = 300;
const TRANSFORM_DURATION_MS = 150;
const INITIAL_SCALE = 0.666667;

type AnchorData = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  modalWidth: number;
  anchor: HTMLElement | null;
};

function isElement(value: any): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
}

function hasPreview() {
  return typeof document !== "undefined" && !!document.querySelector(".preview-wrap");
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
      if (hasPreview() || !element.isConnected) return;

      const rect = element.getBoundingClientRect();
      const width = element.clientWidth || rect.width;
      const height = element.clientHeight || rect.height;

      setPosition({
        offsetX: rect.left,
        offsetY: rect.top + window.scrollY,
        width,
        height,
        modalWidth: width * 1.5,
        anchor: element,
      });

      openRef.current = true;
      setClosing(false);
      setOpen(true);
    }, OPEN_DELAY_MS);
  }, [clearOpenTimer, clearRemoveTimer, ref]);

  const onLeave = useCallback((event?: any) => {
    const related = event?.relatedTarget;

    // Keep the preview alive while the pointer crosses directly from the
    // source card into the teleported mini-modal.
    if (isElement(related) && related.closest(".preview-wrap")) return;

    clearOpenTimer();
    closePreview();
  }, [clearOpenTimer, closePreview]);

  const onOverlayEnter = useCallback(() => {
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
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      // Paint Netflix's captured 2/3-scale keyframe first, then run the
      // captured 150ms linear transform to the final state.
      secondFrame = requestAnimationFrame(() => setReady(true));
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [position]);

  if (!position || typeof document === "undefined" || typeof window === "undefined") return null;

  const viewportWidth = window.innerWidth;
  const modalWidth = Math.round(position.width * 1.5);

  // The scaled 2/3 mini-modal is exactly the source-card width. Position the
  // modal so its center keyframe grows out of the source card, while edge cards
  // stay inside the catalogue viewport.
  let left = position.offsetX;
  let transformOrigin = "left center";

  if (left > (viewportWidth / 100) * 70) {
    left -= position.width / 2;
    transformOrigin = "right center";
  } else if (left > (viewportWidth / 100) * 5) {
    left -= position.width / 4;
    transformOrigin = "50% 50%";
  }

  // Preserve the existing vertical anchor while removing SC's synthetic
  // translateY motion. Netflix's captured transform starts at translateY(0).
  const top = Math.round(position.offsetY - (position.height / 3) * 2);
  const expanded = ready && !closing;

  const initialTransform = `translateX(0px) translateY(0px) scale(${INITIAL_SCALE}) translateZ(0px)`;
  const transform = expanded ? "none" : initialTransform;
  const phase = closing ? "close" : expanded ? "open" : "opening";
  const shadow = expanded
    ? "rgba(0, 0, 0, 0.75) 0px 3px 10px"
    : "none";

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
      className="preview-wrap flix-netflix-motion-portal"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: 0,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 99999,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-uia="modal-motion-container-MINI_MODAL"
        data-testid={testId}
        data-phase={phase}
        data-motion="netflix"
        className="previewModal--container has-smaller-buttons mini-modal"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={handleOverlayClick}
        style={{
          ["--flix-mini-modal-width" as any]: `${modalWidth}px`,
          ["--flix-netflix-shadow" as any]: shadow,
          position: "absolute",
          zIndex: 3,
          borderRadius: "6px",
          top: `${top}px`,
          left: `${Math.round(left)}px`,
          width: `${modalWidth}px`,
          transform,
          transformOrigin,
          transition: `transform ${TRANSFORM_DURATION_MS}ms linear`,
          opacity: 1,
          boxShadow: shadow,
          fontFamily: '"Netflix Sans", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, sans-serif',
          fontSize: "16px",
          lineHeight: "var(--base-line-height)",
          userSelect: "none",
          boxSizing: "inherit",
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
