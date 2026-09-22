// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useHeroData } from "src/hooks/useHeroData";

const HERO_SELECTOR = '[data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard';
const VIDEO_SELECTOR = '[data-testid="hero-trailer"] video';
const CALLOUT_SELECTOR = '.netflix-home-callouts .netflix-home-callout';
const LEGACY_HIDDEN_ATTR = 'data-legacy-hero-label-hidden';
const DESCRIPTION_HIDE_MS = 4000;

function firstValue(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function parseDate(value: any) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deriveBadge(hero: any) {
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
    firstValue(detail?.release_date, detail?.first_air_date, assets?.release_date)
  );

  if (releaseDate && releaseDate.getTime() > today.getTime()) {
    return {
      kind: "upcoming",
      mark: "N",
      text: "Prossimamente",
    };
  }

  if (mediaType === "tv") {
    const nextEpisode = detail?.next_episode_to_air;
    const status = String(detail?.status || "").toLowerCase();

    if (nextEpisode) {
      return {
        kind: "episodes",
        mark: "N",
        text: "Nuovi episodi in arrivo",
      };
    }

    if (
      status.includes("returning") ||
      status.includes("production") ||
      status.includes("planned")
    ) {
      return {
        kind: "episodes",
        mark: "N",
        text: "Nuovi episodi",
      };
    }
  }

  return {
    kind: "available",
    mark: "▶",
    text: "Disponibile ora",
  };
}

function setBadge(callout: HTMLElement, badge: { kind: string; mark: string; text: string }) {
  if (callout.dataset.badgeKind !== badge.kind) {
    callout.dataset.badgeKind = badge.kind;
  }

  const mark = callout.querySelector('.netflix-home-callout-mark') as HTMLElement | null;
  if (mark && mark.textContent !== badge.mark) mark.textContent = badge.mark;

  const spans = Array.from(callout.querySelectorAll(':scope > span')) as HTMLElement[];
  const label = spans.find((span) => !span.classList.contains('netflix-home-callout-mark'));
  if (label && String(label.textContent || '').trim() !== badge.text) {
    label.textContent = badge.text;
  }
}

function restoreLegacyMetadata(hero: Element) {
  hero.querySelectorAll(`[${LEGACY_HIDDEN_ATTR}]`).forEach((element: HTMLElement) => {
    element.style.removeProperty('display');
    element.removeAttribute(LEGACY_HIDDEN_ATTR);
  });
}

function hideLegacyAdminLabel(hero: Element, legacyLabel: string) {
  restoreLegacyMetadata(hero);
  const clean = String(legacyLabel || '').trim().toLocaleLowerCase();
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
 * Desktop Home-only runtime behavior for the billboard.
 *
 * - The static artwork remains visible until the trailer is genuinely playing.
 * - The lower-right badge is derived from the content selected in Admin instead
 *   of the legacy manual "Etichetta" field.
 * - Exactly four seconds after a new Hero is mounted, the synopsis collapses
 *   with the same fade/height choreography used by the desktop billboard.
 */
export default function HomeHeroRuntimeFixes() {
  const location = useLocation();
  const isHome = location.pathname === "/" || location.pathname === "/browse";
  const { data: heroSettings } = useHeroData();
  const heroIdentity = `${heroSettings?.contentId || ""}:${heroSettings?.mediaType || ""}:${heroSettings?.updatedAt || ""}`;
  const legacyLabel = String(heroSettings?.seasonLabel || '').trim();

  useEffect(() => {
    if (!isHome || typeof window === "undefined" || window.innerWidth < 900) return;

    let currentVideo: HTMLVideoElement | null = null;
    let raf = 0;
    let descriptionTimer = 0;
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

      hero.classList.toggle("flixit-hero-video-playing", actuallyPlaying);
    };

    const bindVideo = () => {
      const video = document.querySelector(VIDEO_SELECTOR) as HTMLVideoElement | null;
      if (video === currentVideo) return;

      if (currentVideo) {
        ["playing", "pause", "ended", "waiting", "stalled", "emptied", "loadstart", "error"].forEach((event) =>
          currentVideo?.removeEventListener(event, updatePlayingClass)
        );
      }

      currentVideo = video;
      if (currentVideo) {
        ["playing", "pause", "ended", "waiting", "stalled", "emptied", "loadstart", "error"].forEach((event) =>
          currentVideo?.addEventListener(event, updatePlayingClass, { passive: true })
        );
      }
      updatePlayingClass();
    };

    const syncBadge = (hero: Element) => {
      const callouts = Array.from(hero.querySelectorAll(CALLOUT_SELECTOR)) as HTMLElement[];
      if (!callouts.length) return;

      callouts.forEach((callout, index) => {
        if (index === 0) {
          callout.classList.remove("flixit-callout-hidden");
          setBadge(callout, badge);
        } else {
          callout.classList.add("flixit-callout-hidden");
        }
      });
    };

    const sync = () => {
      raf = 0;
      bindVideo();

      const hero = document.querySelector(HERO_SELECTOR);
      if (!hero) return;
      hideLegacyAdminLabel(hero, legacyLabel);
      syncBadge(hero);
    };

    const scheduleSync = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(sync);
    };

    sync();

    const hero = document.querySelector(HERO_SELECTOR);
    hero?.classList.remove("flixit-hero-copy-collapsed");
    descriptionTimer = window.setTimeout(() => {
      document.querySelector(HERO_SELECTOR)?.classList.add("flixit-hero-copy-collapsed");
    }, DESCRIPTION_HIDE_MS);

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      if (descriptionTimer) window.clearTimeout(descriptionTimer);
      if (currentVideo) {
        ["playing", "pause", "ended", "waiting", "stalled", "emptied", "loadstart", "error"].forEach((event) =>
          currentVideo?.removeEventListener(event, updatePlayingClass)
        );
      }
      const currentHero = document.querySelector(HERO_SELECTOR);
      if (currentHero) {
        currentHero.classList.remove("flixit-hero-video-playing", "flixit-hero-copy-collapsed");
        restoreLegacyMetadata(currentHero);
      }
    };
  }, [isHome, heroIdentity, legacyLabel]);

  return null;
}
