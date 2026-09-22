// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";

const MOBILE_QUERY = "(max-width:899px)";

function syncReferencePosterSize() {
  const selectors = [
    '[data-testid="home-rows"] .slider-row:not(.top10-row):not(#continua) .slick-slide:not(.slick-cloned) .netflix-standard-card-image-wrap',
    '[data-testid="home-rows"] .slider-row:not(.top10-row):not(#continua) .slick-slide .netflix-standard-card-image-wrap',
  ];

  let reference: HTMLElement | null = null;
  for (const query of selectors) {
    reference = document.querySelector<HTMLElement>(query);
    if (reference) break;
  }
  if (!reference) return;

  const rect = reference.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || rect.width < 48) return;

  const root = document.documentElement;
  const width = `${rect.width.toFixed(2)}px`;
  const height = `${(rect.width * 1.5).toFixed(2)}px`;

  if (root.style.getPropertyValue("--flixit-reference-poster-w") !== width) {
    root.style.setProperty("--flixit-reference-poster-w", width);
    root.style.setProperty("--flixit-reference-poster-h", height);
  }
}

/**
 * Layout-only runtime for the mobile Home.
 * It measures an existing poster so Top 10 can reuse the same 2:3 footprint.
 * It never injects labels, genres, seasons, buttons, sections or other content.
 */
export default function MobileHomeReferenceRuntime() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const isHome = location.pathname === "/" || location.pathname === "/browse";

  useEffect(() => {
    if (!isMobile || !isHome) return;

    let cancelled = false;
    let raf = 0;
    const timers: number[] = [];
    let observer: MutationObserver | null = null;

    const apply = () => {
      if (cancelled || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncReferencePosterSize();
      });
    };

    const attachObserver = () => {
      const rows = document.querySelector<HTMLElement>('[data-testid="home-rows"]');
      if (!rows || observer) return;
      observer = new MutationObserver(apply);
      observer.observe(rows, { subtree: true, childList: true });
    };

    [0, 120, 320, 750, 1500].forEach((delay) => {
      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        attachObserver();
        apply();
      }, delay));
    });

    window.addEventListener("resize", apply, { passive: true });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      timers.forEach((timer) => window.clearTimeout(timer));
      observer?.disconnect();
      window.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--flixit-reference-poster-w");
      document.documentElement.style.removeProperty("--flixit-reference-poster-h");
    };
  }, [isMobile, isHome]);

  return null;
}
