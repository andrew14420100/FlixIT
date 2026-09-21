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
  if (!paper || !anchor) return false;

  const anchorRect = anchor.getBoundingClientRect();
  const paperRect = paper.getBoundingClientRect();
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const gap = 6;
  const width = Math.max(anchorRect.width, paperRect.width || 0, 134);
  const desiredLeft = anchorRect.right - width;
  const left = clamp(desiredLeft, 8, Math.max(8, viewportWidth - width - 8));
  const top = anchorRect.bottom + gap;

  paper.dataset.flixitFrozenSeasonMenu = "true";
  paper.classList.add("flixit-frozen-season-menu", "flixit-season-menu-anchored");
  paper.style.setProperty("position", "fixed", "important");
  paper.style.setProperty("top", `${Math.round(top)}px`, "important");
  paper.style.setProperty("left", `${Math.round(left)}px`, "important");
  paper.style.setProperty("right", "auto", "important");
  paper.style.setProperty("width", `${Math.round(width)}px`, "important");
  paper.style.setProperty("min-width", `${Math.round(width)}px`, "important");
  paper.style.setProperty("margin", "0", "important");
  paper.style.setProperty("transform", "none", "important");
  paper.style.setProperty("--flixit-season-menu-top", `${Math.round(top)}px`);
  paper.style.setProperty("--flixit-season-menu-left", `${Math.round(left)}px`);
  paper.style.setProperty("--flixit-season-menu-width", `${Math.round(width)}px`);
  return true;
}

export default function SeasonMenuAnchorTracker() {
  const location = useLocation();

  useEffect(() => {
    if (!DETAIL_TV_RE.test(location.pathname)) return;

    let raf = 0;
    let disposed = false;

    // MUI portals are positioned independently from the scrolled page. While
    // the menu is open we therefore follow the trigger on every animation
    // frame, not only on scroll events. This also covers Chrome/iOS toolbar
    // movement and momentum scrolling where ordinary scroll events can lag.
    const loop = () => {
      if (disposed) return;
      syncSeasonMenuToAnchor();
      raf = requestAnimationFrame(loop);
    };

    const observer = new MutationObserver(() => syncSeasonMenuToAnchor());
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "aria-expanded"],
    });

    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [location.pathname]);

  return null;
}
