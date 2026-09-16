// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";

const EDGE_MARGIN = 12;
const CLOSE_MS = 320;

// Netflix-like "grow in place" hover: the expanded card mounts exactly over the base card,
// scales up smoothly and shrinks back on mouse leave before unmounting.
// Alignment keeps the expanded card inside the viewport (first card -> left, last -> right).
export function useHoverExpand(ref, getWidth: (rect: DOMRect) => number, delay = 250) {
  const [state, setState] = useState({ mounted: false, entered: false, align: "center", width: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;
  const openTimer = useRef<any>(null);
  const closeTimer = useRef<any>(null);
  const raf = useRef<any>(null);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    openTimer.current = closeTimer.current = raf.current = null;
  };

  const onEnter = useCallback(() => {
    clearTimers();
    if (stateRef.current.mounted) {
      setState((s) => ({ ...s, entered: true }));
      return;
    }
    openTimer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = getWidth(r);
      const extra = (width - r.width) / 2;
      const vw = document.documentElement.clientWidth;
      const align = r.left - extra < EDGE_MARGIN ? "left" : r.right + extra > vw - EDGE_MARGIN ? "right" : "center";
      setState({ mounted: true, entered: false, align, width });
      raf.current = requestAnimationFrame(() => {
        raf.current = requestAnimationFrame(() => setState((s) => (s.mounted ? { ...s, entered: true } : s)));
      });
    }, delay);
  }, [ref, getWidth, delay]);

  const onLeave = useCallback(() => {
    clearTimers();
    if (!stateRef.current.mounted) return;
    setState((s) => ({ ...s, entered: false }));
    closeTimer.current = setTimeout(() => setState((s) => ({ ...s, mounted: false })), CLOSE_MS);
  }, []);

  useEffect(() => () => clearTimers(), []);

  return { open: state.mounted, entered: state.entered, align: state.align, width: state.width, onEnter, onLeave };
}

interface OverlayProps {
  align: string;
  width: number;
  entered: boolean;
  initialScale?: number;
  fade?: boolean;
  children: any;
  testId?: string;
}

export function ExpandOverlay({ align, width, entered, initialScale = 0.66, fade = false, children, testId }: OverlayProps) {
  const imgHalf = (width * 9) / 16 / 2;
  const pos = align === "left" ? { left: 0 } : align === "right" ? { right: 0 } : { left: "50%" };
  return (
    <div
      data-testid={testId}
      data-align={align}
      data-state={entered ? "open" : "closed"}
      style={{
        position: "absolute", top: "50%", width, zIndex: 100, ...pos,
        transform: `translate(${align === "center" ? "-50%" : "0"}, -${imgHalf}px)`,
        pointerEvents: entered ? "auto" : "none",
      }}
    >
      <div
        style={{
          transformOrigin: `${align} ${imgHalf}px`,
          transform: `scale(${entered ? 1 : initialScale})`,
          opacity: entered || !fade ? 1 : 0,
          transition: `transform ${CLOSE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 240ms ease`,
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </div>
  );
}
