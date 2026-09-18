// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const OPEN_DELAY_MS = 300;
const ENTER_DELAY_MS = 25;
const REMOVE_DELAY_MS = 200;
const DESKTOP_MIN_WIDTH = 800;

function initialTranslateY(viewportWidth: number) {
  let value = (3 / 130) * viewportWidth - 69 / 13;

  if (viewportWidth < 1400) {
    value = (9 / 299) * viewportWidth - 2126 / 299;
  }

  if (viewportWidth < 1100) {
    value = (9 / 299) * viewportWidth + 574 / 299;
  }

  return value;
}

export function useHoverExpand(
  targetRef: React.RefObject<HTMLElement>,
  _getExpandedWidth?: (rect: DOMRect) => number,
  options: {
    top10?: boolean;
    watchlist?: boolean;
    upcoming?: boolean;
  } = {}
) {
  const openTimer = useRef<any>(null);
  const enterTimer = useRef<any>(null);
  const removeTimer = useRef<any>(null);

  const [open, setOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const [display, setDisplay] = useState(true);
  const [position, setPosition] = useState<any>(null);

  const clearTimers = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(enterTimer.current);
    clearTimeout(removeTimer.current);
  }, []);

  const closePreview = useCallback(() => {
    clearTimeout(openTimer.current);

    setDisplay(false);

    clearTimeout(removeTimer.current);
    removeTimer.current = setTimeout(() => {
      setOpen(false);
      setEntered(false);
      setPosition(null);
    }, REMOVE_DELAY_MS);
  }, []);

  const onEnter = useCallback(
    (event?: any) => {
      if (typeof window === "undefined" || window.innerWidth < DESKTOP_MIN_WIDTH) return;

      clearTimeout(removeTimer.current);
      clearTimeout(openTimer.current);

      // StreamingUnity usa event.target, non currentTarget.
      const element = (event?.target || targetRef.current) as HTMLElement | null;
      if (!element) return;

      openTimer.current = setTimeout(() => {
        if (document.querySelector(".preview-wrap")) return;
        if (!element.isConnected) return;

        const rect = element.getBoundingClientRect();

        let offsetY = rect.top + window.scrollY;

        if (options.top10) {
          offsetY += rect.top / 16;
        }

        setPosition({
          offsetX: rect.left,
          offsetY,
          width: element.clientWidth,
          height: element.clientHeight,
          fadeImageOut: !!options.top10,
          isWatchlist: !!options.watchlist,
          isUpcoming: !!options.upcoming,
        });

        setDisplay(true);
        setEntered(false);
        setOpen(true);

        enterTimer.current = setTimeout(() => {
          setEntered(true);
        }, ENTER_DELAY_MS);
      }, OPEN_DELAY_MS);
    },
    [options.top10, options.watchlist, options.upcoming, targetRef]
  );

  const onLeave = useCallback(
    (event?: any) => {
      if (
        event?.relatedTarget &&
        typeof event.relatedTarget.closest === "function" &&
        event.relatedTarget.closest(".preview-wrap")
      ) {
        return;
      }

      clearTimeout(openTimer.current);

      if (open) {
        closePreview();
      }
    },
    [closePreview, open]
  );

  const onOverlayLeave = useCallback(() => {
    closePreview();
  }, [closePreview]);

  useEffect(() => {
    if (!open) return;

    let cleanup: null | (() => void) = null;

    const timer = setTimeout(() => {
      if (!display) {
        closePreview();
        return;
      }

      const onMouseMove = (event: MouseEvent) => {
        const target = event.target as Element | null;
        if (!target || typeof target.closest !== "function") return;

        if (!target.closest(".preview-wrap")) {
          closePreview();
        }
      };

      window.addEventListener("mousemove", onMouseMove);
      cleanup = () => window.removeEventListener("mousemove", onMouseMove);
    }, 200);

    return () => {
      clearTimeout(timer);
      cleanup?.();
    };
  }, [open, display, closePreview]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const expandedWidth = position ? position.width * 1.5 : 0;

  return {
    open,
    entered,
    display,
    closing: open && !display,
    align: "left",
    width: expandedWidth,
    position,
    onEnter,
    onLeave,
    onOverlayLeave,
    closePreview,
  };
}

export function ExpandOverlay({
  position,
  entered,
  display = true,
  fadeImageOut,
  onMouseLeave,
  children,
  testId,
}: any) {
  if (typeof document === "undefined" || !position) return null;

  const viewportWidth = window.innerWidth;
  const expandedWidth = position.width * 1.5;

  let top = position.offsetY - (position.height / 3) * 2;
  let left = position.offsetX;

  let scale = 0.666667;
  let opacity = 0;
  let origin = "left";
  let shadow = "none";
  let transition = "transform 200ms";
  let translateY = initialTranslateY(viewportWidth);

  if (left > (viewportWidth / 100) * 70) {
    left -= position.width / 2;
    origin = "right";
  } else if (left > (viewportWidth / 100) * 5) {
    left -= position.width / 4;
    origin = "center";
  }

  if (entered) {
    opacity = 1;
  }

  if (entered && display) {
    scale = 1;
    translateY = 0;
    shadow = "rgb(0 0 0 / 75%) 0px 3px 10px";
  }

  const shouldFadeImageOut =
    fadeImageOut ?? position.fadeImageOut ?? false;

  if (shouldFadeImageOut && !display) {
    opacity = 0;
    transition += ", opacity 200ms";
  }

  return createPortal(
    <div
      className="preview-wrap font-vw"
      data-testid={testId}
      style={{
        display: "flex",
        justifyContent: "center",
        left: 0,
        top: 0,
        position: "absolute",
        fontSize: "1vw",
        fontFamily: '"Netflix Sans","Helvetica Neue",Helvetica,Arial,sans-serif',
        lineHeight: "inherit",
        color: "#e8e8e8",
        userSelect: "none",
      }}
    >
      <div
        className="preview-dialog"
        onMouseLeave={onMouseLeave}
        style={{
          top: `${Math.round(top)}px`,
          left: `${Math.round(left)}px`,
          width: `${Math.round(expandedWidth)}px`,
          transform: `translateY(${translateY}px) scale(${scale})`,
          transformOrigin: `${origin} center`,
          transition,
          opacity,
          boxShadow: shadow,
          position: "absolute",
          zIndex: 150,
          borderRadius: ".4em",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
