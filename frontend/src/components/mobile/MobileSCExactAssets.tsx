// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";

const MOBILE_QUERY = "(max-width:899px)";
const CATALOG_URL = "/sc-artwork-catalog.json";
const CURRENT_SC_CDN_BASE = "https://cdn.streamingunity-premium.to/images/";
const LEGACY_SC_CDN_RE = /^https?:\/\/cdn\.streamingcommunityz\.ninja\/images\//i;

function normalize(value: any) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function assetKey(value: any) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const clean = raw.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1).replace(/\.(?:webp|jpe?g|png|avif)$/i, "").toLowerCase();
}

function normalizeCdnBase(value: any) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw) || LEGACY_SC_CDN_RE.test(`${raw.replace(/\/+$/, "")}/`)) {
    return CURRENT_SC_CDN_BASE;
  }
  return `${raw.replace(/\/+$/, "")}/`;
}

function absoluteAsset(value: any, cdnBase: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    return LEGACY_SC_CDN_RE.test(raw)
      ? raw.replace(LEGACY_SC_CDN_RE, CURRENT_SC_CDN_BASE)
      : raw;
  }
  return `${normalizeCdnBase(cdnBase)}${raw.replace(/^\/+/, "")}`;
}

type HeroAssets = { background: string; logo: string; title: string };
type HeroIndex = {
  byArtwork: Map<string, HeroAssets>;
  byTitle: Map<string, HeroAssets>;
};

function loadCatalogPayload() {
  const globalCache = globalThis as any;
  if (!globalCache.__flixitScCatalogPayloadPromise) {
    globalCache.__flixitScCatalogPayloadPromise = fetch(CATALOG_URL, {
      cache: "force-cache",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`SC catalog ${response.status}`);
      return response.json();
    });
  }
  return globalCache.__flixitScCatalogPayloadPromise;
}

let heroIndexPromise: Promise<HeroIndex> | null = null;

async function loadHeroIndex(): Promise<HeroIndex> {
  if (heroIndexPromise) return heroIndexPromise;

  heroIndexPromise = loadCatalogPayload()
    .then((payload) => {
      const rows = Array.isArray(payload?.titles) ? payload.titles : [];
      const cdnBase = normalizeCdnBase(payload?.cdn_base_url);
      const byArtwork = new Map<string, HeroAssets>();
      const byTitle = new Map<string, HeroAssets>();

      rows.forEach((row: any) => {
        const images = row?.images || {};
        const background = absoluteAsset(
          images.background || images.backdrop || images.hero_background || images.detail_background,
          cdnBase
        );
        const logo = absoluteAsset(images.logo || images.title_logo, cdnBase);
        if (!background && !logo) return;

        const title = String(row?.name || row?.title || row?.slug?.replace(/-/g, " ") || "");
        const record: HeroAssets = { background, logo, title };
        const titleKey = normalize(title);
        if (titleKey && !byTitle.has(titleKey)) byTitle.set(titleKey, record);

        [
          images.cover,
          images.cover_desktop,
          images.cover_mobile,
          images.card,
          images.poster,
          images.poster_mobile,
          images.background,
          images.backdrop,
          images.logo,
        ].forEach((asset) => {
          const key = assetKey(asset);
          if (key) byArtwork.set(key, record);
        });
      });

      return { byArtwork, byTitle };
    })
    .catch(() => ({ byArtwork: new Map(), byTitle: new Map() }));

  return heroIndexPromise;
}

function firstTitle(root: HTMLElement) {
  const logo = root.querySelector<HTMLImageElement>('[data-testid="hero-logo"]');
  const fallback = root.querySelector<HTMLElement>('[data-testid="hero-title"]');
  return logo?.alt || fallback?.textContent || "";
}

function chooseRecord(index: HeroIndex, root: HTMLElement, image?: HTMLImageElement | null) {
  const currentKey = assetKey(image?.currentSrc || image?.src || "");
  if (currentKey && index.byArtwork.has(currentKey)) return index.byArtwork.get(currentKey) || null;

  const title = firstTitle(root);
  const titleKey = normalize(title);
  if (titleKey && index.byTitle.has(titleKey)) return index.byTitle.get(titleKey) || null;
  return null;
}

function setImage(img: HTMLImageElement | null, url: string, priority = false) {
  if (!img || !url) return;
  if (img.src !== url) {
    img.removeAttribute("srcset");
    img.src = url;
  }
  if (priority) {
    img.loading = "eager";
    try { (img as any).fetchPriority = "high"; } catch {}
  }
}

function hydrateHomeHero(index: HeroIndex) {
  const root = document.querySelector<HTMLElement>('[data-testid="hero-section"]');
  if (!root) return;
  const backdrop = root.querySelector<HTMLImageElement>('[data-testid="hero-backdrop"]');
  const logo = root.querySelector<HTMLImageElement>('[data-testid="hero-logo"]');
  const record = chooseRecord(index, root, backdrop);
  if (!record) return;
  setImage(backdrop, record.background, true);
  setImage(logo, record.logo, true);
}

function hydrateHubHero(index: HeroIndex) {
  const root = document.querySelector<HTMLElement>('[data-testid="hub-hero"]');
  if (!root) return;
  const directImages = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  const backdrop = directImages[0] || null;
  const logo = directImages.find((img) => img !== backdrop && !!img.alt) || directImages[1] || null;
  const record = chooseRecord(index, root, backdrop);
  if (!record) return;
  setImage(backdrop, record.background, true);
  setImage(logo, record.logo, true);
}

function hydrateDetailHero(index: HeroIndex) {
  const root = document.querySelector<HTMLElement>('[data-testid="detail-page-redesign"]');
  if (!root) return;
  const hero = root.firstElementChild as HTMLElement | null;
  if (!hero) return;
  const images = Array.from(hero.querySelectorAll<HTMLImageElement>("img"));
  const backdrop = images[0] || null;
  const logo = images.find((img, idx) => idx > 0 && !!img.alt) || images[1] || null;
  const record = chooseRecord(index, root, backdrop);
  if (!record) return;
  setImage(backdrop, record.background, true);
  setImage(logo, record.logo, true);
}

function hydrate(index: HeroIndex) {
  hydrateHomeHero(index);
  hydrateHubHero(index);
  hydrateDetailHero(index);
}

export default function MobileSCExactAssets() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();

  useEffect(() => {
    if (!isMobile || location.pathname.startsWith("/watch")) return;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let raf = 0;
    const timers: number[] = [];

    loadHeroIndex().then((index) => {
      if (cancelled) return;

      const apply = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => hydrate(index));
      };

      apply();
      timers.push(window.setTimeout(apply, 180));
      timers.push(window.setTimeout(apply, 650));

      observer = new MutationObserver((records) => {
        if (records.some((record) => record.addedNodes.length > 0)) apply();
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach((timer) => window.clearTimeout(timer));
      observer?.disconnect();
    };
  }, [isMobile, location.pathname]);

  return null;
}
