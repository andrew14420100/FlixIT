// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const DETAIL_TV_RE = /^\/(?:detail|browse)\/tv\/\d+(?:\/|$)/i;

function visibleElement(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) || null;
}

function seasonPaper() {
  return Array.from(document.querySelectorAll<HTMLElement>(".MuiPopover-root .MuiPaper-root, .MuiMenu-root .MuiPaper-root"))
    .find((paper) => {
      const options = Array.from(paper.querySelectorAll<HTMLElement>("[role='option'], .MuiMenuItem-root"));
      return options.some((option) => /Stagione\s+\d+/i.test(String(option.textContent || "")));
    }) || null;
}

function seasonAnchor() {
  const mobile = visibleElement(".mobile-detail-season-select");
  if (mobile) return mobile;
  return visibleElement("#episodes [role='combobox']") || visibleElement("#episodes .MuiSelect-select");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function syncSeasonMenuToAnchor() {
  const paper = seasonPaper();
  const anchor = seasonAnchor();
  if (!paper || !anchor) {
    document.documentElement.classList.remove("flixit-season-menu-open");
    return false;
  }

  const anchorRect = anchor.getBoundingClientRect();
  const paperRect = paper.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width || window.innerWidth;
  const viewportHeight = viewport?.height || window.innerHeight;
  const gap = 6;
  const width = Math.max(anchorRect.width, paperRect.width || 0, 150);
  const left = clamp(anchorRect.right - width, 8, Math.max(8, viewportWidth - width - 8));
  const top = anchorRect.bottom + gap;

  paper.dataset.flixitFrozenSeasonMenu = "true";
  paper.classList.add("flixit-frozen-season-menu", "flixit-season-menu-anchored");
  paper.parentElement?.classList.add("flixit-frozen-season-menu-root");

  // The MUI menu lives in a portal. Recompute its fixed coordinates from the
  // trigger whenever the page/visual viewport moves, so it travels with the
  // Stagione control instead of sticking to the screen.
  paper.style.setProperty("position", "fixed", "important");
  paper.style.setProperty("top", `${Math.round(top)}px`, "important");
  paper.style.setProperty("left", `${Math.round(left)}px`, "important");
  paper.style.setProperty("right", "auto", "important");
  paper.style.setProperty("width", `${Math.round(width)}px`, "important");
  paper.style.setProperty("max-height", `${Math.round(Math.min(420, viewportHeight * 0.62))}px`, "important");
  paper.style.setProperty("margin", "0", "important");
  paper.style.setProperty("transform", "none", "important");
  paper.style.setProperty("transform-origin", "center top", "important");
  document.documentElement.classList.add("flixit-season-menu-open");
  return true;
}

export default function SeasonMenuAnchorTracker() {
  const location = useLocation();

  useEffect(() => {
    if (!DETAIL_TV_RE.test(location.pathname)) return;

    let disposed = false;
    let raf = 0;
    let burstUntil = 0;

    const paint = () => {
      raf = 0;
      if (disposed) return;
      const open = syncSeasonMenuToAnchor();
      if (open && performance.now() < burstUntil) {
        raf = requestAnimationFrame(paint);
      }
    };

    const schedule = (burstMs = 0) => {
      if (disposed) return;
      if (burstMs > 0) burstUntil = Math.max(burstUntil, performance.now() + burstMs);
      if (!raf) raf = requestAnimationFrame(paint);
    };

    // Child-list observation is only used to detect the portal being mounted or
    // removed. The previous attribute observer + permanent requestAnimationFrame
    // loop ran continuously on every TV detail page, even with the menu closed.
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.addedNodes.length || record.removedNodes.length)) schedule(120);
    });
    observer.observe(document.body, { subtree: false, childList: true });

    const onScroll = () => schedule(260);
    const onTouchMove = () => schedule(320);
    const onResize = () => schedule(180);

    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.visualViewport?.addEventListener("scroll", onScroll, { passive: true });
    window.visualViewport?.addEventListener("resize", onResize, { passive: true });
    schedule(120);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("touchmove", onTouchMove);
      window.visualViewport?.removeEventListener("scroll", onScroll);
      window.visualViewport?.removeEventListener("resize", onResize);
      document.documentElement.classList.remove("flixit-season-menu-open");
    };
  }, [location.pathname]);

  return null;
}
