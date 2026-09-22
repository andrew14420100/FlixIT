// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "src/components/NetflixMiniModalExact.css";
import "src/components/NetflixMotionOverrides.css";

const SCALE_FACTOR = 1.5;
const MIN_MODAL_WIDTH = 320;
const OPEN_DELAY_MS = 180;
const OPEN_DURATION_MS = 280;
const CLOSE_DURATION_MS = 220;
const OPACITY_OPEN_MS = 70;
const OPACITY_CLOSE_MS = 120;
const LEAVE_GRACE_MS = 420;
const VIEWPORT_GUTTER = 4;
const POINTER_PAD = 12;
const EASE = "cubic-bezier(.21,0,.07,1)";

type HoverEdge = "left" | "center" | "right";

type AnchorData = {
  cardRect: DOMRect;
  modalWidth: number;
  anchor: HTMLElement | null;
  pointerX?: number;
  pointerY?: number;
  rowStart?: number;
  rowEnd?: number;
  edge?: HoverEdge;
};

function isDomNode(value: any): value is Node {
  return typeof Node !== "undefined" && value instanceof Node;
}

function isDomElement(value: any): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
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

function updatePointer(ref: React.MutableRefObject<{ x: number; y: number }>, event?: any) {
  if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
    ref.current = { x: Number(event.clientX), y: Number(event.clientY) };
  }
}

