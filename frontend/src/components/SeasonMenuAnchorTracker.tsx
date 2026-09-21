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

function clampX(value: number, min: number, max: number) {
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
  const width = Math.max(anchorRect.width, paperRect.width || 0);
  const desiredLeft = anchorRect.right - width;
  const left = clampX(desiredLeft, 8, Math.max(8, viewportWidth - width - 8));

  // Never clamp vertically. If the trigger scrolls out of the viewport, its
  // dropdown must leave with it instead of floating in the middle of the page.
  const top = anchorRect.bottom + gap;

  paper.dataset.flixitFrozenSeasonMenu = "true";
  paper.classList.add("flixit-frozen-season-menu", "flixit-season-menu-anchored");
  paper.parentElement?.classList.add("flixit-frozen-season-menu-root");
  paper.style.setProperty("--flixit-season-menu-top", `${top}px`);
  paper.style.setProperty("--flixit-season-menu-left", `${left}px`);
  paper.style.setProperty("--flixit-season-menu-width", `${width}px`);
  return true;
}

export default function SeasonMenuAnchorTracker() {
  const location = useLocation();

  useEffect(() => {
    if (!DETAIL_TV_RE.test(location.pathname)) return;

    let disposed = false;
    let raf = 0;
    let idleFrames = 0;

    // Mobile browser chrome and momentum scrolling do not reliably emit a
    // normal window scroll event on every painted frame. While the menu is open
    // we therefore track the real trigger rectangle on each animation frame.
    const frame = () => {
      if (disposed) return;
      const open = syncSeasonMenuToAnchor();
      document.documentElement.classList.toggle("flixit-season-menu-open", open);
      idleFrames = open ? 0 : Math.min(30, idleFrames + 1);
      raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (!raf && !disposed) raf = requestAnimationFrame(frame);
    };

    const observer = new MutationObserver(() => {
      syncSeasonMenuToAnchor();
      wake();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "aria-expanded", "style"],
    });

    window.addEventListener("scroll", syncSeasonMenuToAnchor, true);
    window.addEventListener("resize", syncSeasonMenuToAnchor, { passive: true });
    window.visualViewport?.addEventListener("scroll", syncSeasonMenuToAnchor, { passive: true });
    window.visualViewport?.addEventListener("resize", syncSeasonMenuToAnchor, { passive: true });
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", syncSeasonMenuToAnchor, true);
      window.removeEventListener("resize", syncSeasonMenuToAnchor);
      window.visualViewport?.removeEventListener("scroll", syncSeasonMenuToAnchor);
      window.visualViewport?.removeEventListener("resize", syncSeasonMenuToAnchor);
      document.documentElement.classList.remove("flixit-season-menu-open");
    };
  }, [location.pathname]);

  return null;
}
