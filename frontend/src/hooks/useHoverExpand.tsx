// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "src/components/NetflixMiniModalExact.css";
import "src/components/NetflixMotionOverrides.css";

/*
 * StreamingCommunity-style hover controller.
 *
 * The supplied SC computed styles establish the important animation contract:
 * - final top/left/width already belong to the dialog;
 * - transform-origin: center center;
 * - final transform: translateY(0px) scale(1);
 * - transition: transform 200ms;
 * - opacity stays at 1;
 * - one preview at a time.
 */
const SCALE_FACTOR = 1.5;
const MIN_MODAL_WIDTH = 320;
const OPEN_DELAY_MS = 135;
const TRANSFORM_DURATION_MS = 200;
const LEAVE_GRACE_MS = 150;
const VIEWPORT_GUTTER = 4;
const POINTER_PAD = 8;

type HoverEdge = "left" | "center" | "right";

type AnchorData = {
  cardRect: DOMRect;
  modalWidth: number;
  anchor: HTMLElement | null;
  rowStart?: number;
  rowEnd?: number;
  edge?: HoverEdge;
};

type ActiveHover = {
  owner: symbol;
  cancel: () => void;
} | null;

let activeHover: ActiveHover = null;

function isDomNode(value: any): value is Node {
  return typeof Node !== "undefined" && value instanceof Node;
}

function isDomElement(value: any): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
}

function updatePointer(ref: any, event?: any) {
  if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
    ref.current = { x: Number(event.clientX), y: Number(event.clientY) };
  }
}

function pointInsideRect(x: number, y: number, rect?: DOMRect | null, pad = 0) {
  if (!rect || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return (
    x >= rect.left - pad &&
    x <= rect.right + pad &&
    y >= rect.top - pad &&
    y <= rect.bottom + pad
  );
}

function findRow(element: HTMLElement | null) {
  return element?.closest("[data-sc-row], .slider-row, .site-slider-row") as HTMLElement | null;
}

function visibleCardRects(row: HTMLElement | null, source: HTMLElement) {
  if (!row || typeof window === "undefined") return [];

  const clip = (
    row.querySelector(".slick-list") ||
    row.querySelector("[data-sc-track]") ||
    row
  ) as HTMLElement;

  const clipRect = clip.getBoundingClientRect();
  const minX = Math.max(0, clipRect.left);
  const maxX = Math.min(window.innerWidth, clipRect.right);

  const nodes = Array.from(
    row.querySelectorAll(".netflix-standard-card-root, .netflix-ranked-card-root")
  ) as HTMLElement[];

  if (!nodes.includes(source)) nodes.push(source);

  return nodes
    .filter((node) => node.isConnected)
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.right > minX + 2 && rect.left < maxX - 2)
    .sort((a, b) => a.rect.left - b.rect.left);
}

function measureEdges(element: HTMLElement, rect: DOMRect) {
  const row = findRow(element);
  const visible = visibleCardRects(row, element);
  const first = visible[0];
  const last = visible[visible.length - 1];
  const tolerance = Math.max(4, Math.min(18, rect.width * 0.08));

  const isFirst = !!first && (
    first.node === element || Math.abs(first.rect.left - rect.left) <= tolerance
  );
  const isLast = !!last && (
    last.node === element || Math.abs(last.rect.right - rect.right) <= tolerance
  );

  let edge: HoverEdge = "center";
  if (isFirst && !isLast) edge = "left";
  else if (isLast && !isFirst) edge = "right";
  else if (isFirst && isLast) {
    const center = rect.left + rect.width / 2;
    edge = center <= window.innerWidth / 2 ? "left" : "right";
  }

  const fallbackGutter = Math.max(16, Math.round(window.innerWidth * 0.04));
  return {
    edge,
    rowStart: first?.rect.left ?? rect.left ?? fallbackGutter,
    rowEnd: last?.rect.right ?? rect.right ?? window.innerWidth - fallbackGutter,
  };
}

