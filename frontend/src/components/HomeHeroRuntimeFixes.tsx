// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useHeroData } from "src/hooks/useHeroData";

const HERO_SELECTOR = '[data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard';
const VIDEO_SELECTOR = '[data-testid="hero-trailer"] video';
const CALLOUT_SELECTOR = '.netflix-home-callouts .netflix-home-callout';
const LEGACY_HIDDEN_ATTR = 'data-legacy-hero-label-hidden';
const DESCRIPTION_HIDE_MS = 4000;
const FINAL_STYLE_ID = 'flixit-home-hero-runtime-final';

const FINAL_HERO_CSS = String.raw`
@media (min-width: 900px) {
  /* Restore the Home header geometry used before the 80px experiment. Keep the
     route stage in lockstep so nothing is clipped underneath the fixed AppBar. */
  body:has([data-testid="home-page"] .netflix-home-billboard) [data-testid="main-header"] {
    height: 78px !important;
    min-height: 78px !important;
  }

  body:has([data-testid="home-page"] .netflix-home-billboard) .flixit-route-stage {
    padding-top: 78px !important;
  }

  [data-testid="home-page"] {
    position: relative !important;
    isolation: isolate !important;
    overflow-x: clip !important;
  }

  /* Ambient colour follows the artwork published from Admin. */
  [data-testid="home-page"]::before {
    content: "" !important;
    position: absolute !important;
    top: -28px !important;
    left: -8vw !important;
    right: -8vw !important;
    height: min(980px, 68vw) !important;
    z-index: 0 !important;
    pointer-events: none !important;
    background-image: var(--flixit-hero-ambient-image, none) !important;
    background-size: cover !important;
    background-position: center 16% !important;
    background-repeat: no-repeat !important;
    filter: blur(82px) saturate(1.62) brightness(.58) !important;
    opacity: .52 !important;
    transform: scale(1.10) !important;
    transform-origin: center top !important;
    -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,.98) 0%, rgba(0,0,0,.90) 58%, rgba(0,0,0,.42) 82%, transparent 100%) !important;
    mask-image: linear-gradient(to bottom, rgba(0,0,0,.98) 0%, rgba(0,0,0,.90) 58%, rgba(0,0,0,.42) 82%, transparent 100%) !important;
    transition: background-image 650ms ease, opacity 450ms ease !important;
  }

  [data-testid="home-page"] > * {
    position: relative;
    z-index: 1;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard {
    z-index: 2 !important;
  }

  /* Keep the trailer full-bleed like Netflix. The forced contain experiment
     produced a narrow panel with visible side bars. */
  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard .netflix-home-video-layer,
  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard [data-testid="trailer-player"] {
    background: #000 !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard .netflix-home-video-layer video {
    position: absolute !important;
    inset: 0 !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 100% !important;
    min-height: 100% !important;
    object-fit: cover !important;
    object-position: center center !important;
    transform: none !important;
    background: #000 !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard.flixit-hero-video-playing [data-testid="hero-backdrop"] {
    opacity: 0 !important;
    filter: none !important;
    transform: none !important;
  }

  /* The title logo is the logo already supplied by the normal SC artwork
     pipeline. Runtime code must never replace it with TMDB artwork. */
  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard [data-testid="hero-logo"].netflix-home-logo {
    width: min(39vw, 680px) !important;
    max-width: min(39vw, 680px) !important;
    max-height: 270px !important;
    object-fit: contain !important;
    object-position: left bottom !important;
    margin-bottom: 10px !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard .netflix-home-title-fallback {
    max-width: min(44vw, 760px) !important;
    font-size: clamp(58px, 5vw, 90px) !important;
    margin-bottom: 10px !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard .netflix-home-attributes {
    margin-top: 18px !important;
    font-size: 18px !important;
    line-height: 24px !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard [data-testid="hero-overview"].netflix-home-metadata,
  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard[data-compact="true"] [data-testid="hero-overview"].netflix-home-metadata {
    width: min(45vw, 790px) !important;
    height: 60px !important;
    max-height: 60px !important;
    margin-top: 20px !important;
    font-size: 22px !important;
    line-height: 30px !important;
    transition:
      height 500ms cubic-bezier(.4,0,.2,1),
      max-height 500ms cubic-bezier(.4,0,.2,1),
      opacity 360ms cubic-bezier(.4,0,.2,1),
      margin-top 500ms cubic-bezier(.4,0,.2,1) !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard.flixit-hero-copy-collapsed [data-testid="hero-overview"].netflix-home-metadata,
  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard.flixit-hero-copy-collapsed[data-compact="true"] [data-testid="hero-overview"].netflix-home-metadata {
    height: 0 !important;
    max-height: 0 !important;
    margin-top: 0 !important;
    opacity: 0 !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard .netflix-home-actions-row {
    margin-top: 40px !important;
  }

  [data-testid="home-page"] [data-testid="hero-play-button"].netflix-home-action,
  [data-testid="home-page"] [data-testid="hero-info-button"].netflix-home-action {
    height: 54px !important;
    min-height: 54px !important;
    font-size: 17px !important;
  }

  [data-testid="home-page"] [data-testid="hero-play-button"].netflix-home-action {
    padding-left: 25px !important;
    padding-right: 25px !important;
  }

  [data-testid="home-page"] [data-testid="hero-play-button"].netflix-home-action svg {
    width: 24px !important;
    height: 24px !important;
    flex-basis: 24px !important;
  }

  [data-testid="home-page"] [data-testid="hero-controls"].netflix-home-volume-wrap,
  [data-testid="home-page"] [data-testid="hero-audio-toggle"].netflix-home-volume-button,
  [data-testid="home-page"] .netflix-home-replay-button {
    width: 54px !important;
    height: 54px !important;
    min-width: 54px !important;
    min-height: 54px !important;
  }

  [data-testid="home-page"] [data-testid="hero-audio-toggle"].netflix-home-volume-button svg,
  [data-testid="home-page"] .netflix-home-replay-button svg {
    width: 25px !important;
    height: 25px !important;
    font-size: 25px !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard .netflix-home-callout {
    min-height: 44px !important;
    padding: 8px 12px 8px 9px !important;
    gap: 8px !important;
    border-radius: 8px !important;
    background: rgba(0,0,0,.58) !important;
    box-shadow: 0 3px 12px rgba(0,0,0,.30) !important;
    font-size: 14.5px !important;
    font-weight: 700 !important;
    line-height: 18px !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard .netflix-home-callout-mark {
    width: 27px !important;
    height: 27px !important;
    flex: 0 0 27px !important;
    border-radius: 6px !important;
  }
}
`;

