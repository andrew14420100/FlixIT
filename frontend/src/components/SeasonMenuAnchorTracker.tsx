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
  if (!paper || !anchor) return;

  const anchorRect = anchor.getBoundingClientRect();
  const paperRect = paper.getBoundingClientRect();
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const gap = 6;
  const width = Math.max(anchorRect.width, paperRect.width || 0);
  const desiredLeft = anchorRect.right - width;
  const left = clamp(desiredLeft, 8, Math.max(8, viewportWidth - width - 8));
  const top = anchorRect.bottom + gap;

  paper.dataset.flixitFrozenSeasonMenu = "true";
  paper.classList.add("flixit-frozen-season-menu", "flixit-season-menu-anchored");
  paper.style.setProperty("--flixit-season-menu-top", `${Math.round(top)}px`);
  paper.style.setProperty("--flixit-season-menu-left", `${Math.round(left)}px`);
  paper.style.setProperty("--flixit-season-menu-width", `${Math.round(width)}px`);
}

export default function SeasonMenuAnchorTracker() {
  const location = useLocation();

  useEffect(() => {
    if (!DETAIL_TV_RE.test(location.pathname)) return;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncSeasonMenuToAnchor();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-expanded"] });

    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule, { passive: true });
    window.visualViewport?.addEventListener("scroll", schedule, { passive: true });
    window.visualViewport?.addEventListener("resize", schedule, { passive: true });
    schedule();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [location.pathname]);

  return null;
}
