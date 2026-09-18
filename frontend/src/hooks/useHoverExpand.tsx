// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "src/components/NetflixMiniModalExact.css";

/**
 * Netflix-style mini-modal motion.
 * The preview portal is viewport-fixed so opening a card never changes the
 * document height or creates a second vertical scrolling surface.
 */
const SCALE_FACTOR = 1.5;
const MIN_MODAL_WIDTH = 320;
const OPEN_DELAY_MS = 500;
const OPEN_DURATION_MS = 420;
const CLOSE_DURATION_MS = 320;
const OPACITY_OPEN_MS = 180;
const OPACITY_CLOSE_MS = CLOSE_DURATION_MS * 0.6;
const EDGE_GUARD = 60;
const EASE = "cubic-bezier(.21,0,.07,1)";
const FLIX_LEFT_BIAS_PX = 42;
const FLIX_TITLE_OVERLAP_PX = 34;
const MODAL_BOX_SHADOW = "none";

type AnchorData = {
  titleCardRect: DOMRect;
  titleCardDocTop: number;
  modalWidth: number;
};

export function useHoverExpand(ref: React.RefObject<HTMLElement>) {
  const openTimerRef = useRef<any>(null);
  const closeTimerRef = useRef<any>(null);

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
    setOpen(false);
    setClosing(false);
    setPosition(null);
  }, []);

  const requestClose = useCallback(() => {
    clearOpenTimer();

    if (!open) return;

    setClosing(true);
    clearCloseTimer();
    closeTimerRef.current = setTimeout(
      finishClose,
      CLOSE_DURATION_MS + 40
    );
  }, [open, clearOpenTimer, clearCloseTimer, finishClose]);

  const openFrom = useCallback(
    (element: HTMLElement | null) => {
      if (!element || typeof window === "undefined") return;

      clearTimers();
      setClosing(false);

      openTimerRef.current = setTimeout(() => {
        if (!element.isConnected) return;

        const rect = element.getBoundingClientRect();
        const modalWidth = Math.max(
          Math.round(rect.width * SCALE_FACTOR),
          MIN_MODAL_WIDTH
        );

        // Coordinates stay viewport-relative because the portal itself is fixed.
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

  // Scrolling should always belong to the page. Close an expanded hover card
  // immediately as soon as a wheel/touch scroll moves the document, preventing
  // the preview from feeling like it captures or blocks the scroll gesture.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => {
      clearTimers();
      finishClose();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open, clearTimers, finishClose]);

  return {
    open,
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
    let f3 = 0;

    f1 = requestAnimationFrame(() => {
      const node = modalRef.current;
      if (!node) return;

      const modalRect = node.getBoundingClientRect();
      const card = position.titleCardRect as DOMRect;

      const horizontalOverflow = (modalRect.width - card.width) / 2;
      const verticalOverflow = (modalRect.height - card.height) / 2;

      const top = Math.round(
        card.top - verticalOverflow - FLIX_TITLE_OVERLAP_PX
      );
      const left = Math.round(
        card.left - horizontalOverflow - FLIX_LEFT_BIAS_PX
      );

      const originalY = Math.round(
        (modalRect.height / SCALE_FACTOR - card.height) / 2
      );

      const tooCloseRight =
        window.innerWidth -
          (card.left + card.width + horizontalOverflow - FLIX_LEFT_BIAS_PX) <
        EDGE_GUARD;

      let openX = 0;
      if (
        card.left -
          horizontalOverflow -
          FLIX_LEFT_BIAS_PX <
        EDGE_GUARD
      ) {
        openX = Math.round(horizontalOverflow + FLIX_LEFT_BIAS_PX);
      } else if (tooCloseRight) {
        openX = Math.round(-horizontalOverflow + FLIX_LEFT_BIAS_PX);
      }

      let openY = 0;
      if (
        card.top -
          verticalOverflow -
          FLIX_TITLE_OVERLAP_PX <
        EDGE_GUARD
      ) {
        openY = Math.round(verticalOverflow + FLIX_TITLE_OVERLAP_PX);
      }

      setGeometry({
        top,
        left,
        modalWidth: modalRect.width,
        modalHeight: modalRect.height,
        originalY,
        openX,
        openY,
        transformOrigin: "50% 50%",
      });

      setPhase("reset");

      f2 = requestAnimationFrame(() => {
        f3 = requestAnimationFrame(() => {
          setPhase("open");
        });
      });
    });

    return () => {
      if (f1) cancelAnimationFrame(f1);
      if (f2) cancelAnimationFrame(f2);
      if (f3) cancelAnimationFrame(f3);
    };
  }, [position]);

  useEffect(() => {
    if (closing && geometry) setPhase("close");
  }, [closing, geometry]);

  if (!position || typeof document === "undefined") return null;

  const modalWidth = position.modalWidth || MIN_MODAL_WIDTH;

  let transform = "translate3d(0,0,0) scale(1)";
  let opacity = 0;
  let transition = "none";
  let top = geometry?.top ?? position.titleCardDocTop;
  let left =
    geometry?.left ??
    position.titleCardRect.left -
      (modalWidth - position.titleCardRect.width) / 2 -
      FLIX_LEFT_BIAS_PX;
  let boxShadow = "none";
  let zIndex = 4;

  if (phase === "reset" && geometry) {
    transform = `translate3d(0px, ${geometry.originalY}px, 0) scale(${1 / SCALE_FACTOR})`;
    opacity = 0;
  }

  if (phase === "open" && geometry) {
    transform = `translate3d(${geometry.openX}px, ${geometry.openY}px, 0) scale(1)`;
    opacity = 1;
    boxShadow = MODAL_BOX_SHADOW;
    transition =
      `transform ${OPEN_DURATION_MS}ms ${EASE}, ` +
      `opacity ${OPACITY_OPEN_MS}ms linear`;
    zIndex = 3;
  }

  if (phase === "close" && geometry) {
    top = geometry.top + geometry.originalY;
    transform = `translate3d(0px, 0px, 0) scale(${1 / SCALE_FACTOR})`;
    opacity = 0;
    boxShadow = MODAL_BOX_SHADOW;
    transition =
      `transform ${CLOSE_DURATION_MS}ms ${EASE}, ` +
      `opacity ${OPACITY_CLOSE_MS}ms linear`;
    zIndex = 4;
  }

  const handleOverlayClick = (event: any) => {
    const target = event?.target as HTMLElement | null;
    if (
      target?.closest?.("button, a, [role='button'], input, select, textarea")
    ) {
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
          boxShadow,
          zIndex,
          opacity,
          transition,
          pointerEvents: phase === "measure" ? "none" : "auto",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          perspective: "1000px",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