export function useHoverExpand(ref: React.RefObject<HTMLElement>) {
  const openTimerRef = useRef<any>(null);
  const closeTimerRef = useRef<any>(null);
  const pointerRef = useRef({ x: -1, y: -1 });
  const openRef = useRef(false);
  const closingRef = useRef(false);

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
    clearTimers();
    openRef.current = false;
    closingRef.current = false;
    setIntent(false);
    setOpen(false);
    setClosing(false);
    setPosition(null);
  }, [clearTimers]);

  const cancelClosing = useCallback(() => {
    clearCloseTimer();
    if (!closingRef.current) return;
    closingRef.current = false;
    setClosing(false);
    setIntent(true);
  }, [clearCloseTimer]);

  const pointerIsOnSurface = useCallback(() => {
    if (typeof document === "undefined") return false;

    const { x, y } = pointerRef.current;
    if (x < 0 || y < 0) return false;

    const source = ref.current;
    if (source?.isConnected && pointInsideRect(x, y, source.getBoundingClientRect(), POINTER_PAD)) {
      return true;
    }

    const previews = Array.from(
      document.querySelectorAll(".previewModal--container")
    ) as HTMLElement[];

    if (previews.some((node) => node.isConnected && pointInsideRect(x, y, node.getBoundingClientRect(), POINTER_PAD))) {
      return true;
    }

    const hit = document.elementFromPoint(x, y);
    if (!isDomElement(hit)) return false;
    if (hit.closest(".previewModal--container")) return true;
    if (source && source.contains(hit)) return true;
    return false;
  }, [ref]);

  const requestClose = useCallback(() => {
    clearOpenTimer();
    if (!openRef.current || closingRef.current) return;

    setIntent(false);
    closingRef.current = true;
    setClosing(true);
    clearCloseTimer();

    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      finishClose();
    }, CLOSE_DURATION_MS + 20);
  }, [clearOpenTimer, clearCloseTimer, finishClose]);

  const scheduleClose = useCallback(() => {
    if (!openRef.current) return;
    if (closeTimerRef.current) return;

    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (pointerIsOnSurface()) {
        cancelClosing();
        setIntent(true);
        return;
      }
      requestClose();
    }, LEAVE_GRACE_MS);
  }, [pointerIsOnSurface, cancelClosing, requestClose]);

  const openFrom = useCallback((element: HTMLElement | null, event?: any) => {
    if (!element || typeof window === "undefined") return;

    updatePointer(pointerRef, event);
    clearCloseTimer();
    cancelClosing();
    setIntent(true);

    // Critical: never start a second opening cycle while the preview is
    // already open or while the first opening timer is still pending.
    if (openRef.current || openTimerRef.current) return;

    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      if (!element.isConnected) return;

      const rect = element.getBoundingClientRect();
      const measured = measureEdges(element, rect);

      openRef.current = true;
      closingRef.current = false;
      setClosing(false);
      setPosition({
        cardRect: rect,
        modalWidth: Math.max(Math.round(rect.width * SCALE_FACTOR), MIN_MODAL_WIDTH),
        anchor: element,
        pointerX: pointerRef.current.x,
        pointerY: pointerRef.current.y,
        ...measured,
      });
      setOpen(true);
    }, OPEN_DELAY_MS);
  }, [clearCloseTimer, cancelClosing]);

  const onEnter = useCallback((event?: any) => {
    updatePointer(pointerRef, event);
    clearCloseTimer();
    cancelClosing();
    setIntent(true);

    // Re-entering the source under an already-expanded portal must only keep
    // it alive; it must never recreate position/phase or replay the animation.
    if (openRef.current || openTimerRef.current) return;

    openFrom((event?.currentTarget || ref.current) as HTMLElement | null, event);
  }, [clearCloseTimer, cancelClosing, openFrom, ref]);

  const onLeave = useCallback((event?: any) => {
    updatePointer(pointerRef, event);

    if (!openRef.current) {
      clearOpenTimer();
      setIntent(false);
      return;
    }

    // Once open, the portal can physically cover the source card and cause a
    // browser mouseleave even though the pointer is still on the visible card.
    // Never close directly from this event.
    scheduleClose();
  }, [clearOpenTimer, scheduleClose]);

  const onOverlayEnter = useCallback((event?: any) => {
    updatePointer(pointerRef, event);
    clearCloseTimer();
    cancelClosing();
    setIntent(true);
  }, [clearCloseTimer, cancelClosing]);

  const onOverlayLeave = useCallback((event?: any) => {
    updatePointer(pointerRef, event);

    const related = event?.relatedTarget;
    if (isDomNode(related) && ref.current?.contains(related)) {
      clearCloseTimer();
      cancelClosing();
      return;
    }

    scheduleClose();
  }, [ref, clearCloseTimer, cancelClosing, scheduleClose]);

  // Pointer movement only decides whether the already-open preview should stay
  // alive. It never recalculates geometry and never calls openFrom().
  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };

      if (pointerIsOnSurface()) {
        clearCloseTimer();
        cancelClosing();
        setIntent(true);
        return;
      }

      scheduleClose();
    };

    document.addEventListener("pointermove", onPointerMove, true);
    return () => document.removeEventListener("pointermove", onPointerMove, true);
  }, [open, pointerIsOnSurface, clearCloseTimer, cancelClosing, scheduleClose]);

  useEffect(() => () => clearTimers(), [clearTimers]);

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
    closePreview: requestClose,
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
  const [phase, setPhase] = useState<"measure" | "reset" | "open" | "close">("measure");

  const currentCardRect = useCallback(
    () => position?.cardRect as DOMRect | undefined,
    [position]
  );

  const calculateGeometry = useCallback(() => {
    const node = modalRef.current;
    const card = currentCardRect();
    if (!node || !card || typeof window === "undefined") return null;

    const modalRect = node.getBoundingClientRect();
    const scale = 1 / SCALE_FACTOR;
    const fallback = Math.max(16, Math.round(window.innerWidth * 0.04));
    const rowStart = Number.isFinite(position?.rowStart) ? Number(position.rowStart) : fallback;
    const rowEnd = Number.isFinite(position?.rowEnd)
      ? Number(position.rowEnd)
      : window.innerWidth - fallback;
    const edge = (position?.edge || "center") as HoverEdge;

    let desiredLeft = card.left + card.width / 2 - modalRect.width / 2;
    if (edge === "left") desiredLeft = rowStart;
    if (edge === "right") desiredLeft = rowEnd - modalRect.width;

    const desiredTop = card.top + card.height / 2 - modalRect.height / 2;
    const minLeft = edge === "left" ? rowStart : VIEWPORT_GUTTER;
    const maxRightGutter = edge === "right"
      ? Math.max(0, window.innerWidth - rowEnd)
      : VIEWPORT_GUTTER;
    const maxLeft = Math.max(minLeft, window.innerWidth - modalRect.width - maxRightGutter);
    const maxTop = Math.max(VIEWPORT_GUTTER, window.innerHeight - modalRect.height - VIEWPORT_GUTTER);

    const left = Math.round(Math.min(Math.max(desiredLeft, minLeft), maxLeft));
    const top = Math.round(Math.min(Math.max(desiredTop, VIEWPORT_GUTTER), maxTop));

    let scaledLeft = left + (modalRect.width - modalRect.width * scale) / 2;
    if (edge === "left") scaledLeft = left;
    if (edge === "right") scaledLeft = left + modalRect.width - modalRect.width * scale;
    const scaledTop = top + (modalRect.height - modalRect.height * scale) / 2;

    return {
      left,
      top,
      resetX: Math.round(card.left - scaledLeft),
      resetY: Math.round(card.top - scaledTop),
      edge,
    };
  }, [currentCardRect, position]);

  // Position is measured once for this opening. It is not recalculated while
  // the pointer moves, the trailer changes frame, or the page scrolls.
  useLayoutEffect(() => {
    if (!position || !modalRef.current || typeof window === "undefined") return;

    setGeometry(null);
    setPhase("measure");

    let frame = requestAnimationFrame(() => {
      const next = calculateGeometry();
      if (!next) return;
      setGeometry(next);
      setPhase("reset");
      frame = requestAnimationFrame(() => setPhase("open"));
    });

    return () => cancelAnimationFrame(frame);
  }, [position, calculateGeometry]);

  useEffect(() => {
    if (closing && geometry) {
      setPhase("close");
      return;
    }
    if (!closing && phase === "close") setPhase("open");
  }, [closing, geometry, phase]);

  if (!position || typeof document === "undefined") return null;

  const card = currentCardRect() || (position.cardRect as DOMRect);
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

  let transform = "translate3d(0,0,0) scale(1)";
  let opacity = 0;
  let transition = "none";

  if (phase === "reset" && geometry) {
    transform = `translate3d(${geometry.resetX}px, ${geometry.resetY}px, 0) scale(${1 / SCALE_FACTOR})`;
  } else if (phase === "open" && geometry) {
    opacity = 1;
    transition = `transform ${OPEN_DURATION_MS}ms ${EASE}, opacity ${OPACITY_OPEN_MS}ms linear`;
  } else if (phase === "close" && geometry) {
    transform = `translate3d(${geometry.resetX}px, ${geometry.resetY}px, 0) scale(${1 / SCALE_FACTOR})`;
    transition = `transform ${CLOSE_DURATION_MS}ms ${EASE}, opacity ${OPACITY_CLOSE_MS}ms linear`;
  }

  const handleOverlayClick = (event: any) => {
    const target = event?.target;
    if (
      isDomElement(target) &&
      target.closest("button, a, [role='button'], input, select, textarea")
    ) return;
    onClick?.(event);
  };

  const transformOrigin = edge === "left"
    ? "0% 50%"
    : edge === "right"
      ? "100% 50%"
      : "50% 50%";

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
        className="previewModal--container has-smaller-buttons mini-modal"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={handleOverlayClick}
        style={{
          ["--flix-mini-modal-width" as any]: `${modalWidth}px`,
          width: `${modalWidth}px`,
          transformOrigin,
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
