// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useHeroData } from "src/hooks/useHeroData";

const HERO_SELECTOR = '[data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard';
const VIDEO_SELECTOR = '[data-testid="hero-trailer"] video';
const CALLOUT_SELECTOR = '.netflix-home-callouts .netflix-home-callout';
const LEGACY_HIDDEN_ATTR = 'data-legacy-hero-label-hidden';
const DESCRIPTION_HIDE_MS = 4000;
const RUNTIME_LOGO_ATTR = 'data-runtime-hero-logo';
const FINAL_STYLE_ID = 'flixit-home-hero-runtime-final';
const TMDB_API_KEY = process.env.REACT_APP_TMDB_V3_API_KEY || "4f153630f8d7e92d542dde3a38fbddf2";

const FINAL_HERO_CSS = String.raw`
@media (min-width: 900px) {
  [data-testid="home-page"] {
    position: relative !important;
    isolation: isolate !important;
    overflow-x: clip !important;
  }

  /* Content-aware Netflix-style ambient colour field. It reuses the exact
     backdrop selected/published from Admin, so every Hero automatically gets
     its own palette without a hard-coded colour table. */
  [data-testid="home-page"]::before {
    content: "" !important;
    position: absolute !important;
    top: 34px !important;
    left: -7vw !important;
    right: -7vw !important;
    height: min(930px, 64vw) !important;
    z-index: 0 !important;
    pointer-events: none !important;
    background-image: var(--flixit-hero-ambient-image, none) !important;
    background-size: cover !important;
    background-position: center 18% !important;
    background-repeat: no-repeat !important;
    filter: blur(76px) saturate(1.58) brightness(.67) !important;
    opacity: .50 !important;
    transform: scale(1.09) !important;
    transform-origin: center top !important;
    -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,.96) 0%, rgba(0,0,0,.88) 63%, rgba(0,0,0,.34) 83%, transparent 100%) !important;
    mask-image: linear-gradient(to bottom, rgba(0,0,0,.96) 0%, rgba(0,0,0,.88) 63%, rgba(0,0,0,.34) 83%, transparent 100%) !important;
    transition: background-image 650ms ease, opacity 450ms ease !important;
  }

  [data-testid="home-page"] > * {
    position: relative;
    z-index: 1;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard {
    z-index: 2 !important;
  }

  /* Do not crop standard 16:9 trailers inside the much wider billboard.
     Wide/cinematic trailers keep cover; narrower trailers switch to contain
     with the selected Hero backdrop softly filling the unused sides. */
  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard .netflix-home-video-layer video {
    object-position: center center !important;
    transform: none !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard.flixit-hero-trailer-contain .netflix-home-video-layer,
  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard.flixit-hero-trailer-contain [data-testid="trailer-player"] {
    background: transparent !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard.flixit-hero-trailer-contain .netflix-home-video-layer video {
    object-fit: contain !important;
    object-position: center center !important;
    background: transparent !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard.flixit-hero-video-playing.flixit-hero-trailer-contain [data-testid="hero-backdrop"] {
    opacity: .42 !important;
    filter: blur(13px) saturate(1.18) brightness(.65) !important;
    transform: scale(1.065) !important;
  }

  /* Restore the stronger Netflix title treatment requested by the user. */
  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard [data-testid="hero-logo"].netflix-home-logo {
    width: min(39vw, 680px) !important;
    max-width: min(39vw, 680px) !important;
    max-height: 270px !important;
    object-fit: contain !important;
    object-position: left bottom !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard .netflix-home-title-fallback {
    max-width: min(44vw, 760px) !important;
    font-size: clamp(58px, 5vw, 90px) !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard .netflix-home-attributes {
    font-size: 18px !important;
    line-height: 24px !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard [data-testid="hero-overview"].netflix-home-metadata,
  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard[data-compact="true"] [data-testid="hero-overview"].netflix-home-metadata {
    width: min(45vw, 790px) !important;
    height: 60px !important;
    max-height: 60px !important;
    font-size: 22px !important;
    line-height: 30px !important;
  }

  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard.flixit-hero-copy-collapsed [data-testid="hero-overview"].netflix-home-metadata,
  [data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard.flixit-hero-copy-collapsed[data-compact="true"] [data-testid="hero-overview"].netflix-home-metadata {
    height: 0 !important;
    max-height: 0 !important;
    margin-top: 0 !important;
    opacity: 0 !important;
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

function resolveArtworkUrl(value: any) {
  const raw = typeof value === "string" ? value : value?.url;
  const text = String(raw || "").trim();
  if (!text) return "";
  if (/^(?:https?:|data:|blob:)/i.test(text)) return text;
  if (text.startsWith("/")) return `https://image.tmdb.org/t/p/original${text}`;
  return text;
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
  /* Admin always wins. `seasonLabel` is the existing "Etichetta" field: from
     now on its exact text is the Hero badge text, not metadata. */
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

