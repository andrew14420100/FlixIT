// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "src/components/NetflixMiniModalExact.css";

/**
 * Netflix mini-modal motion reconstructed from the akiraClient bundle supplied by the user.
 *
 * Netflix source values:
 * - scaleFactor: 1.5
 * - miniModalMinWidth: 320
 * - open duration: 300ms
 * - close duration: 250ms
 * - easing: cubic-bezier(.21, 0, .07, 1)
 * - open opacity: 50ms
 * - close opacity ratio: .6
 * - viewport edge guard: 60px
 * - player aspect-height ratio: .563925
 *
 * User-requested deviation:
 * - hover open delay is 500ms instead of Netflix's default 400ms because the previous
 *   implementation felt too fast.
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
// FLIX-IT has different row padding than Netflix; these two tiny offsets
// reproduce the same visual overlap with the row title/left side.
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

        setPosition({
          titleCardRect: rect,
          titleCardDocTop: rect.top + window.pageYOffset,
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

      // Final, unscaled mini-modal rect (Netflix stores the modal rect and derives
      // the reset/open variants from it).
      const modalRect = node.getBoundingClientRect();
      const card = position.titleCardRect as DOMRect;

      const xOffset = window.pageXOffset || 0;
      const yOffset = window.pageYOffset || 0;
      const cardDocLeft = card.left + xOffset;
      const cardDocTop = card.top + yOffset;

      const horizontalOverflow = (modalRect.width - card.width) / 2;
      const verticalOverflow = (modalRect.height - card.height) / 2;

      // getMiniModalTopLeft() — normal video row branch.
      const top = Math.round(
        cardDocTop - verticalOverflow - FLIX_TITLE_OVERLAP_PX
      );
      const left = Math.round(
        cardDocLeft - horizontalOverflow - FLIX_LEFT_BIAS_PX
      );

      // getMiniModalOriginalY() — normal video row branch.
      const originalY = Math.round(
        (modalRect.height / SCALE_FACTOR - card.height) / 2
      );

      // getOpenMiniModalVariant(): keep a 60px viewport safety margin.
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
        // Same Netflix edge behavior: first card expands to the right.
        openX = Math.round(
          horizontalOverflow + FLIX_LEFT_BIAS_PX
        );
      } else if (tooCloseRight) {
        openX = Math.round(
          -horizontalOverflow + FLIX_LEFT_BIAS_PX
        );
      }

      let openY = 0;
      if (
        card.top -
          verticalOverflow -
          FLIX_TITLE_OVERLAP_PX <
        EDGE_GUARD
      ) {
        openY = Math.round(
          verticalOverflow + FLIX_TITLE_OVERLAP_PX
        );
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

      // RESET_MINI_MODAL first; then OPEN_MINI_MODAL on the following frame.
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
    position.titleCardRect.left +
      (window.pageXOffset || 0) -
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
    // Netflix close: scale back to 1 / scaleFactor and return to anchor.
    top = geometry.top + geometry.originalY;
    transform = `translate3d(0px, 0px, 0) scale(${1 / SCALE_FACTOR})`;
    opacity = 0;
    boxShadow = MODAL_BOX_SHADOW;
    transition =
      `transform ${CLOSE_DURATION_MS}ms ${EASE}, ` +
      `opacity ${OPACITY_CLOSE_MS}ms linear`;
    zIndex = 4;
  }

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
