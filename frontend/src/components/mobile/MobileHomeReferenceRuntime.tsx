// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";

const MOBILE_QUERY = "(max-width:899px)";

function genreNames(payload: any) {
  const raw = payload?.detail?.genres || payload?.genres || payload?.detail?.genre_names || [];
  return (Array.isArray(raw) ? raw : [])
    .map((genre: any) => typeof genre === "string" ? genre : genre?.name)
    .filter(Boolean)
    .slice(0, 4);
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

        let season = hero.querySelector<HTMLElement>('[data-testid="hero-season-label"], .mobile-home-season-runtime');
        const seasonText = mediaType === "tv" ? String(heroData?.seasonLabel || "").trim() : "";
        if (!season && seasonText) {
          season = document.createElement("div");
          season.className = "mobile-home-season-runtime";
          title.insertAdjacentElement("afterend", season);
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
    apply();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [isMobile, isHome]);

  return null;
}
