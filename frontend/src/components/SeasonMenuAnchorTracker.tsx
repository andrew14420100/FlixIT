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

  // MUI renders Select menus in a portal and normally calculates these
  // coordinates only when the menu opens. Set the REAL CSS coordinates, not
  // custom variables, so the menu stays physically attached to Stagione X
  // while the document moves underneath it.
  paper.style.setProperty("position", "fixed", "important");
  paper.style.setProperty("top", `${Math.round(top)}px`, "important");
  paper.style.setProperty("left", `${Math.round(left)}px`, "important");
  paper.style.setProperty("right", "auto", "important");
  paper.style.setProperty("width", `${Math.round(width)}px`, "important");
  paper.style.setProperty("max-height", `${Math.round(Math.min(420, viewportHeight * 0.62))}px`, "important");
  paper.style.setProperty("margin", "0", "important");
  paper.style.setProperty("transform", "none", "important");
  paper.style.setProperty("transform-origin", "center top", "important");

  return true;
}

export default function SeasonMenuAnchorTracker() {
  const location = useLocation();

  useEffect(() => {
    if (!DETAIL_TV_RE.test(location.pathname)) return;

    let disposed = false;
    let raf = 0;

    // Track every painted frame while the dropdown exists. This also covers
    // iPhone/Chrome momentum scroll and browser-toolbar movement, where normal
    // scroll events can be sparse.
    const frame = () => {
      if (disposed) return;
      const open = syncSeasonMenuToAnchor();
      document.documentElement.classList.toggle("flixit-season-menu-open", open);
      raf = requestAnimationFrame(frame);
    };

    const observer = new MutationObserver(syncSeasonMenuToAnchor);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "aria-expanded"],
    });

    window.addEventListener("scroll", syncSeasonMenuToAnchor, true);
    window.addEventListener("resize", syncSeasonMenuToAnchor, { passive: true });
    window.addEventListener("touchmove", syncSeasonMenuToAnchor, { passive: true });
    window.visualViewport?.addEventListener("scroll", syncSeasonMenuToAnchor, { passive: true });
    window.visualViewport?.addEventListener("resize", syncSeasonMenuToAnchor, { passive: true });
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", syncSeasonMenuToAnchor, true);
      window.removeEventListener("resize", syncSeasonMenuToAnchor);
      window.removeEventListener("touchmove", syncSeasonMenuToAnchor);
      window.visualViewport?.removeEventListener("scroll", syncSeasonMenuToAnchor);
      window.visualViewport?.removeEventListener("resize", syncSeasonMenuToAnchor);
      document.documentElement.classList.remove("flixit-season-menu-open");
    };
  }, [location.pathname]);

  return null;
}
