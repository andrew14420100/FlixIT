// @ts-nocheck
import { useEffect } from "react";

const STYLE_ID = "flixit-detail-ambient-exact";
const HERO_SELECTOR = '[data-testid="detail-page"] [data-testid="detail-hero"].netflix-home-billboard';
const BACKDROP_SELECTOR = '[data-testid="detail-hero-backdrop"]';
const COLOR_CACHE = new Map<string, string>();

const DETAIL_AMBIENT_CSS = String.raw`
@media (min-width: 900px) {
  body:has([data-testid="detail-page"] [data-testid="detail-hero"].netflix-home-billboard) .flixit-route-stage {
    position: relative !important;
    isolation: isolate !important;
    min-height: 100vh !important;
    background: #030c16 !important;
  }

  body:has([data-testid="detail-page"] [data-testid="detail-hero"].netflix-home-billboard) .flixit-route-stage::before {
    content: "" !important;
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    height: var(--flixit-detail-ambient-height, 760px) !important;
    z-index: 0 !important;
    pointer-events: none !important;
    background-color: transparent !important;
    background-image: var(--flixit-detail-ambient-bg, none) !important;
    background-position: 0 0 !important;
    background-repeat: no-repeat !important;
    background-size: 100% 100% !important;
    transition: background-image 400ms cubic-bezier(0,0,1,1) !important;
  }

  body:has([data-testid="detail-page"] [data-testid="detail-hero"].netflix-home-billboard) .flixit-route-stage > * {
    position: relative !important;
    z-index: 1 !important;
  }

  body:has([data-testid="detail-page"] [data-testid="detail-hero"].netflix-home-billboard) [data-testid="detail-page"] {
    background: transparent !important;
    background-color: transparent !important;
  }

  body:has([data-testid="detail-page"] [data-testid="detail-hero"].netflix-home-billboard) [data-testid="main-header"] {
    height: 80px !important;
    min-height: 80px !important;
    padding-left: 60px !important;
    padding-right: 60px !important;
    background-color: transparent !important;
    background-image: linear-gradient(
      180deg,
      rgba(0,0,0,.8) 0%,
      rgba(0,0,0,.38) 48%,
      rgba(0,0,0,0) 100%
    ) !important;
    box-shadow: none !important;
    border-bottom: 0 !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    overflow: visible !important;
  }

  body:has([data-testid="detail-page"] [data-testid="detail-hero"].netflix-home-billboard) [data-testid="main-header"] .MuiToolbar-root {
    height: 80px !important;
    min-height: 80px !important;
    overflow: visible !important;
  }

  body:has([data-testid="detail-page"] [data-testid="detail-hero"].netflix-home-billboard) [data-testid="detail-hero"].netflix-home-billboard {
    margin-top: 10px !important;
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
  if (style.textContent !== DETAIL_AMBIENT_CSS) style.textContent = DETAIL_AMBIENT_CSS;
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

function detailGradient(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><defs><radialGradient id="g" cx="0" cy="0" r="0.5" gradientUnits="userSpaceOnUse" gradientTransform="translate(0.5, -0.5) scale(5, 5)"><stop offset="20.00%" stop-color="${color}"/><stop offset="65.00%" stop-color="rgba(0, 0, 0, 0)"/></radialGradient></defs><rect width="1" height="1" fill="url(#g)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

async function sampleDominantColor(src: string, signal: AbortSignal) {
  if (COLOR_CACHE.has(src)) return COLOR_CACHE.get(src)!;

  const response = await fetch(src, {
    signal,
    cache: "force-cache",
    mode: "cors",
    credentials: "omit",
  });
  if (!response.ok) throw new Error(`ambient HTTP ${response.status}`);

  const blob = await response.blob();
  const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(blob) : null;
  if (!bitmap) throw new Error("ambient bitmap unavailable");

  const canvas = document.createElement("canvas");
  canvas.width = 40;
  canvas.height = 24;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("ambient canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

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

  const color = darkNetflixTone(
    winner.r / winner.n,
    winner.g / winner.n,
    winner.b / winner.n
  );
  COLOR_CACHE.set(src, color);
  return color;
}

function applyColor(color: string) {
  document.documentElement.style.setProperty("--flixit-detail-ambient-color", color);
  document.documentElement.style.setProperty("--flixit-detail-ambient-bg", detailGradient(color));
}

function updateAmbientHeight(hero: HTMLElement | null) {
  const stage = document.querySelector(".flixit-route-stage") as HTMLElement | null;
  if (!hero || !stage) return;
  const heroRect = hero.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const bottomWithinStage = Math.max(80, heroRect.bottom - stageRect.top);
  document.documentElement.style.setProperty(
    "--flixit-detail-ambient-height",
    `${Math.round(bottomWithinStage * 1000) / 1000}px`
  );
}

export default function DetailAmbientExact() {
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth < 900) return;

    ensureStyle();
    const abort = new AbortController();
    let resizeRaf = 0;
    let observer: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const bind = () => {
      const hero = document.querySelector(HERO_SELECTOR) as HTMLElement | null;
      if (!hero) return false;

      const sync = () => {
        updateAmbientHeight(hero);
        const image = hero.querySelector(BACKDROP_SELECTOR) as HTMLImageElement | null;
        const src = String(image?.currentSrc || image?.src || "").trim();
        if (!src) return;

        applyColor(COLOR_CACHE.get(src) || fallbackColor(src));
        if (!COLOR_CACHE.has(src)) {
          sampleDominantColor(src, abort.signal)
            .then((color) => {
              if (!abort.signal.aborted) applyColor(color);
            })
            .catch(() => {});
        }
      };

      sync();
      observer = new MutationObserver(sync);
      observer.observe(hero, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "srcset"],
      });

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(sync);
        resizeObserver.observe(hero);
      }
      return true;
    };

    if (!bind()) {
      const waitObserver = new MutationObserver(() => {
        if (bind()) waitObserver.disconnect();
      });
      waitObserver.observe(document.body, { childList: true, subtree: true });
      observer = waitObserver;
    }

    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = 0;
        const hero = document.querySelector(HERO_SELECTOR) as HTMLElement | null;
        updateAmbientHeight(hero);
      });
    };
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      abort.abort();
      observer?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      if (resizeRaf) window.cancelAnimationFrame(resizeRaf);
      const root = document.documentElement;
      root.style.removeProperty("--flixit-detail-ambient-color");
      root.style.removeProperty("--flixit-detail-ambient-bg");
      root.style.removeProperty("--flixit-detail-ambient-height");
    };
  }, []);

  return null;
}
