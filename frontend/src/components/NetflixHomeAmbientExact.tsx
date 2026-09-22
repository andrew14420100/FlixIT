// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const STYLE_ID = "flixit-netflix-home-ambient-exact";
const HERO_SELECTOR = '[data-testid="home-page"] [data-testid="hero-section"].netflix-home-billboard';
const BACKDROP_SELECTOR = '[data-testid="hero-backdrop"]';
const COLOR_CACHE = new Map<string, string>();

const AMBIENT_CSS = String.raw`
@media (min-width: 900px) {
  html,
  body,
  #root {
    background: #141414 !important;
  }

  body:has([data-testid="home-page"] .netflix-home-billboard) .flixit-route-stage {
    position: relative !important;
    isolation: isolate !important;
    padding-top: 80px !important;
    min-height: 100vh !important;
    background: #141414 !important;
  }

  body:has([data-testid="home-page"] .netflix-home-billboard) .flixit-route-stage::before {
    content: "" !important;
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    height: var(--flixit-netflix-ambient-height, 780px) !important;
    z-index: 0 !important;
    pointer-events: none !important;
    background-color: transparent !important;
    background-image: var(--flixit-netflix-ambient-bg, none) !important;
    background-position: 0 0 !important;
    background-repeat: no-repeat !important;
    background-size: 100% 100% !important;
    transition: background-image 400ms cubic-bezier(0,0,1,1) !important;
  }

  body:has([data-testid="home-page"] .netflix-home-billboard) .flixit-route-stage > * {
    position: relative !important;
    z-index: 1 !important;
  }

  body:has([data-testid="home-page"] .netflix-home-billboard) [data-testid="home-page"] {
    background: transparent !important;
    background-color: transparent !important;
  }

  body:has([data-testid="home-page"] .netflix-home-billboard) [data-testid="home-page"]::before {
    content: none !important;
    display: none !important;
    background: none !important;
    filter: none !important;
    opacity: 0 !important;
  }

  body:has([data-testid="home-page"] .netflix-home-billboard) [data-testid="main-header"] {
    height: 80px !important;
    min-height: 80px !important;
    padding-left: 60px !important;
    padding-right: 60px !important;
    background-color: transparent !important;
    background-image: linear-gradient(
      180deg,
      rgba(0,0,0,.8) 0%,
      rgba(0,0,0,0) 100%
    ) !important;
    box-shadow: none !important;
    border-bottom: 0 !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    overflow: visible !important;
    transition: background-color 400ms cubic-bezier(0,0,1,1) !important;
  }

  body:has([data-testid="home-page"] .netflix-home-billboard) [data-testid="main-header"] .MuiToolbar-root {
    height: 80px !important;
    min-height: 80px !important;
    overflow: visible !important;
  }

  body:has([data-testid="home-page"] .netflix-home-billboard) [data-testid="main-header"][data-flixit-netflix-scrolled="true"] {
    background-color: rgba(20,20,20,.96) !important;
    background-image: none !important;
  }
}
`;

function ensureStyle() {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== AMBIENT_CSS) style.textContent = AMBIENT_CSS;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(value: number) {
  return clampByte(value).toString(16).padStart(2, "0");
}

function darkNetflixTone(r: number, g: number, b: number) {
  const average = (r + g + b) / 3;
  r = r * .91 + average * .09;
  g = g * .91 + average * .09;
  b = b * .91 + average * .09;
  const peak = Math.max(r, g, b, 1);
  const scale = 72 / peak;
  return `#${toHex(r * scale)}${toHex(g * scale)}${toHex(b * scale)}`.toUpperCase();
}

function fallbackColor(seed: string) {
  const palette = [
    "#47211B", "#182B43", "#332047", "#1B4033",
    "#493415", "#421D2C", "#17383E", "#352948",
  ];
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return palette[Math.abs(hash) % palette.length];
}

