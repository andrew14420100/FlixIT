// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "src/components/NetflixMiniModalExact.css";
import "src/components/NetflixMotionOverrides.css";
import "src/components/NetflixHoverMotionExact.css";

/*
 * Netflix mini-modal motion reconstructed from the user's live frame capture.
 *
 * Directly observed:
 * - the modal is first measured offscreen at top/left -9999px with opacity 0;
 * - final width is 1.5x the source card (366px from a 244px card);
 * - the visible opening keyframe starts at scale(.666667);
 * - the opening keyframe has a positive translateY (56px in the 366px sample);
 * - transform is updated inline every frame while computed CSS transition is 0s;
 * - opacity fades in separately, almost linearly over ~50ms;
 * - the shadow is already present while the opening opacity is still 0;
 * - the separately captured close animation is opacity 1 -> 0, 150ms linear, fill both.
 *
 * The opening transform curve below uses Netflix's motion bezier already present
 * in the supplied/reconstructed Netflix CSS and is driven by rAF, not a CSS
 * transition. 300ms matches the measured early transform samples closely.
 */
const OPEN_DELAY_MS = 300;
const OPEN_MOTION_MS = 300;
const OPEN_OPACITY_DELAY_MS = 7;
const OPEN_OPACITY_MS = 50;
const CLOSE_FADE_MS = 150;
const INITIAL_SCALE = 0.666667;
const NETFLIX_SHADOW = "rgba(0, 0, 0, 0.75) 0px 3px 10px";

type AnchorData = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  modalWidth: number;
  anchor: HTMLElement | null;
};

type MotionGeometry = {
  top: number;
  left: number;
  modalWidth: number;
  modalHeight: number;
  playerHeight: number;
  startTranslateY: number;
  transformOrigin: string;
};

function isElement(value: any): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
}

