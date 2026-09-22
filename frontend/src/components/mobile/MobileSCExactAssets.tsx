// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";

const MOBILE_QUERY = "(max-width:899px)";

/**
 * Hero/detail artwork is resolved by the normal media-asset hooks.  This mobile
 * helper now only prioritises the already-resolved above-the-fold images.  The
 * previous implementation downloaded and indexed the entire SC catalogue a
 * second time solely to overwrite those same image URLs.
 */
export default function MobileSCExactAssets() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();

  useEffect(() => {
    if (!isMobile || location.pathname.startsWith("/watch")) return;

    let raf = 0;
    const apply = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const selectors = [
          '[data-testid="hero-section"] [data-testid="hero-backdrop"]',
          '[data-testid="hero-section"] [data-testid="hero-logo"]',
          '.mobile-detail-hero .mobile-detail-backdrop',
          '.mobile-detail-hero .mobile-detail-logo',
          '[data-testid="hub-hero"] img',
        ];
        selectors.forEach((selector) => {
          const img = document.querySelector<HTMLImageElement>(selector);
          if (!img) return;
          img.loading = "eager";
          img.decoding = "async";
          try { (img as any).fetchPriority = "high"; } catch {}
        });
      });
    };

    apply();
    const timer = window.setTimeout(apply, 160);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [isMobile, location.pathname]);

  return null;
}
