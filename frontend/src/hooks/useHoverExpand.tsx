// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "src/components/NetflixMiniModalExact.css";
import "src/components/NetflixMotionOverrides.css";

const SCALE_FACTOR = 1.5;
const MIN_MODAL_WIDTH = 320;
const OPEN_DELAY_MS = 300;
const OPEN_DURATION_MS = 280;
const CLOSE_DURATION_MS = 220;
const OPACITY_OPEN_MS = 70;
const OPACITY_CLOSE_MS = 120;
const VIEWPORT_GUTTER = 4;
const FIRST_CARD_RIGHT_SHIFT_PX = 18;
const FIRST_CARD_UP_SHIFT_PX = 14;
const EASE = "cubic-bezier(.21,0,.07,1)";

type AnchorData = {
  cardRect: DOMRect;
  modalWidth: number;
};

function isFirstVisibleCard(card: DOMRect) {
  if (typeof window === "undefined") return false;
  // Rows begin around 4vw on desktop and ~16px on mobile. This detects only
  // the left-most visible tile, without giving every card a permanent bias.
  return card.left <= Math.max(96, window.innerWidth * 0.065);
}

/**
 * Netflix-style hover intent + expansion.
 * Normal cards expand from their own centre. The first visible card gets the
 * small right/up correction Netflix uses at the row edge so the enlarged
 * preview overlaps the row heading instead of looking detached from it.
 */
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
    closeTimerRef.current = setTimeout(finishClose, CLOSE_DURATION_MS + 20);
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
        setPosition({
          cardRect: rect,
          modalWidth: Math.max(Math.round(rect.width * SCALE_FACTOR), MIN_MODAL_WIDTH),
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
      if (related?.closest?.(".previewModal--container")) return;
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

  useEffect(() => {
    if (!open) return;
    const closeForScroll = () => {
      clearTimers();
      finishClose();
    };
    window.addEventListener("scroll", closeForScroll, { passive: true });
    window.addEventListener("wheel", closeForScroll, { passive: true });
    window.addEventListener("touchmove", closeForScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", closeForScroll);
      window.removeEventListener("wheel", closeForScroll);
      window.removeEventListener("touchmove", closeForScroll);
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
    let frame1 = 0;
    let frame2 = 0;

    frame1 = requestAnimationFrame(() => {
      const node = modalRef.current;
      if (!node) return;

      const modalRect = node.getBoundingClientRect();
      const card = position.cardRect as DOMRect;
      const scale = 1 / SCALE_FACTOR;
      const firstCard = isFirstVisibleCard(card);

      const desiredLeft =
        card.left + card.width / 2 - modalRect.width / 2 +
        (firstCard ? FIRST_CARD_RIGHT_SHIFT_PX : 0);
      const desiredTop =
        card.top + card.height / 2 - modalRect.height / 2 -
        (firstCard ? FIRST_CARD_UP_SHIFT_PX : 0);

      const maxLeft = Math.max(
        VIEWPORT_GUTTER,
        window.innerWidth - modalRect.width - VIEWPORT_GUTTER
      );
      const maxTop = Math.max(
        VIEWPORT_GUTTER,
        window.innerHeight - modalRect.height - VIEWPORT_GUTTER
      );

      const left = Math.round(
        Math.min(Math.max(desiredLeft, VIEWPORT_GUTTER), maxLeft)
      );
      const top = Math.round(
        Math.min(Math.max(desiredTop, VIEWPORT_GUTTER), maxTop)
      );

      const scaledLeft = left + (modalRect.width - modalRect.width * scale) / 2;
      const scaledTop = top + (modalRect.height - modalRect.height * scale) / 2;
      const resetX = Math.round(card.left - scaledLeft);
      const resetY = Math.round(card.top - scaledTop);

      setGeometry({ left, top, resetX, resetY, firstCard });
      setPhase("reset");
      frame2 = requestAnimationFrame(() => setPhase("open"));
    });

    return () => {
      if (frame1) cancelAnimationFrame(frame1);
      if (frame2) cancelAnimationFrame(frame2);
    };
  }, [position]);

  useEffect(() => {
    if (closing && geometry) setPhase("close");
  }, [closing, geometry]);

  if (!position || typeof document === "undefined") return null;

  const card = position.cardRect as DOMRect;
  const modalWidth = position.modalWidth || MIN_MODAL_WIDTH;
  const firstCard = isFirstVisibleCard(card);
  const fallbackLeft = Math.min(
    Math.max(
      card.left + card.width / 2 - modalWidth / 2 +
        (firstCard ? FIRST_CARD_RIGHT_SHIFT_PX : 0),
      VIEWPORT_GUTTER
    ),
    Math.max(VIEWPORT_GUTTER, window.innerWidth - modalWidth - VIEWPORT_GUTTER)
  );
  const left = geometry?.left ?? fallbackLeft;
  const top = geometry?.top ?? Math.max(
    VIEWPORT_GUTTER,
    card.top - (firstCard ? FIRST_CARD_UP_SHIFT_PX : 0)
  );

  let transform = "translate3d(0,0,0) scale(1)";
  let opacity = 0;
  let transition = "none";

  if (phase === "reset" && geometry) {
    transform = `translate3d(${geometry.resetX}px, ${geometry.resetY}px, 0) scale(${1 / SCALE_FACTOR})`;
  } else if (phase === "open" && geometry) {
    transform = "translate3d(0,0,0) scale(1)";
    opacity = 1;
    transition = `transform ${OPEN_DURATION_MS}ms ${EASE}, opacity ${OPACITY_OPEN_MS}ms linear`;
  } else if (phase === "close" && geometry) {
    transform = `translate3d(${geometry.resetX}px, ${geometry.resetY}px, 0) scale(${1 / SCALE_FACTOR})`;
    opacity = 0;
    transition = `transform ${CLOSE_DURATION_MS}ms ${EASE}, opacity ${OPACITY_CLOSE_MS}ms linear`;
  }

  const handleOverlayClick = (event: any) => {
    const target = event?.target as HTMLElement | null;
    if (target?.closest?.("button, a, [role='button'], input, select, textarea")) return;
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
        data-first-card={firstCard ? "true" : "false"}
        className="previewModal--container has-smaller-buttons mini-modal"
        onMouseLeave={onMouseLeave}
        onClick={handleOverlayClick}
        style={{
          ["--flix-mini-modal-width" as any]: `${modalWidth}px`,
          width: `${modalWidth}px`,
          transformOrigin: "50% 50%",
          top: `${Math.round(top)}px`,
          left: `${Math.round(left)}px`,
          transform,
          zIndex: 4,
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
