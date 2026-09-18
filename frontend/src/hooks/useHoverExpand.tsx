// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "src/components/NetflixMiniModalExact.css";
import "src/components/NetflixMotionOverrides.css";

/**
 * Netflix-style mini-modal motion.
 *
 * Hover intent is intentionally short; trailer metadata can prewarm immediately
 * while the visual expansion still has enough delay to avoid accidental fly-by
 * hovers.  Expansion is centred on the source card.  Only cards touching a
 * viewport edge are clamped, and there is no permanent left/right bias.
 */
const SCALE_FACTOR = 1.5;
const MIN_MODAL_WIDTH = 320;
const OPEN_DELAY_MS = 260;
const OPEN_DURATION_MS = 280;
const CLOSE_DURATION_MS = 220;
const OPACITY_OPEN_MS = 50;
const OPACITY_CLOSE_MS = CLOSE_DURATION_MS * 0.6;
const VIEWPORT_GUTTER = 8;
const EASE = "cubic-bezier(.21,0,.07,1)";
const TITLE_OVERLAP_PX = 24;

type AnchorData = {
  titleCardRect: DOMRect;
  titleCardDocTop: number;
  modalWidth: number;
};

export function useHoverExpand(ref: React.RefObject<HTMLElement>) {
  const openTimerRef = useRef<any>(null);
  const closeTimerRef = useRef<any>(null);

  const [intent, setIntent] = useState(false);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState<AnchorData | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
  }, [clearOpenTimer, clearCloseTimer]);

  const finishClose = useCallback(() => {
    setIntent(false);
    setOpen(false);
    setClosing(false);
    setPosition(null);
  }, []);

  const requestClose = useCallback(() => {
    clearOpenTimer();
    setIntent(false);
    if (!open || closing) return;

    setClosing(true);
    clearCloseTimer();
    closeTimerRef.current = setTimeout(finishClose, CLOSE_DURATION_MS + 16);
  }, [open, closing, clearOpenTimer, clearCloseTimer, finishClose]);

  const openFrom = useCallback(
    (element: HTMLElement | null) => {
      if (!element || typeof window === "undefined") return;

      clearTimers();
      setIntent(true);
      setClosing(false);

      openTimerRef.current = setTimeout(() => {
        if (!element.isConnected) return;
        const rect = element.getBoundingClientRect();
        const modalWidth = Math.max(
          Math.round(rect.width * SCALE_FACTOR),
          MIN_MODAL_WIDTH
        );

        setPosition({
          titleCardRect: rect,
          titleCardDocTop: rect.top,
          modalWidth,
        });
        setOpen(true);
      }, OPEN_DELAY_MS);
    },
    [clearTimers]
  );

  const onEnter = useCallback(
    (event?: any) => {
      openFrom((event?.currentTarget || ref.current) as HTMLElement | null);
    },
    [openFrom, ref]
  );

  const onLeave = useCallback(
    (event?: any) => {
      clearOpenTimer();
      const related = event?.relatedTarget as Element | null;
      if (
        related &&
        typeof related.closest === "function" &&
        related.closest(".previewModal--container")
      ) {
        return;
      }
      requestClose();
    },
    [clearOpenTimer, requestClose]
  );

  const onOverlayLeave = useCallback(
    (event?: any) => {
      const related = event?.relatedTarget as Node | null;
      if (related && ref.current?.contains?.(related)) return;
      requestClose();
    },
    [requestClose, ref]
  );

  useEffect(() => clearTimers, [clearTimers]);

  // A page scroll owns the gesture; close the preview instead of keeping a
  // detached portal floating over content that has moved underneath it.
  useEffect(() => {
    if (!open) return;
    const onScrollGesture = () => {
      clearTimers();
      finishClose();
    };
    window.addEventListener("scroll", onScrollGesture, { passive: true });
    window.addEventListener("wheel", onScrollGesture, { passive: true });
    window.addEventListener("touchmove", onScrollGesture, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScrollGesture);
      window.removeEventListener("wheel", onScrollGesture);
      window.removeEventListener("touchmove", onScrollGesture);
    };
  }, [open, clearTimers, finishClose]);

  return {
    open,
    intent,
    entered: open && !closing,
    display: open,
    closing,
    position,
    width: position?.modalWidth,
    align: "center",
    onEnter,
    onLeave,
    onOverlayLeave,
    closePreview: requestClose,
  };
}