function hasPreview() {
  return typeof document !== "undefined" && !!document.querySelector(".preview-wrap");
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/* Evaluate cubic-bezier(.21, 0, .07, 1) by solving x(t) and returning y(t). */
function netflixMotionProgress(progress: number) {
  const x = clamp01(progress);
  if (x <= 0 || x >= 1) return x;

  const x1 = 0.21;
  const y1 = 0;
  const x2 = 0.07;
  const y2 = 1;
  let low = 0;
  let high = 1;
  let t = x;

  for (let i = 0; i < 18; i += 1) {
    t = (low + high) / 2;
    const inv = 1 - t;
    const bx =
      3 * inv * inv * t * x1 +
      3 * inv * t * t * x2 +
      t * t * t;
    if (bx < x) low = t;
    else high = t;
  }

  const inv = 1 - t;
  return (
    3 * inv * inv * t * y1 +
    3 * inv * t * t * y2 +
    t * t * t
  );
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
    }, CLOSE_FADE_MS);
  }, [clearOpenTimer, clearRemoveTimer, finishClose]);

  const onEnter = useCallback((event?: any) => {
    const element = (event?.currentTarget || ref.current) as HTMLElement | null;
    if (!element || typeof window === "undefined") return;

    clearOpenTimer();
    clearRemoveTimer();
    setIntent(true);

    if (openRef.current) {
      setClosing(false);
      return;
    }

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

    if (isElement(related) && related.closest(".preview-wrap")) return;

    clearOpenTimer();
    closePreview();
  }, [clearOpenTimer, closePreview]);

  const onOverlayEnter = useCallback(() => {
    clearRemoveTimer();
    if (openRef.current) {
      setClosing(false);
      setIntent(true);
    }
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
  const modalRef = useRef<HTMLDivElement | null>(null);
  const openRafRef = useRef<number>(0);
  const closeAnimationRef = useRef<Animation | null>(null);
  const [geometry, setGeometry] = useState<MotionGeometry | null>(null);

  const cancelOpenMotion = useCallback(() => {
    if (openRafRef.current) {
      cancelAnimationFrame(openRafRef.current);
      openRafRef.current = 0;
    }
  }, []);

  const cancelCloseMotion = useCallback(() => {
    if (closeAnimationRef.current) {
      closeAnimationRef.current.cancel();
      closeAnimationRef.current = null;
    }
  }, []);

  /* Netflix first mounts/measures the full modal offscreen. */
  useLayoutEffect(() => {
    const node = modalRef.current;
    if (!position || !node || typeof window === "undefined") return;

    cancelOpenMotion();
    cancelCloseMotion();
    setGeometry(null);

    node.dataset.phase = "measure";
    node.style.transition = "none";
    node.style.top = "-9999px";
    node.style.left = "-9999px";
    node.style.transform = "none";
    node.style.transformOrigin = "50% 50%";
    node.style.opacity = "0";
    node.style.boxShadow = "none";

    const modalRect = node.getBoundingClientRect();
    const player = node.querySelector(".previewModal--player_container") as HTMLElement | null;
    const playerHeight = player?.getBoundingClientRect().height || position.height / INITIAL_SCALE;
    const modalHeight = modalRect.height || node.offsetHeight || playerHeight;
    const modalWidth = position.modalWidth;

    const sourceLeft = position.offsetX + window.scrollX;
    const sourceRight = sourceLeft + position.width;
    const sourceCenterX = sourceLeft + position.width / 2;
    const sourceCenterY = position.offsetY + position.height / 2;

    let left = sourceCenterX - modalWidth / 2;
    let transformOrigin = "50% 50%";

    // For true viewport-edge cards, grow inward so the scaled first frame still
    // lies exactly on the source tile. Normal cards keep Netflix's 50% 50% origin.
    if (left < window.scrollX) {
      left = sourceLeft;
      transformOrigin = "0% 50%";
    } else if (left + modalWidth > window.scrollX + window.innerWidth) {
      left = sourceRight - modalWidth;
      transformOrigin = "100% 50%";
    }

    const top = sourceCenterY - modalHeight / 2;

    // This reproduces the captured +56px start translation. It is not a magic
    // constant: it aligns the scaled 16:9 player portion with the source card
    // while the larger info panel is already mounted below it.
    const startTranslateY = INITIAL_SCALE * Math.max(0, modalHeight - playerHeight) / 2;

    setGeometry({
      top,
      left,
      modalWidth,
      modalHeight,
      playerHeight,
      startTranslateY,
      transformOrigin,
    });
  }, [position, cancelOpenMotion, cancelCloseMotion]);

  /* Frame-driven opening: Netflix mutates inline transform, with CSS transition 0s. */
  useLayoutEffect(() => {
    const node = modalRef.current;
    if (!geometry || !node || closing || typeof window === "undefined") return;

    cancelOpenMotion();
    cancelCloseMotion();

    node.dataset.phase = "opening";
    node.style.transition = "none";
    node.style.opacity = "0";
    node.style.boxShadow = NETFLIX_SHADOW;
    node.style.transformOrigin = geometry.transformOrigin;
    node.style.transform = `translateY(${geometry.startTranslateY}px) scale(${INITIAL_SCALE}) translateZ(0px)`;
    node.style.willChange = "transform, opacity";

    let startTime: number | null = null;

    const tick = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const rawProgress = clamp01(elapsed / OPEN_MOTION_MS);
      const motionProgress = netflixMotionProgress(rawProgress);
      const scale = INITIAL_SCALE + (1 - INITIAL_SCALE) * motionProgress;
      const translateY = geometry.startTranslateY * (1 - motionProgress);
      const opacity = clamp01((elapsed - OPEN_OPACITY_DELAY_MS) / OPEN_OPACITY_MS);

      node.style.transform = `translateX(0px) translateY(${translateY}px) scale(${scale}) translateZ(0px)`;
      node.style.opacity = String(opacity);

      if (rawProgress < 1) {
        openRafRef.current = requestAnimationFrame(tick);
        return;
      }

      openRafRef.current = 0;
      node.style.transform = "none";
      node.style.opacity = "1";
      node.style.willChange = "transform";
      node.dataset.phase = "open";
    };

    // Keep the measured first keyframe paintable for one frame before motion.
    openRafRef.current = requestAnimationFrame(tick);

    return cancelOpenMotion;
  }, [geometry, closing, cancelOpenMotion, cancelCloseMotion]);

  /* The captured Netflix close animation is a 150ms linear opacity fade only. */
  useLayoutEffect(() => {
    const node = modalRef.current;
    if (!geometry || !node) return;

    if (!closing) {
      cancelCloseMotion();
      if (node.dataset.phase === "close") {
        node.style.opacity = "1";
        node.dataset.phase = "open";
      }
      return;
    }

    cancelOpenMotion();
    cancelCloseMotion();
    node.dataset.phase = "close";
    node.style.transform = "none";
    node.style.opacity = "1";

    if (typeof node.animate === "function") {
      const animation = node.animate(
        [{ opacity: "1" }, { opacity: "0" }],
        {
          duration: CLOSE_FADE_MS,
          easing: "linear",
          fill: "both",
          iterations: 1,
        }
      );
      closeAnimationRef.current = animation;
    } else {
      node.style.transition = `opacity ${CLOSE_FADE_MS}ms linear`;
      requestAnimationFrame(() => {
        node.style.opacity = "0";
      });
    }

    return cancelCloseMotion;
  }, [closing, geometry, cancelOpenMotion, cancelCloseMotion]);

  useEffect(() => () => {
    cancelOpenMotion();
    cancelCloseMotion();
  }, [cancelOpenMotion, cancelCloseMotion]);

  if (!position || typeof document === "undefined" || typeof window === "undefined") return null;

  const modalWidth = Math.round(position.modalWidth);

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
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-uia="modal-motion-container-MINI_MODAL"
        data-testid={testId}
        data-phase={geometry ? (closing ? "close" : "opening") : "measure"}
        data-motion="netflix"
        className="previewModal--container has-smaller-buttons mini-modal"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={handleOverlayClick}
        style={{
          ["--flix-mini-modal-width" as any]: `${modalWidth}px`,
          ["--flix-netflix-shadow" as any]: geometry ? NETFLIX_SHADOW : "none",
          position: "absolute",
          zIndex: 3,
          borderRadius: "6px",
          top: geometry ? `${geometry.top}px` : "-9999px",
          left: geometry ? `${geometry.left}px` : "-9999px",
          width: `${modalWidth}px`,
          transform: "none",
          transformOrigin: geometry?.transformOrigin || "50% 50%",
          transition: "none",
          opacity: geometry ? 1 : 0,
          boxShadow: geometry ? NETFLIX_SHADOW : "none",
          fontFamily: '"Netflix Sans", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, sans-serif',
          fontSize: "16px",
          lineHeight: "var(--base-line-height)",
          userSelect: "none",
          boxSizing: "inherit",
          pointerEvents: geometry ? "auto" : "none",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          willChange: "transform, opacity",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