function ensureFinalStyle() {
  if (document.getElementById(FINAL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FINAL_STYLE_ID;
  style.textContent = FINAL_HERO_CSS;
  document.head.appendChild(style);
}

function syncAmbient(hero: Element) {
  const home = hero.closest('[data-testid="home-page"]') as HTMLElement | null;
  const image = hero.querySelector('[data-testid="hero-backdrop"]') as HTMLImageElement | null;
  const src = String(image?.currentSrc || image?.src || '').trim();
  if (!home || !src) return;
  home.style.setProperty('--flixit-hero-ambient-image', `url(${JSON.stringify(src)})`);
  home.dataset.heroAmbient = 'ready';
}

function installLogo(titleBlock: Element, src: string, title: string) {
  const resolved = resolveArtworkUrl(src);
  if (!resolved) return;

  let logo = titleBlock.querySelector(`[${RUNTIME_LOGO_ATTR}]`) as HTMLImageElement | null;
  if (!logo) {
    logo = document.createElement('img');
    logo.setAttribute(RUNTIME_LOGO_ATTR, 'true');
    logo.setAttribute('data-uia', 'billboard-logo');
    logo.setAttribute('data-testid', 'hero-logo');
    logo.className = 'netflix-home-logo';
    logo.alt = title || '';
    logo.decoding = 'async';
    titleBlock.insertBefore(logo, titleBlock.firstChild);
  }
  if (logo.src !== resolved) logo.src = resolved;

  const fallback = titleBlock.querySelector('[data-testid="hero-title-fallback"]') as HTMLElement | null;
  if (fallback) fallback.style.setProperty('display', 'none', 'important');
}

function immediateLogoCandidate(hero: any) {
  return firstValue(
    hero?.assets?.logo_path,
    hero?.assets?.fallback_logo_path,
    hero?.assets?.netflix_logo_url,
    hero?.logo_path,
    hero?.logo,
    hero?.detail?.logo_path,
    hero?.detail?.images?.logos?.[0]?.file_path
  );
}

async function fetchTmdbLogo(hero: any, signal: AbortSignal) {
  const id = Number(hero?.contentId || 0);
  if (!id) return '';
  const type = hero?.mediaType === 'movie' ? 'movie' : 'tv';
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/${type}/${id}/images?api_key=${TMDB_API_KEY}&include_image_language=it,en,null`,
      { signal }
    );
    if (!response.ok) return '';
    const data = await response.json();
    const logos = Array.isArray(data?.logos) ? data.logos.slice() : [];
    logos.sort((a: any, b: any) => {
      const rank = (entry: any) => entry?.iso_639_1 === 'it' ? 0 : entry?.iso_639_1 === 'en' ? 1 : 2;
      const localeDiff = rank(a) - rank(b);
      if (localeDiff) return localeDiff;
      return Number(b?.width || 0) - Number(a?.width || 0);
    });
    return logos[0]?.file_path ? `https://image.tmdb.org/t/p/original${logos[0].file_path}` : '';
  } catch {
    return '';
  }
}

/**
 * Desktop Home Hero runtime layer:
 * - exact Admin badge text via the existing Etichetta field;
 * - content-aware ambient colour glow from the published backdrop;
 * - logo recovery when the artwork pipeline has no usable logo at first paint;
 * - smart trailer fitting so standard 16:9 trailers are not vertically cut;
 * - Netflix-style synopsis collapse after four seconds.
 */
export default function HomeHeroRuntimeFixes() {
  const location = useLocation();
  const isHome = location.pathname === "/" || location.pathname === "/browse";
  const { data: heroSettings } = useHeroData();
  const heroIdentity = `${heroSettings?.contentId || ""}:${heroSettings?.mediaType || ""}:${heroSettings?.updatedAt || ""}:${heroSettings?.seasonLabel || ""}`;
  const legacyLabel = String(heroSettings?.seasonLabel || '').trim();

  useEffect(() => {
    if (!isHome || typeof window === "undefined" || window.innerWidth < 900) return;

    ensureFinalStyle();

    let currentVideo: HTMLVideoElement | null = null;
    let raf = 0;
    let descriptionTimer = 0;
    let logoRequestStarted = false;
    const logoAbort = new AbortController();
    const badge = deriveBadge(heroSettings);

    const updateVideoFit = () => {
      const hero = document.querySelector(HERO_SELECTOR) as HTMLElement | null;
      const video = document.querySelector(VIDEO_SELECTOR) as HTMLVideoElement | null;
      if (!hero || !video || !video.videoWidth || !video.videoHeight) return;

      const videoRatio = video.videoWidth / video.videoHeight;
      const heroRatio = hero.clientWidth > 0 && hero.clientHeight > 0
        ? hero.clientWidth / hero.clientHeight
        : 1505.14 / 690.429;

      /* 16:9 inside the ~2.18:1 billboard would lose a significant amount of
         picture with cover. Keep cinematic trailers full-bleed; preserve the
         whole frame for narrower sources. */
      const shouldContain = videoRatio < heroRatio * 0.92;
      hero.classList.toggle('flixit-hero-trailer-contain', shouldContain);
    };

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
      updateVideoFit();
    };

    const videoEvents = ["playing", "pause", "ended", "waiting", "stalled", "emptied", "loadstart", "error", "loadedmetadata"];

    const bindVideo = () => {
      const video = document.querySelector(VIDEO_SELECTOR) as HTMLVideoElement | null;
      if (video === currentVideo) {
        updateVideoFit();
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

    const syncLogo = (hero: Element) => {
      const titleBlock = hero.querySelector('.netflix-home-title-block');
      if (!titleBlock) return;

      const reactLogo = titleBlock.querySelector('[data-testid="hero-logo"]:not([' + RUNTIME_LOGO_ATTR + '])') as HTMLImageElement | null;
      if (reactLogo?.src) {
        reactLogo.style.removeProperty('display');
        return;
      }

      const immediate = immediateLogoCandidate(heroSettings);
      if (immediate) {
        installLogo(titleBlock, immediate, heroSettings?.customTitle || heroSettings?.detail?.name || heroSettings?.detail?.title || '');
        return;
      }

      if (logoRequestStarted) return;
      logoRequestStarted = true;
      fetchTmdbLogo(heroSettings, logoAbort.signal).then((url) => {
        if (!url || logoAbort.signal.aborted) return;
        const liveHero = document.querySelector(HERO_SELECTOR);
        const liveTitleBlock = liveHero?.querySelector('.netflix-home-title-block');
        if (liveTitleBlock) {
          installLogo(liveTitleBlock, url, heroSettings?.customTitle || heroSettings?.detail?.name || heroSettings?.detail?.title || '');
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
      syncAmbient(hero);
      syncLogo(hero);
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
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });

    window.addEventListener('resize', scheduleSync, { passive: true });

    return () => {
      logoAbort.abort();
      observer.disconnect();
      window.removeEventListener('resize', scheduleSync);
      if (raf) window.cancelAnimationFrame(raf);
      if (descriptionTimer) window.clearTimeout(descriptionTimer);
      if (currentVideo) {
        videoEvents.forEach((event) => currentVideo?.removeEventListener(event, updatePlayingClass));
      }
      const currentHero = document.querySelector(HERO_SELECTOR);
      if (currentHero) {
        currentHero.classList.remove(
          "flixit-hero-video-playing",
          "flixit-hero-copy-collapsed",
          "flixit-hero-trailer-contain"
        );
        restoreLegacyMetadata(currentHero);
        currentHero.querySelectorAll(`[${RUNTIME_LOGO_ATTR}]`).forEach((node) => node.remove());
        const fallback = currentHero.querySelector('[data-testid="hero-title-fallback"]') as HTMLElement | null;
        if (fallback) fallback.style.removeProperty('display');
      }
      const home = document.querySelector('[data-testid="home-page"]') as HTMLElement | null;
      if (home) {
        home.style.removeProperty('--flixit-hero-ambient-image');
        delete home.dataset.heroAmbient;
      }
    };
  }, [isHome, heroIdentity, legacyLabel, heroSettings]);

  return null;
}