export function ExpandOverlay({
  position,
  closing = false,
  onMouseLeave,
  onClick,
  children,
  testId,
}: any) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState<any>(null);
  const [phase, setPhase] = useState<"measure" | "reset" | "open" | "close">("measure");

  useLayoutEffect(() => {
    if (!position || !modalRef.current || typeof window === "undefined") return;

    setGeometry(null);
    setPhase("measure");

    let f1 = 0;
    let f2 = 0;

    f1 = requestAnimationFrame(() => {
      const node = modalRef.current;
      if (!node) return;

      const modalRect = node.getBoundingClientRect();
      const card = position.titleCardRect as DOMRect;
      const horizontalOverflow = (modalRect.width - card.width) / 2;
      const verticalOverflow = (modalRect.height - card.height) / 2;

      const wantedLeft = card.left - horizontalOverflow;
      const maxLeft = Math.max(
        VIEWPORT_GUTTER,
        window.innerWidth - modalRect.width - VIEWPORT_GUTTER
      );
      const left = Math.round(
        Math.min(Math.max(wantedLeft, VIEWPORT_GUTTER), maxLeft)
      );

      const wantedTop = card.top - verticalOverflow - TITLE_OVERLAP_PX;
      const top = Math.round(Math.max(VIEWPORT_GUTTER, wantedTop));

      // At scale(1/SCALE_FACTOR), translate the modal back onto the exact card
      // centre. This keeps every non-edge card expanding symmetrically instead
      // of appearing to grow to the right.
      const cardCenterX = card.left + card.width / 2;
      const modalCenterX = left + modalRect.width / 2;
      const resetX = Math.round(cardCenterX - modalCenterX);
      const resetY = Math.round((modalRect.height / SCALE_FACTOR - card.height) / 2);

      setGeometry({
        top,
        left,
        resetX,
        resetY,
        transformOrigin: "50% 50%",
      });

      setPhase("reset");
      f2 = requestAnimationFrame(() => setPhase("open"));
    });

    return () => {
      if (f1) cancelAnimationFrame(f1);
      if (f2) cancelAnimationFrame(f2);
    };
  }, [position]);

  useEffect(() => {
    if (closing && geometry) setPhase("close");
  }, [closing, geometry]);

  if (!position || typeof document === "undefined") return null;

  const modalWidth = position.modalWidth || MIN_MODAL_WIDTH;
  const top = geometry?.top ?? position.titleCardDocTop;
  const fallbackWantedLeft =
    position.titleCardRect.left -
    (modalWidth - position.titleCardRect.width) / 2;
  const fallbackMaxLeft = Math.max(
    VIEWPORT_GUTTER,
    window.innerWidth - modalWidth - VIEWPORT_GUTTER
  );
  const left = geometry?.left ?? Math.min(
    Math.max(fallbackWantedLeft, VIEWPORT_GUTTER),
    fallbackMaxLeft
  );

  let transform = "translate3d(0,0,0) scale(1)";
  let opacity = 0;
  let transition = "none";
  let zIndex = 4;

  if (phase === "reset" && geometry) {
    transform = `translate3d(${geometry.resetX}px, ${geometry.resetY}px, 0) scale(${1 / SCALE_FACTOR})`;
    opacity = 0;
  }

  if (phase === "open" && geometry) {
    transform = "translate3d(0px, 0px, 0) scale(1)";
    opacity = 1;
    transition =
      `transform ${OPEN_DURATION_MS}ms ${EASE}, ` +
      `opacity ${OPACITY_OPEN_MS}ms linear`;
    zIndex = 3;
  }

  if (phase === "close" && geometry) {
    transform = `translate3d(${geometry.resetX}px, ${geometry.resetY}px, 0) scale(${1 / SCALE_FACTOR})`;
    opacity = 0;
    transition =
      `transform ${CLOSE_DURATION_MS}ms ${EASE}, ` +
      `opacity ${OPACITY_CLOSE_MS}ms linear`;
    zIndex = 4;
  }

  const handleOverlayClick = (event: any) => {
    const target = event?.target as HTMLElement | null;
    if (target?.closest?.("button, a, [role='button'], input, select, textarea")) {
      return;
    }
    onClick?.(event);
  };

  return createPortal(
    <div className="flix-netflix-preview-portal">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-uia="modal-motion-container-MINI_MODAL"
        data-testid={testId}
        data-phase={phase}
        className="previewModal--container has-smaller-buttons mini-modal"
        onMouseLeave={onMouseLeave}
        onClick={handleOverlayClick}
        style={{
          ["--flix-mini-modal-width" as any]: `${modalWidth}px`,
          width: `${modalWidth}px`,
          transformOrigin: geometry?.transformOrigin || "50% 50%",
          top: `${Math.round(top)}px`,
          left: `${Math.round(left)}px`,
          transform,
          zIndex,
          opacity,
          transition,
          pointerEvents: phase === "measure" ? "none" : "auto",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          perspective: "1000px",
          willChange: "transform, opacity",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
