// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";

const MOBILE_QUERY = "(max-width:899px)";
const HERO_CACHE_MS = 5 * 60 * 1000;
let heroMemo: { at: number; data: any } | null = null;
let heroPending: Promise<any> | null = null;

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
  const width = `${rect.width.toFixed(2)}px`;
  const height = `${(rect.width * 1.5).toFixed(2)}px`;
  if (root.style.getPropertyValue("--flixit-reference-poster-w") !== width) {
    root.style.setProperty("--flixit-reference-poster-w", width);
    root.style.setProperty("--flixit-reference-poster-h", height);
  }
}

async function getHeroMetadata(signal: AbortSignal) {
  const now = Date.now();
  if (heroMemo && now - heroMemo.at < HERO_CACHE_MS) return heroMemo.data;
  if (heroPending) return heroPending;

  heroPending = fetch("/api/public/hero", { signal, headers: { Accept: "application/json" } })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      if (data) heroMemo = { at: Date.now(), data };
      return data;
    })
    .finally(() => { heroPending = null; });
  return heroPending;
}

export default function MobileHomeReferenceRuntime() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const isHome = location.pathname === "/" || location.pathname === "/browse";

  useEffect(() => {
    if (!isMobile || !isHome) return;

    let cancelled = false;
    let heroData: any = heroMemo?.data || null;
    let raf = 0;
    const controller = new AbortController();
    const observers: MutationObserver[] = [];
    const timers: number[] = [];

    const apply = () => {
      if (cancelled || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
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

    const attachScopedObservers = () => {
      const hero = document.querySelector<HTMLElement>('[data-testid="hero-section"]');
      const rows = document.querySelector<HTMLElement>('[data-testid="home-rows"]');
      if (hero && !hero.dataset.flixitReferenceObserved) {
        hero.dataset.flixitReferenceObserved = "1";
        const observer = new MutationObserver(apply);
        observer.observe(hero, { subtree: true, childList: true });
        observers.push(observer);
      }
      if (rows && !rows.dataset.flixitReferenceObserved) {
        rows.dataset.flixitReferenceObserved = "1";
        const observer = new MutationObserver(apply);
        observer.observe(rows, { subtree: true, childList: true });
        observers.push(observer);
      }
    };

    getHeroMetadata(controller.signal)
      .then((data) => {
        if (cancelled) return;
        heroData = data;
        apply();
      })
      .catch(() => {});

    // Home mounts asynchronously. A few bounded probes are cheaper than a
    // document-wide MutationObserver reacting to every card/image insertion.
    [0, 120, 320, 750, 1500].forEach((delay) => {
      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        attachScopedObservers();
        apply();
      }, delay));
    });

    window.addEventListener("resize", apply, { passive: true });

    return () => {
      cancelled = true;
      controller.abort();
      if (raf) cancelAnimationFrame(raf);
      timers.forEach((timer) => window.clearTimeout(timer));
      observers.forEach((observer) => observer.disconnect());
      document.querySelectorAll<HTMLElement>('[data-flixit-reference-observed="1"]').forEach((node) => {
        delete node.dataset.flixitReferenceObserved;
      });
      window.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--flixit-reference-poster-w");
      document.documentElement.style.removeProperty("--flixit-reference-poster-h");
    };
  }, [isMobile, isHome]);

  return null;
}
