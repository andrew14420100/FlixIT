// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "src/components/NetflixMiniModalExact.css";
import "src/components/NetflixMotionOverrides.css";
import "src/components/NetflixHoverMotionExact.css";

/*
 * Mini-modal motion reconstructed from the user's live Netflix frame capture.
 *
 * Directly observed:
 * - the modal is first measured offscreen at top/left -9999px with opacity 0;
 * - final width is 1.5x the source card (366px from a 244px card);
 * - the visible opening keyframe starts at scale(.666667);
 * - the opening keyframe has a positive translateY (56px in the 366px sample);
 * - transform is updated inline every frame while computed CSS transition is 0s;
 * - opacity fades in separately, almost linearly over ~50ms;
 * - the shadow is already present while the opening opacity is still 0.
 *
 * The measured 366 x 374.557 Netflix box is used as a REFERENCE ratio only.
 * The real hover always scales from the live card width, so smaller/larger rows
 * produce proportionally smaller/larger mini-modals instead of a fixed 366px box.
 */
const OPEN_DELAY_MS = 300;
const OPEN_MOTION_MS = 200;
const OPEN_OPACITY_DELAY_MS = 0;
const OPEN_OPACITY_MS = 50;
const CLOSE_MOTION_MS = 150;
const INITIAL_SCALE = 0.666667;
const NETFLIX_SHADOW = "rgba(0, 0, 0, 0.75) 0px 3px 10px";
const REFERENCE_MODAL_WIDTH = 366;
const REFERENCE_MODAL_HEIGHT = 374.557;
const REFERENCE_PLAYER_RATIO = 0.563925;

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

/* Evaluate CSS `ease` = cubic-bezier(.25, .1, .25, 1). */
function netflixMotionProgress(progress: number) {
  const x = clamp01(progress);
  if (x <= 0 || x >= 1) return x;

  const x1 = 0.25;
  const y1 = 0.1;
  const x2 = 0.25;
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

function netflixReverseMotionProgress(progress: number) {
  const p = clamp01(progress);
  return 1 - netflixMotionProgress(1 - p);
}

function readTransformState(node: HTMLElement) {
  const style = getComputedStyle(node);
  const transform = style.transform;
  let scale = 1;
  let translateY = 0;

  if (transform && transform !== "none") {
    try {
      const MatrixCtor = (window as any).DOMMatrixReadOnly || (window as any).DOMMatrix;
      if (MatrixCtor) {
        const matrix = new MatrixCtor(transform);
        scale = Number.isFinite(matrix.a) ? matrix.a : 1;
        translateY = Number.isFinite(matrix.f) ? matrix.f : 0;
      }
    } catch (_) {
      // Keep final-state defaults if matrix parsing is unavailable.
    }
  }

  const opacity = Number.parseFloat(style.opacity);
  return {
    scale,
    translateY,
    opacity: Number.isFinite(opacity) ? opacity : 1,
  };
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
    }, CLOSE_MOTION_MS);
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
      const width = rect.width || element.clientWidth;
      const height = rect.height || element.clientHeight;

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
  const closeRafRef = useRef<number>(0);
  const [geometry, setGeometry] = useState<MotionGeometry | null>(null);

  const cancelOpenMotion = useCallback(() => {
    if (openRafRef.current) {
      cancelAnimationFrame(openRafRef.current);
      openRafRef.current = 0;
    }
  }, []);

  const cancelCloseMotion = useCallback(() => {
    if (closeRafRef.current) {
      cancelAnimationFrame(closeRafRef.current);
      closeRafRef.current = 0;
    }
  }, []);

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

    if (left < window.scrollX) {
      left = sourceLeft;
      transformOrigin = "0% 50%";
    } else if (left + modalWidth > window.scrollX + window.innerWidth) {
      left = sourceRight - modalWidth;
      transformOrigin = "100% 50%";
    }

    const startTranslateY = INITIAL_SCALE * Math.max(0, modalHeight - playerHeight) / 2;
    const top = sourceCenterY - modalHeight / 2 - startTranslateY;

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
    node.style.transform = `translateX(0px) translateY(${geometry.startTranslateY}px) scale(${INITIAL_SCALE}) translateZ(0px)`;
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

    openRafRef.current = requestAnimationFrame(tick);
    return cancelOpenMotion;
  }, [geometry, closing, cancelOpenMotion, cancelCloseMotion]);

  useLayoutEffect(() => {
    const node = modalRef.current;
    if (!geometry || !node || typeof window === "undefined") return;

    if (!closing) {
      cancelCloseMotion();
      if (node.dataset.phase === "close") {
        node.style.transition = "none";
        node.style.transform = "none";
        node.style.opacity = "1";
        node.style.boxShadow = NETFLIX_SHADOW;
        node.style.willChange = "transform";
        node.dataset.phase = "open";
      }
      return;
    }

    const from = readTransformState(node);
    cancelOpenMotion();
    cancelCloseMotion();

    node.dataset.phase = "close";
    node.style.transition = "none";
    node.style.boxShadow = NETFLIX_SHADOW;
    node.style.willChange = "transform, opacity";

    let startTime: number | null = null;

    const tick = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const rawProgress = clamp01(elapsed / CLOSE_MOTION_MS);
      const reverseProgress = netflixReverseMotionProgress(rawProgress);

      const scale = from.scale + (INITIAL_SCALE - from.scale) * reverseProgress;
      const translateY = from.translateY + (geometry.startTranslateY - from.translateY) * reverseProgress;
      const opacity = from.opacity * (1 - rawProgress);

      node.style.transform = `translateX(0px) translateY(${translateY}px) scale(${scale}) translateZ(0px)`;
      node.style.opacity = String(opacity);

      if (rawProgress < 1) {
        closeRafRef.current = requestAnimationFrame(tick);
        return;
      }

      closeRafRef.current = 0;
      node.style.transform = `translateX(0px) translateY(${geometry.startTranslateY}px) scale(${INITIAL_SCALE}) translateZ(0px)`;
      node.style.opacity = "0";
      node.style.boxShadow = "none";
    };

    closeRafRef.current = requestAnimationFrame(tick);
    return cancelCloseMotion;
  }, [closing, geometry, cancelOpenMotion, cancelCloseMotion]);

  useEffect(() => () => {
    cancelOpenMotion();
    cancelCloseMotion();
  }, [cancelOpenMotion, cancelCloseMotion]);

  if (!position || typeof document === "undefined" || typeof window === "undefined") return null;

  const modalWidth = position.modalWidth;
  const modalScale = modalWidth / REFERENCE_MODAL_WIDTH;
  const modalHeight = REFERENCE_MODAL_HEIGHT * modalScale;
  const playerHeight = modalWidth * REFERENCE_PLAYER_RATIO;
  const infoHeight = Math.max(0, modalHeight - playerHeight);

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
          ["--flix-mini-modal-height" as any]: `${modalHeight}px`,
          ["--flix-mini-player-height" as any]: `${playerHeight}px`,
          ["--flix-mini-info-height" as any]: `${infoHeight}px`,
          ["--flix-mini-scale" as any]: modalScale,
          ["--flix-netflix-shadow" as any]: geometry ? NETFLIX_SHADOW : "none",
          position: "absolute",
          zIndex: 3,
          borderRadius: "6px",
          top: geometry ? `${geometry.top}px` : "-9999px",
          left: geometry ? `${geometry.left}px` : "-9999px",
          width: `${modalWidth}px`,
          height: `${modalHeight}px`,
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
