// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import "./HomeHeroRuntimeFixes.css";

const HERO_SELECTOR = '[data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard';
const VIDEO_SELECTOR = '[data-testid="hero-trailer"] video';
const CALLOUT_SELECTOR = '.netflix-home-callouts .netflix-home-callout';
const LEGACY_HIDDEN_ATTR = 'data-legacy-hero-label-hidden';
const DESCRIPTION_HIDE_MS = 4000;

function currentHero() {
  if (typeof window === "undefined") return null;
  return (window as any).__flixitHomeHero || null;
}

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

function deriveBadge(hero: any, fallbackText = "") {
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

  const releaseDate = parseDate(
    firstValue(
      detail?.release_date,
      detail?.first_air_date,
      assets?.release_date,
      assets?.first_air_date
    )
  );
  if (releaseDate && releaseDate.getTime() > Date.now()) {
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

  const cleanFallback = String(fallbackText || "").trim();
  if (cleanFallback) {
    const kind = badgeKindFromText(cleanFallback);
    return { kind, mark: badgeMark(kind), text: cleanFallback };
  }
  return { kind: "available", mark: "▶", text: "Disponibile ora" };
}

function setBadge(callout: HTMLElement, badge: { kind: string; mark: string; text: string }) {
  if (callout.dataset.badgeKind !== badge.kind) callout.dataset.badgeKind = badge.kind;
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

/**
 * Presentation-only desktop Hero runtime. It consumes the Hero already embedded
 * in Home bootstrap and never opens a second /api/public/hero request.
 *
 * The older version watched src/srcset attributes and rescanned the whole Hero on
 * every media mutation. The Hero's React state already owns media selection, so
 * this helper now reacts only to structural/text changes and video events.
 */
export default function HomeHeroRuntimeFixes() {
  const location = useLocation();
  const isHome = location.pathname === "/" || location.pathname === "/browse";

  useEffect(() => {
    if (!isHome || typeof window === "undefined" || window.innerWidth < 900) return;

    const videoEvents = ['playing', 'pause', 'ended', 'waiting', 'stalled', 'emptied', 'loadstart', 'error'];
    let descriptionTimer = 0;
    let currentVideo: HTMLVideoElement | null = null;
    let heroObserver: MutationObserver | null = null;
    let waitObserver: MutationObserver | null = null;
    let boundHero: HTMLElement | null = null;
    let syncing = false;

    const updatePlayingClass = () => {
      if (!boundHero) return;
      const actuallyPlaying = !!(
        currentVideo &&
        !currentVideo.paused &&
        !currentVideo.ended &&
        currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      );
      boundHero.classList.toggle('flixit-hero-video-playing', actuallyPlaying);
    };

    const bindVideo = () => {
      if (!boundHero) return;
      const video = boundHero.querySelector(VIDEO_SELECTOR) as HTMLVideoElement | null;
      if (video === currentVideo) {
        updatePlayingClass();
        return;
      }

      if (currentVideo) {
        videoEvents.forEach((event) => currentVideo?.removeEventListener(event, updatePlayingClass));
      }
      currentVideo = video;
      if (currentVideo) {
        videoEvents.forEach((event) => currentVideo?.addEventListener(event, updatePlayingClass, { passive: true }));
      }
      updatePlayingClass();
    };

    const syncPresentation = () => {
      if (!boundHero || syncing) return;
      syncing = true;
      try {
        bindVideo();
        const heroSettings = currentHero();
        hideAdminBadgeFromMetadata(boundHero, String(heroSettings?.seasonLabel || ''));
        const callouts = Array.from(boundHero.querySelectorAll(CALLOUT_SELECTOR)) as HTMLElement[];
        const firstLabel = callouts[0]?.querySelector(':scope > span:not(.netflix-home-callout-mark)')?.textContent || '';
        const badge = deriveBadge(heroSettings, firstLabel);
        callouts.forEach((callout, index) => {
          if (index === 0) {
            callout.classList.remove('flixit-callout-hidden');
            setBadge(callout, badge);
          } else {
            callout.classList.add('flixit-callout-hidden');
          }
        });
      } finally {
        syncing = false;
      }
    };

    const bindHero = (hero: HTMLElement) => {
      if (boundHero === hero) return;
      boundHero = hero;
      waitObserver?.disconnect();
      heroObserver?.disconnect();
      syncPresentation();

      hero.classList.remove('flixit-hero-copy-collapsed');
      if (descriptionTimer) window.clearTimeout(descriptionTimer);
      descriptionTimer = window.setTimeout(() => {
        boundHero?.classList.add('flixit-hero-copy-collapsed');
      }, DESCRIPTION_HIDE_MS);

      // React may mount/unmount the trailer after the Hero itself is present and
      // can replace callout text after a bootstrap refresh. Observe only those
      // structural/text changes; media attribute churn is intentionally ignored.
      heroObserver = new MutationObserver(syncPresentation);
      heroObserver.observe(hero, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };

    const initialHero = document.querySelector(HERO_SELECTOR) as HTMLElement | null;
    if (initialHero) {
      bindHero(initialHero);
    } else {
      waitObserver = new MutationObserver(() => {
        const hero = document.querySelector(HERO_SELECTOR) as HTMLElement | null;
        if (hero) bindHero(hero);
      });
      waitObserver.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      waitObserver?.disconnect();
      heroObserver?.disconnect();
      if (descriptionTimer) window.clearTimeout(descriptionTimer);
      if (currentVideo) {
        videoEvents.forEach((event) => currentVideo?.removeEventListener(event, updatePlayingClass));
      }
      if (boundHero) {
        boundHero.classList.remove('flixit-hero-video-playing', 'flixit-hero-copy-collapsed');
        restoreLegacyMetadata(boundHero);
      }
    };
  }, [isHome]);

  return null;
}
