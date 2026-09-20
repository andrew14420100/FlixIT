// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";

const MOBILE_QUERY = "(max-width:899px)";

function genreNames(payload: any) {
  const raw = payload?.detail?.genres || payload?.genres || payload?.detail?.genre_names || [];
  const names = (Array.isArray(raw) ? raw : [])
    .map((genre: any) => typeof genre === "string" ? genre : genre?.name)
    .map((name: any) => String(name || "").trim())
    .filter(Boolean);
  return [...new Set(names)];
}

function syncReferencePosterSize() {
  const selector = [
    '[data-testid="home-rows"] .slider-row:not(.top10-row):not(#continua) .slick-slide:not(.slick-cloned) .netflix-standard-card-image-wrap',
    '[data-testid="home-rows"] .slider-row:not(.top10-row):not(#continua) .slick-slide .netflix-standard-card-image-wrap',
  ];

  let reference: HTMLElement | null = null;
  for (const query of selector) {
    reference = document.querySelector<HTMLElement>(query);
    if (reference) break;
  }
  if (!reference) return;

  const rect = reference.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || rect.width < 48) return;

  const root = document.documentElement;
  root.style.setProperty("--flixit-reference-poster-w", `${rect.width.toFixed(2)}px`);
  root.style.setProperty("--flixit-reference-poster-h", `${(rect.width * 1.5).toFixed(2)}px`);
}

export default function MobileHomeReferenceRuntime() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const isHome = location.pathname === "/" || location.pathname === "/browse";

  useEffect(() => {
    if (!isMobile || !isHome) return;

    let cancelled = false;
    let heroData: any = null;
    let observer: MutationObserver | null = null;
    let raf = 0;

    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        syncReferencePosterSize();

        const hero = document.querySelector<HTMLElement>('[data-testid="hero-section"]');
        if (!hero) return;

        const header = document.querySelector<HTMLElement>('[data-testid="main-header"]');
        const menuIcon = header?.querySelector<HTMLElement>('[data-testid="MenuIcon"]');
        const menuButton = menuIcon?.closest("button") as HTMLElement | null;
        if (menuButton) menuButton.style.display = "none";

        if (!heroData) return;
        const mediaType = String(heroData?.mediaType || "tv").toLowerCase();
        hero.dataset.mobileMediaType = mediaType;

        const content = hero.querySelector<HTMLElement>('[data-testid="hero-content"]');
        const title = hero.querySelector<HTMLElement>(".title");
        if (!content || !title) return;

        const realSeason = hero.querySelector<HTMLElement>('[data-testid="hero-season-label"]');
        const injectedSeasons = Array.from(hero.querySelectorAll<HTMLElement>(".mobile-home-season-runtime"));
        if (realSeason) injectedSeasons.forEach((node) => node.remove());

        const seasonText = mediaType === "tv" ? String(heroData?.seasonLabel || "").trim() : "";
        let season = realSeason;
        if (!season && seasonText) {
          season = injectedSeasons[0] || document.createElement("div");
          season.className = "mobile-home-season-runtime";
          if (!season.isConnected) title.insertAdjacentElement("afterend", season);
        }
        if (season) {
          season.textContent = seasonText;
          season.toggleAttribute("hidden", !seasonText);
        }

        let genres = hero.querySelector<HTMLElement>(".genres");
        if (!genres) {
          genres = document.createElement("div");
          genres.className = "genres";
          (season || title).insertAdjacentElement("afterend", genres);
        }
        const names = genreNames(heroData);
        genres.textContent = names.join(" • ");
        genres.toggleAttribute("hidden", names.length === 0);
      });
    };

    fetch("/api/public/hero", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled) return;
        heroData = data;
        apply();
      })
      .catch(() => {});

    observer = new MutationObserver(apply);
    observer.observe(document.body, { subtree: true, childList: true });
    window.addEventListener("resize", apply, { passive: true });
    apply();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--flixit-reference-poster-w");
      document.documentElement.style.removeProperty("--flixit-reference-poster-h");
    };
  }, [isMobile, isHome]);

  return null;
}