function firstValue(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function parseDate(value: any) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function badgeKindFromText(value: string) {
  const text = String(value || "").toLowerCase();
  if (/top\s*10/.test(text)) return "top10";
  if (/episod/.test(text)) return "episodes";
  if (/prossim|arriv|presto/.test(text)) return "upcoming";
  if (/stagion/.test(text)) return "season";
  return "available";
}

function badgeMark(kind: string) {
  if (kind === "top10") return "10";
  if (kind === "available") return "▶";
  return "N";
}

function deriveBadge(hero: any) {
  const adminText = String(hero?.seasonLabel || "").trim();
  if (adminText) {
    const kind = badgeKindFromText(adminText);
    return { kind, mark: badgeMark(kind), text: adminText };
  }

  const detail = hero?.detail || {};
  const assets = hero?.assets || {};
  const mediaType = hero?.mediaType === "movie" ? "movie" : "tv";

  const weeks = Number(
    firstValue(
      hero?.top10Weeks,
      detail?.top10_weeks,
      detail?.weeks_in_top10,
      assets?.top10Weeks,
      0
    )
  );

  if (weeks > 0) {
    return {
      kind: "top10",
      mark: "10",
      text: `${weeks} ${weeks === 1 ? "settimana" : "settimane"} nella Top 10`,
    };
  }

  const today = new Date();
  const releaseDate = parseDate(
    firstValue(
      detail?.release_date,
      detail?.first_air_date,
      assets?.release_date,
      assets?.first_air_date
    )
  );

  if (releaseDate && releaseDate.getTime() > today.getTime()) {
    return { kind: "upcoming", mark: "N", text: "Prossimamente" };
  }

  if (mediaType === "tv") {
    const availableSeason = Number(
      firstValue(
        hero?.availableSeason,
        detail?.availableSeason,
        detail?.available_season,
        assets?.availableSeason,
        assets?.available_season,
        0
      )
    );

    if (availableSeason > 0) {
      return {
        kind: "season",
        mark: "N",
        text: `Stagione ${availableSeason} disponibile`,
      };
    }

    if (detail?.next_episode_to_air) {
      return { kind: "episodes", mark: "N", text: "Nuovi episodi in arrivo" };
    }
  }

  return { kind: "available", mark: "▶", text: "Disponibile ora" };
}

function setBadge(callout: HTMLElement, badge: { kind: string; mark: string; text: string }) {
  callout.dataset.badgeKind = badge.kind;
  const mark = callout.querySelector('.netflix-home-callout-mark') as HTMLElement | null;
  if (mark && mark.textContent !== badge.mark) mark.textContent = badge.mark;

  const spans = Array.from(callout.querySelectorAll(':scope > span')) as HTMLElement[];
  const label = spans.find((span) => !span.classList.contains('netflix-home-callout-mark'));
  if (label && String(label.textContent || '').trim() !== badge.text) label.textContent = badge.text;
}

function restoreLegacyMetadata(hero: Element) {
  hero.querySelectorAll(`[${LEGACY_HIDDEN_ATTR}]`).forEach((element: HTMLElement) => {
    element.style.removeProperty('display');
    element.removeAttribute(LEGACY_HIDDEN_ATTR);
  });
}

function hideAdminBadgeFromMetadata(hero: Element, badgeText: string) {
  restoreLegacyMetadata(hero);
  const clean = String(badgeText || '').trim().toLocaleLowerCase();
  if (!clean) return;

  const attributes = Array.from(
    hero.querySelectorAll('.netflix-home-attributes .netflix-home-attribute')
  ) as HTMLElement[];

  const match = attributes.find(
    (element) => String(element.textContent || '').trim().toLocaleLowerCase() === clean
  );
  if (!match) return;

  match.style.setProperty('display', 'none', 'important');
  match.setAttribute(LEGACY_HIDDEN_ATTR, 'true');

  const previous = match.previousElementSibling as HTMLElement | null;
  if (previous?.classList.contains('netflix-home-attribute-dot')) {
    previous.style.setProperty('display', 'none', 'important');
    previous.setAttribute(LEGACY_HIDDEN_ATTR, 'true');
  }
}

function ensureFinalStyle() {
  let style = document.getElementById(FINAL_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = FINAL_STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== FINAL_HERO_CSS) style.textContent = FINAL_HERO_CSS;
}

function syncAmbient(hero: Element) {
  const home = hero.closest('[data-testid="home-page"]') as HTMLElement | null;
  const image = hero.querySelector('[data-testid="hero-backdrop"]') as HTMLImageElement | null;
  const src = String(image?.currentSrc || image?.src || '').trim();
  if (!home || !src) return;
  home.style.setProperty('--flixit-hero-ambient-image', `url(${JSON.stringify(src)})`);
  home.dataset.heroAmbient = 'ready';
}

/** Desktop Home Hero runtime behavior. */
export default function HomeHeroRuntimeFixes() {
  const location = useLocation();
  const isHome = location.pathname === "/" || location.pathname === "/browse";
  const { data: heroSettings } = useHeroData();
  const heroIdentity = `${heroSettings?.contentId || ""}:${heroSettings?.mediaType || ""}:${heroSettings?.updatedAt || ""}:${heroSettings?.seasonLabel || ""}`;
  const adminBadgeText = String(heroSettings?.seasonLabel || '').trim();

  useEffect(() => {
    if (!isHome || typeof window === "undefined" || window.innerWidth < 900) return;

    ensureFinalStyle();

    let raf = 0;
    let descriptionTimer = 0;
    let currentVideo: HTMLVideoElement | null = null;
    const badge = deriveBadge(heroSettings);

    const updatePlayingClass = () => {
      const hero = document.querySelector(HERO_SELECTOR);
      const video = document.querySelector(VIDEO_SELECTOR) as HTMLVideoElement | null;
      if (!hero) return;

      const actuallyPlaying = !!(
        video &&
        !video.paused &&
        !video.ended &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      );

      hero.classList.toggle('flixit-hero-video-playing', actuallyPlaying);
    };

    const videoEvents = ['playing', 'pause', 'ended', 'waiting', 'stalled', 'emptied', 'loadstart', 'error', 'loadedmetadata'];

    const bindVideo = () => {
      const video = document.querySelector(VIDEO_SELECTOR) as HTMLVideoElement | null;
      if (video === currentVideo) return;

      if (currentVideo) {
        videoEvents.forEach((event) => currentVideo?.removeEventListener(event, updatePlayingClass));
      }

      currentVideo = video;
      if (currentVideo) {
        videoEvents.forEach((event) => currentVideo?.addEventListener(event, updatePlayingClass, { passive: true }));
      }
      updatePlayingClass();
    };

    const syncBadge = (hero: Element) => {
      const callouts = Array.from(hero.querySelectorAll(CALLOUT_SELECTOR)) as HTMLElement[];
      if (!callouts.length) return;

      callouts.forEach((callout, index) => {
        if (index === 0) {
          callout.classList.remove('flixit-callout-hidden');
          setBadge(callout, badge);
        } else {
          callout.classList.add('flixit-callout-hidden');
        }
      });
    };

    const sync = () => {
      raf = 0;
      bindVideo();

      const hero = document.querySelector(HERO_SELECTOR);
      if (!hero) return;

      hideAdminBadgeFromMetadata(hero, adminBadgeText);
      syncBadge(hero);
      syncAmbient(hero);
    };

    const scheduleSync = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(sync);
    };

    sync();

    const hero = document.querySelector(HERO_SELECTOR);
    hero?.classList.remove('flixit-hero-copy-collapsed');
    descriptionTimer = window.setTimeout(() => {
      document.querySelector(HERO_SELECTOR)?.classList.add('flixit-hero-copy-collapsed');
    }, DESCRIPTION_HIDE_MS);

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    window.addEventListener('resize', scheduleSync, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleSync);
      if (raf) window.cancelAnimationFrame(raf);
      if (descriptionTimer) window.clearTimeout(descriptionTimer);

      if (currentVideo) {
        videoEvents.forEach((event) => currentVideo?.removeEventListener(event, updatePlayingClass));
      }

      const currentHero = document.querySelector(HERO_SELECTOR);
      if (currentHero) {
        currentHero.classList.remove('flixit-hero-video-playing', 'flixit-hero-copy-collapsed');
        restoreLegacyMetadata(currentHero);
        const fallback = currentHero.querySelector('[data-testid="hero-title-fallback"]') as HTMLElement | null;
        if (fallback) fallback.style.removeProperty('display');
      }

      const home = document.querySelector('[data-testid="home-page"]') as HTMLElement | null;
      if (home) {
        home.style.removeProperty('--flixit-hero-ambient-image');
        delete home.dataset.heroAmbient;
      }
    };
  }, [isHome, heroIdentity, adminBadgeText, heroSettings]);

  return null;
}
