// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useHeroData } from "src/hooks/useHeroData";

const HERO_SELECTOR = '[data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard';
const VIDEO_SELECTOR = '[data-testid="hero-trailer"] video';
const FIRST_CALLOUT_SELECTOR = '.netflix-home-callouts .netflix-home-callout:first-child';
const ADMIN_HIDDEN_ATTR = 'data-admin-availability-hidden';

function textNodeValue(element: Element) {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || "")
    .join("")
    .trim();
}

function replaceCalloutText(element: Element, text: string) {
  const clean = String(text || "").trim();
  if (!clean || textNodeValue(element) === clean) return;

  Array.from(element.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) node.remove();
  });
  element.appendChild(document.createTextNode(` ${clean}`));
}

function restoreAdminHiddenMetadata(hero: Element) {
  hero.querySelectorAll(`[${ADMIN_HIDDEN_ATTR}]`).forEach((element: HTMLElement) => {
    element.style.removeProperty("display");
    element.removeAttribute(ADMIN_HIDDEN_ATTR);
  });
}

function moveAvailabilityOutOfMetadata(hero: Element, label: string) {
  restoreAdminHiddenMetadata(hero);
  const clean = String(label || "").trim();
  if (!clean) return;

  const attributes = Array.from(
    hero.querySelectorAll('.netflix-home-attributes .netflix-home-attribute')
  ) as HTMLElement[];

  const match = attributes.find(
    (element) => String(element.textContent || "").trim().toLocaleLowerCase() === clean.toLocaleLowerCase()
  );
  if (!match) return;

  match.style.setProperty("display", "none", "important");
  match.setAttribute(ADMIN_HIDDEN_ATTR, "true");

  const previous = match.previousElementSibling as HTMLElement | null;
  if (previous?.classList.contains("netflix-home-attribute-dot")) {
    previous.style.setProperty("display", "none", "important");
    previous.setAttribute(ADMIN_HIDDEN_ATTR, "true");
  }
}

/**
 * Desktop Home-only runtime guard for the billboard.
 *
 * 1) Keeps the static artwork visible until the trailer really reaches the
 *    HTMLMediaElement `playing` state. This prevents an empty/black Hero while
 *    HLS is still attaching, buffering or retrying.
 * 2) Mirrors the Admin Hero `seasonLabel` field into the primary lower-right
 *    availability badge (e.g. "Disponibile ora" / "Stagione 3 disponibile").
 *    The same label is removed from the metadata row so it is not duplicated.
 */
export default function HomeHeroRuntimeFixes() {
  const location = useLocation();
  const isHome = location.pathname === "/" || location.pathname === "/browse";
  const { data: heroSettings } = useHeroData();
  const availabilityLabel = String(heroSettings?.seasonLabel || "").trim();

  useEffect(() => {
    if (!isHome || typeof window === "undefined" || window.innerWidth < 900) return;

    let currentVideo: HTMLVideoElement | null = null;
    let raf = 0;

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

    const sync = () => {
      raf = 0;
      bindVideo();

      const hero = document.querySelector(HERO_SELECTOR);
      if (!hero) return;

      moveAvailabilityOutOfMetadata(hero, availabilityLabel);

      if (availabilityLabel) {
        const callout = hero.querySelector(FIRST_CALLOUT_SELECTOR);
        if (callout) replaceCalloutText(callout, availabilityLabel);
      }
    };

    const scheduleSync = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(sync);
    };

    sync();
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      if (currentVideo) {
        ["playing", "pause", "ended", "waiting", "stalled", "emptied", "loadstart", "error"].forEach((event) =>
          currentVideo?.removeEventListener(event, updatePlayingClass)
        );
      }
      const hero = document.querySelector(HERO_SELECTOR);
      if (hero) {
        hero.classList.remove("flixit-hero-video-playing");
        restoreAdminHiddenMetadata(hero);
      }
    };
  }, [isHome, availabilityLabel]);

  return null;
}