export function useHoverExpand(ref: React.RefObject<HTMLElement>) {
  const ownerRef = useRef(Symbol("flix-sc-hover"));
  const openTimerRef = useRef<any>(null);
  const closeTimerRef = useRef<any>(null);
  const pointerRef = useRef({ x: -1, y: -1 });
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

  const clearCloseTimer = useCallback(() => {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
  }, [clearOpenTimer, clearCloseTimer]);

  const resetImmediately = useCallback(() => {
    clearTimers();
    openRef.current = false;

    if (activeHover?.owner === ownerRef.current) activeHover = null;

    setIntent(false);
    setClosing(false);
    setOpen(false);
    setPosition(null);
  }, [clearTimers]);

  const claim = useCallback(() => {
    if (activeHover?.owner === ownerRef.current) return;

    const previous = activeHover;
    activeHover = null;
    previous?.cancel?.();

    activeHover = {
      owner: ownerRef.current,
      cancel: resetImmediately,
    };
  }, [resetImmediately]);

  const pointerIsOnOurSurface = useCallback(() => {
    if (typeof document === "undefined") return false;
    if (activeHover?.owner !== ownerRef.current) return false;

    const { x, y } = pointerRef.current;
    if (x < 0 || y < 0) return false;

    const source = ref.current;
    if (source?.isConnected && pointInsideRect(x, y, source.getBoundingClientRect(), POINTER_PAD)) {
      return true;
    }

    const preview = document.querySelector(".previewModal--container") as HTMLElement | null;
    if (preview?.isConnected && pointInsideRect(x, y, preview.getBoundingClientRect(), POINTER_PAD)) {
      return true;
    }

    const hit = document.elementFromPoint(x, y);
    if (!isDomElement(hit)) return false;
    if (hit.closest(".previewModal--container")) return true;
    if (source && source.contains(hit)) return true;
    return false;
  }, [ref]);

  const finishAnimatedClose = useCallback(() => {
    clearTimers();
    openRef.current = false;

    if (activeHover?.owner === ownerRef.current) activeHover = null;

    setIntent(false);
    setClosing(false);
    setOpen(false);
    setPosition(null);
  }, [clearTimers]);

  const closeAnimated = useCallback(() => {
    clearOpenTimer();

    if (!openRef.current) {
      resetImmediately();
      return;
    }

    if (closing) return;
    setIntent(false);
    setClosing(true);
    clearCloseTimer();

    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      finishAnimatedClose();
    }, TRANSFORM_DURATION_MS + 16);
  }, [closing, clearOpenTimer, clearCloseTimer, finishAnimatedClose, resetImmediately]);

  const scheduleClose = useCallback(() => {
    if (activeHover?.owner !== ownerRef.current) {
      resetImmediately();
      return;
    }
    if (!openRef.current || closeTimerRef.current) return;

    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (pointerIsOnOurSurface()) {
        setClosing(false);
        setIntent(true);
        return;
      }
      closeAnimated();
    }, LEAVE_GRACE_MS);
  }, [pointerIsOnOurSurface, closeAnimated, resetImmediately]);

  const openFrom = useCallback((element: HTMLElement | null, event?: any) => {
    if (!element || typeof window === "undefined") return;

    updatePointer(pointerRef, event);
    claim();
    clearCloseTimer();
    setClosing(false);
    setIntent(true);

    if (openTimerRef.current || openRef.current) return;

    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;

      if (activeHover?.owner !== ownerRef.current || !element.isConnected) return;

      const rect = element.getBoundingClientRect();
      const { x, y } = pointerRef.current;
      if (!pointInsideRect(x, y, rect, POINTER_PAD)) {
        resetImmediately();
        return;
      }

      const measured = measureEdges(element, rect);
      openRef.current = true;
      setPosition({
        cardRect: rect,
        modalWidth: Math.max(Math.round(rect.width * SCALE_FACTOR), MIN_MODAL_WIDTH),
        anchor: element,
        ...measured,
      });
      setOpen(true);
    }, OPEN_DELAY_MS);
  }, [claim, clearCloseTimer, resetImmediately]);

  const onEnter = useCallback((event?: any) => {
    openFrom((event?.currentTarget || ref.current) as HTMLElement | null, event);
  }, [openFrom, ref]);

  const onLeave = useCallback((event?: any) => {
    updatePointer(pointerRef, event);

    if (!openRef.current) {
      resetImmediately();
      return;
    }

    scheduleClose();
  }, [resetImmediately, scheduleClose]);

  const onOverlayEnter = useCallback((event?: any) => {
    if (activeHover?.owner !== ownerRef.current) return;
    updatePointer(pointerRef, event);
    clearCloseTimer();
    setClosing(false);
    setIntent(true);
  }, [clearCloseTimer]);

  const onOverlayLeave = useCallback((event?: any) => {
    if (activeHover?.owner !== ownerRef.current) return;
    updatePointer(pointerRef, event);

    const related = event?.relatedTarget;
    if (isDomNode(related) && ref.current?.contains(related)) {
      clearCloseTimer();
      setClosing(false);
      setIntent(true);
      return;
    }

    scheduleClose();
  }, [ref, clearCloseTimer, scheduleClose]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };

      if (activeHover?.owner !== ownerRef.current) {
        resetImmediately();
        return;
      }

      if (pointerIsOnOurSurface()) {
        clearCloseTimer();
        setClosing(false);
        setIntent(true);
        return;
      }

      scheduleClose();
    };

    document.addEventListener("pointermove", onPointerMove, true);
    return () => document.removeEventListener("pointermove", onPointerMove, true);
  }, [open, pointerIsOnOurSurface, clearCloseTimer, scheduleClose, resetImmediately]);

  useEffect(() => () => {
    clearTimers();
    if (activeHover?.owner === ownerRef.current) activeHover = null;
  }, [clearTimers]);

  return {
    open,
    intent,
    entered: open && !closing,
    display: open,
    closing,
    position,
    width: position?.modalWidth,
    align: position?.edge || "center",
    onEnter,
    onLeave,
    onOverlayEnter,
    onOverlayLeave,
    closePreview: closeAnimated,
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
  const [geometry, setGeometry] = useState<any>(null);
  const [phase, setPhase] = useState<"measure" | "from" | "open" | "close">("measure");

  /*
   * SC sets the dialog at its final top/left/width and animates only transform.
   * We therefore calculate those final coordinates once and never change them
   * until the preview is removed.
   */
  const calculateGeometry = useCallback(() => {
    const node = modalRef.current;
    const card = position?.cardRect as DOMRect | undefined;
    if (!node || !card || typeof window === "undefined") return null;

    const modalRect = node.getBoundingClientRect();
    const fallback = Math.max(16, Math.round(window.innerWidth * 0.04));
    const rowStart = Number.isFinite(position?.rowStart) ? Number(position.rowStart) : fallback;
    const rowEnd = Number.isFinite(position?.rowEnd)
      ? Number(position.rowEnd)
      : window.innerWidth - fallback;
    const edge = (position?.edge || "center") as HoverEdge;

    let desiredLeft = card.left + card.width / 2 - modalRect.width / 2;
    if (edge === "left") desiredLeft = rowStart;
    if (edge === "right") desiredLeft = rowEnd - modalRect.width;

    /* Keep the media/card centre as the visual expansion anchor. */
    const desiredTop = card.top + card.height / 2 - modalRect.height / 2;
    const minLeft = edge === "left" ? rowStart : VIEWPORT_GUTTER;
    const rightGutter = edge === "right"
      ? Math.max(0, window.innerWidth - rowEnd)
      : VIEWPORT_GUTTER;
    const maxLeft = Math.max(minLeft, window.innerWidth - modalRect.width - rightGutter);
    const maxTop = Math.max(VIEWPORT_GUTTER, window.innerHeight - modalRect.height - VIEWPORT_GUTTER);

    const left = Math.round(Math.min(Math.max(desiredLeft, minLeft), maxLeft));
    const top = Math.round(Math.min(Math.max(desiredTop, VIEWPORT_GUTTER), maxTop));

    const startScale = Math.max(0.01, card.width / modalRect.width);

    /*
     * With center-center transform origin, scale preserves the dialog centre.
     * translateY only compensates if viewport clamping moved the final dialog
     * away from the source card's centre. This mirrors SC's translateY+scale
     * transform rather than translating on both axes.
     */
    const sourceCenterY = card.top + card.height / 2;
    const finalCenterY = top + modalRect.height / 2;
    const startTranslateY = Math.round(sourceCenterY - finalCenterY);

    return {
      left,
      top,
      startScale,
      startTranslateY,
      edge,
    };
  }, [position]);

  useLayoutEffect(() => {
    if (!position || !modalRef.current || typeof window === "undefined") return;

    setGeometry(null);
    setPhase("measure");

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      const next = calculateGeometry();
      if (!next) return;

      setGeometry(next);
      setPhase("from");

      secondFrame = requestAnimationFrame(() => setPhase("open"));
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [position, calculateGeometry]);

  useEffect(() => {
    if (closing && geometry) {
      setPhase("close");
      return;
    }
    if (!closing && phase === "close") setPhase("open");
  }, [closing, geometry, phase]);

  if (!position || typeof document === "undefined") return null;

  const card = position.cardRect as DOMRect;
  const modalWidth = position.modalWidth || MIN_MODAL_WIDTH;
  const fallback = Math.max(16, Math.round(window.innerWidth * 0.04));
  const rowStart = Number.isFinite(position?.rowStart) ? Number(position.rowStart) : fallback;
  const rowEnd = Number.isFinite(position?.rowEnd)
    ? Number(position.rowEnd)
    : window.innerWidth - fallback;
  const edge = (position?.edge || "center") as HoverEdge;

  const fallbackLeft = edge === "left"
    ? rowStart
    : edge === "right"
      ? Math.max(VIEWPORT_GUTTER, rowEnd - modalWidth)
      : Math.min(
          Math.max(card.left + card.width / 2 - modalWidth / 2, VIEWPORT_GUTTER),
          Math.max(VIEWPORT_GUTTER, window.innerWidth - modalWidth - VIEWPORT_GUTTER)
        );

  const left = geometry?.left ?? fallbackLeft;
  const top = geometry?.top ?? Math.max(VIEWPORT_GUTTER, card.top);

  const startTransform = geometry
    ? `translateY(${geometry.startTranslateY}px) scale(${geometry.startScale})`
    : "translateY(0px) scale(1)";

  let transform = startTransform;
  let transition = "none";
  let pointerEvents: any = "none";

  if (phase === "from" && geometry) {
    pointerEvents = "auto";
  } else if (phase === "open" && geometry) {
    transform = "translateY(0px) scale(1)";
    transition = `transform ${TRANSFORM_DURATION_MS}ms`;
    pointerEvents = "auto";
  } else if (phase === "close" && geometry) {
    transform = startTransform;
    transition = `transform ${TRANSFORM_DURATION_MS}ms`;
    pointerEvents = "none";
  }

  const handleOverlayClick = (event: any) => {
    const target = event?.target;
    if (
      isDomElement(target) &&
      target.closest("button, a, [role='button'], input, select, textarea")
    ) return;
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
        data-edge={edge}
        className="previewModal--container preview-dialog has-smaller-buttons mini-modal"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={handleOverlayClick}
        style={{
          ["--flix-mini-modal-width" as any]: `${modalWidth}px`,
          position: "absolute",
          width: `${modalWidth}px`,
          top: `${Math.round(top)}px`,
          left: `${Math.round(left)}px`,
          transform,
          transformOrigin: "center center",
          transition,
          opacity: 1,
          zIndex: 150,
          borderRadius: ".4em",
          boxShadow: "rgba(0, 0, 0, 0.75) 0px 3px 10px",
          fontFamily: '"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize: ".87vw",
          lineHeight: "inherit",
          color: "var(--color-text, #e8e8e8)",
          userSelect: "none",
          boxSizing: "border-box",
          borderWidth: 0,
          borderStyle: "solid",
          borderColor: "#e5e7eb",
          pointerEvents,
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          willChange: phase === "open" || phase === "close" ? "transform" : "auto",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
