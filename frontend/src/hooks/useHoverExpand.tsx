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
const VIEWPORT_GUTTER = 4;
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

function pointInsideRect(x: number, y: number, rect?: DOMRect | null) {
  if (!rect) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
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

  const isFirst = !!first && (first.node === element || Math.abs(first.rect.left - rect.left) <= tolerance);
  const isLast = !!last && (last.node === element || Math.abs(last.rect.right - rect.right) <= tolerance);

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

/**
 * SC-style hover expansion shared by all public rails.
 * First/last behaviour is based on the cards actually visible in the current
 * carousel viewport, not on the content index. This keeps edge hovers correct
 * after horizontal navigation too.
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

  const openFrom = useCallback((element: HTMLElement | null, event?: any) => {
    if (!element || typeof window === "undefined") return;
    clearTimers();
    setIntent(true);
    setClosing(false);

    const pointerX = Number.isFinite(event?.clientX) ? Number(event.clientX) : undefined;
    const pointerY = Number.isFinite(event?.clientY) ? Number(event.clientY) : undefined;

    openTimerRef.current = setTimeout(() => {
      if (!element.isConnected) return;
      const rect = element.getBoundingClientRect();
      const measured = measureEdges(element, rect);
      setPosition({
        cardRect: rect,
        modalWidth: Math.max(Math.round(rect.width * SCALE_FACTOR), MIN_MODAL_WIDTH),
        anchor: element,
        pointerX,
        pointerY,
        ...measured,
      });
      setOpen(true);
    }, OPEN_DELAY_MS);
  }, [clearTimers]);

  const onEnter = useCallback((event?: any) => {
    openFrom((event?.currentTarget || ref.current) as HTMLElement | null, event);
  }, [openFrom, ref]);

  const onLeave = useCallback((event?: any) => {
    clearOpenTimer();
    const related = event?.relatedTarget;
    if (isDomElement(related) && related.closest(".previewModal--container")) return;
    requestClose();
  }, [clearOpenTimer, requestClose]);

  const onOverlayLeave = useCallback((event?: any) => {
    const related = event?.relatedTarget;
    if (isDomNode(related) && ref.current?.contains(related)) return;
    requestClose();
  }, [requestClose, ref]);

  useEffect(() => clearTimers, [clearTimers]);

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
    onOverlayLeave,
    closePreview: requestClose,
  };
}

export function ExpandOverlay({ position, closing = false, onMouseLeave, onClick, children, testId }: any) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef({ x: -1, y: -1 });
  const [geometry, setGeometry] = useState<any>(null);
  const [phase, setPhase] = useState<"measure" | "reset" | "open" | "close">("measure");

  useEffect(() => {
    if (!position) return;
    pointerRef.current = {
      x: Number.isFinite(position.pointerX) ? Number(position.pointerX) : -1,
      y: Number.isFinite(position.pointerY) ? Number(position.pointerY) : -1,
    };
  }, [position]);

  const currentCardRect = useCallback(() => {
    const anchor = position?.anchor as HTMLElement | null | undefined;
    if (anchor?.isConnected) return anchor.getBoundingClientRect();
    return position?.cardRect as DOMRect | undefined;
  }, [position]);

  const calculateGeometry = useCallback(() => {
    const node = modalRef.current;
    const card = currentCardRect();
    if (!node || !card || typeof window === "undefined") return null;

    const modalRect = node.getBoundingClientRect();
    const scale = 1 / SCALE_FACTOR;
    const fallback = Math.max(16, Math.round(window.innerWidth * 0.04));
    const rowStart = Number.isFinite(position?.rowStart) ? Number(position.rowStart) : fallback;
    const rowEnd = Number.isFinite(position?.rowEnd) ? Number(position.rowEnd) : window.innerWidth - fallback;
    const edge = (position?.edge || "center") as HoverEdge;

    let desiredLeft = card.left + card.width / 2 - modalRect.width / 2;
    if (edge === "left") desiredLeft = rowStart;
    if (edge === "right") desiredLeft = rowEnd - modalRect.width;

    const desiredTop = card.top + card.height / 2 - modalRect.height / 2;
    const minLeft = edge === "left" ? rowStart : VIEWPORT_GUTTER;
    const maxRightGutter = edge === "right" ? Math.max(0, window.innerWidth - rowEnd) : VIEWPORT_GUTTER;
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

  useLayoutEffect(() => {
    if (!position || !modalRef.current || typeof window === "undefined") return;
    setGeometry(null);
    setPhase("measure");
    let frame1 = requestAnimationFrame(() => {
      const next = calculateGeometry();
      if (!next) return;
      setGeometry(next);
      setPhase("reset");
      frame1 = requestAnimationFrame(() => setPhase("open"));
    });
    return () => cancelAnimationFrame(frame1);
  }, [position, calculateGeometry]);

  useEffect(() => {
    if (!position || typeof window === "undefined") return;
    let frame = 0;

    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };

    const closeIfSourceLeftPointer = () => {
      if (frame || phase === "measure" || phase === "reset" || phase === "close") return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const card = currentCardRect();
        const pointer = pointerRef.current;
        if (!card || pointer.x < 0 || pointer.y < 0 || pointInsideRect(pointer.x, pointer.y, card)) return;
        const target = document.elementFromPoint(pointer.x, pointer.y);
        onMouseLeave?.({ relatedTarget: target, type: "scroll-anchor-leave" });
      });
    };

    const onResize = () => {
      if (frame || phase === "measure" || phase === "reset" || phase === "close") return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const anchor = position?.anchor as HTMLElement | null;
        if (anchor?.isConnected) {
          const cardRect = anchor.getBoundingClientRect();
          const measured = measureEdges(anchor, cardRect);
          position.rowStart = measured.rowStart;
          position.rowEnd = measured.rowEnd;
          position.edge = measured.edge;
        }
        const next = calculateGeometry();
        if (next) setGeometry(next);
      });
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", closeIfSourceLeftPointer, true);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener?.("scroll", closeIfSourceLeftPointer);
    window.visualViewport?.addEventListener?.("resize", onResize);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", closeIfSourceLeftPointer, true);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener?.("scroll", closeIfSourceLeftPointer);
      window.visualViewport?.removeEventListener?.("resize", onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [position, phase, calculateGeometry, currentCardRect, onMouseLeave]);

  useEffect(() => {
    if (closing && geometry) setPhase("close");
  }, [closing, geometry]);

  if (!position || typeof document === "undefined") return null;

  const card = currentCardRect() || (position.cardRect as DOMRect);
  const modalWidth = position.modalWidth || MIN_MODAL_WIDTH;
  const fallback = Math.max(16, Math.round(window.innerWidth * 0.04));
  const rowStart = Number.isFinite(position?.rowStart) ? Number(position.rowStart) : fallback;
  const rowEnd = Number.isFinite(position?.rowEnd) ? Number(position.rowEnd) : window.innerWidth - fallback;
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
    if (isDomElement(target) && target.closest("button, a, [role='button'], input, select, textarea")) return;
    onClick?.(event);
  };

  const transformOrigin = edge === "left" ? "0% 50%" : edge === "right" ? "100% 50%" : "50% 50%";

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