function netflixGradient(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><defs><radialGradient id="g" cx="0" cy="0" r="0.5" gradientUnits="userSpaceOnUse" gradientTransform="translate(0.5, -0.5) scale(5, 5)"><stop offset="20.00%" stop-color="${color}"/><stop offset="65.00%" stop-color="rgba(0, 0, 0, 0)"/></radialGradient></defs><rect width="1" height="1" fill="url(#g)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

async function imageBitmapFromBlob(blob: Blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = objectUrl;
    if (img.decode) await img.decode();
    else await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    return img;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function dominantAmbientColor(src: string, signal: AbortSignal) {
  if (COLOR_CACHE.has(src)) return COLOR_CACHE.get(src)!;

  const response = await fetch(src, {
    signal,
    cache: "force-cache",
    mode: "cors",
    credentials: "omit",
  });
  if (!response.ok) throw new Error(`ambient HTTP ${response.status}`);

  const blob = await response.blob();
  const bitmap: any = await imageBitmapFromBlob(blob);
  const canvas = document.createElement("canvas");
  canvas.width = 40;
  canvas.height = 24;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("ambient canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap?.close?.();

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map<string, { weight: number; r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 180) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    if (hi < 42 || lo > 220) continue;
    const saturation = hi ? (hi - lo) / hi : 0;
    const brightness = hi / 255;
    const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
    const weight = (.72 + saturation * 2.2) * (.55 + Math.min(1, brightness * 1.35));
    const current = buckets.get(key) || { weight: 0, r: 0, g: 0, b: 0, n: 0 };
    current.weight += weight;
    current.r += r;
    current.g += g;
    current.b += b;
    current.n += 1;
    buckets.set(key, current);
  }

  const winner = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!winner?.n) throw new Error("ambient palette unavailable");
  const color = darkNetflixTone(winner.r / winner.n, winner.g / winner.n, winner.b / winner.n);
  COLOR_CACHE.set(src, color);
  return color;
}

function applyColor(color: string) {
  const root = document.documentElement;
  root.style.setProperty("--flixit-netflix-ambient-color", color);
  root.style.setProperty("--flixit-netflix-ambient-bg", netflixGradient(color));
}

function updateAmbientHeight(hero: HTMLElement | null) {
  const stage = document.querySelector(".flixit-route-stage") as HTMLElement | null;
  if (!hero || !stage) return;
  const heroRect = hero.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const bottomWithinStage = Math.max(80, heroRect.bottom - stageRect.top);
  document.documentElement.style.setProperty(
    "--flixit-netflix-ambient-height",
    `${Math.round(bottomWithinStage * 1000) / 1000}px`
  );
}

function updateHeaderState() {
  const header = document.querySelector('[data-testid="main-header"]') as HTMLElement | null;
  if (!header) return;
  header.dataset.flixitNetflixScrolled = window.scrollY > 12 ? "true" : "false";
}

export default function NetflixHomeAmbientExact() {
  const location = useLocation();
  const isHome = location.pathname === "/" || location.pathname === "/browse";

  useEffect(() => {
    if (!isHome || typeof window === "undefined" || window.innerWidth < 900) return;

    ensureStyle();
    const abort = new AbortController();
    let ambientRaf = 0;
    let scrollRaf = 0;
    let generation = 0;
    let lastSrc = "";
    let boundHero: HTMLElement | null = null;
    let heroObserver: MutationObserver | null = null;
    let waitObserver: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const syncAmbient = () => {
      ambientRaf = 0;
      updateAmbientHeight(boundHero);
      if (!boundHero) return;

      const image = boundHero.querySelector(BACKDROP_SELECTOR) as HTMLImageElement | null;
      const src = String(image?.currentSrc || image?.src || "").trim();
      if (!src || src === lastSrc) return;
      lastSrc = src;
      const myGeneration = ++generation;
      applyColor(fallbackColor(src));

      dominantAmbientColor(src, abort.signal)
        .then((color) => {
          if (!abort.signal.aborted && myGeneration === generation) applyColor(color);
        })
        .catch(() => {});
    };

    const scheduleAmbient = () => {
      if (!ambientRaf) ambientRaf = window.requestAnimationFrame(syncAmbient);
    };

    const bindHero = (hero: HTMLElement) => {
      if (boundHero === hero) return;
      boundHero = hero;
      waitObserver?.disconnect();
      heroObserver?.disconnect();
      resizeObserver?.disconnect();

      heroObserver = new MutationObserver(scheduleAmbient);
      heroObserver.observe(hero, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "srcset"],
      });

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleAmbient);
        resizeObserver.observe(hero);
      }
      scheduleAmbient();
    };

    const hero = document.querySelector(HERO_SELECTOR) as HTMLElement | null;
    if (hero) {
      bindHero(hero);
    } else {
      // Only use a document observer while waiting for the Hero to mount; it is
      // disconnected immediately afterwards so carousel DOM churn is ignored.
      waitObserver = new MutationObserver(() => {
        const nextHero = document.querySelector(HERO_SELECTOR) as HTMLElement | null;
        if (nextHero) bindHero(nextHero);
      });
      waitObserver.observe(document.body, { childList: true, subtree: true });
    }

    const onScroll = () => {
      if (scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = 0;
        updateHeaderState();
      });
    };
    updateHeaderState();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", scheduleAmbient, { passive: true });

    return () => {
      abort.abort();
      waitObserver?.disconnect();
      heroObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", scheduleAmbient);
      if (ambientRaf) window.cancelAnimationFrame(ambientRaf);
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf);

      const header = document.querySelector('[data-testid="main-header"]') as HTMLElement | null;
      if (header) delete header.dataset.flixitNetflixScrolled;
      const root = document.documentElement;
      root.style.removeProperty("--flixit-netflix-ambient-color");
      root.style.removeProperty("--flixit-netflix-ambient-bg");
      root.style.removeProperty("--flixit-netflix-ambient-height");
    };
  }, [isHome]);

  return null;
}
