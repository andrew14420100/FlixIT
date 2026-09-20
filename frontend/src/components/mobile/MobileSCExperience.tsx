// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import MovieCreationOutlinedIcon from "@mui/icons-material/MovieCreationOutlined";
import LiveTvOutlinedIcon from "@mui/icons-material/LiveTvOutlined";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import LocalMoviesOutlinedIcon from "@mui/icons-material/LocalMoviesOutlined";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import UpcomingOutlinedIcon from "@mui/icons-material/UpcomingOutlined";
import BookmarkBorderRoundedIcon from "@mui/icons-material/BookmarkBorderRounded";
import AccountCircleOutlinedIcon from "@mui/icons-material/AccountCircleOutlined";

const MOBILE_QUERY = "(max-width:899px)";
const CATALOG_URL = "/sc-artwork-catalog.json";

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
  return clean
    .slice(clean.lastIndexOf("/") + 1)
    .replace(/\.(?:webp|jpe?g|png|avif)$/i, "")
    .toLowerCase();
}

function absoluteAsset(value: any, cdnBase: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${cdnBase.replace(/\/+$/, "")}/${raw.replace(/^\/+/, "")}`;
}

function normalizeType(value: any) {
  const raw = String(value || "").toLowerCase();
  return raw === "tv" || raw.includes("serie") || raw.includes("show") ? "tv" : "movie";
}

type PosterBucket = { movie?: string; tv?: string; any?: string };
type PosterIndex = {
  byArtwork: Map<string, string>;
  byTitle: Map<string, PosterBucket>;
  byTmdb: Map<string, string>;
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

let posterIndexPromise: Promise<PosterIndex> | null = null;

async function loadPosterIndex(): Promise<PosterIndex> {
  if (posterIndexPromise) return posterIndexPromise;

  posterIndexPromise = loadCatalogPayload()
    .then((payload) => {
      const rows = Array.isArray(payload?.titles) ? payload.titles : [];
      const cdnBase = String(payload?.cdn_base_url || "https://cdn.streamingunity.win/images/");
      const byArtwork = new Map<string, string>();
      const byTitle = new Map<string, PosterBucket>();
      const byTmdb = new Map<string, string>();

      rows.forEach((row: any) => {
        const images = row?.images || {};
        const poster = absoluteAsset(images.poster || images.poster_mobile, cdnBase);
        if (!poster) return;

        [
          images.cover,
          images.cover_desktop,
          images.card,
          images.cover_mobile,
          images.background,
          images.backdrop,
          images.hero_background,
          images.detail_background,
          images.poster,
          images.poster_mobile,
        ].forEach((asset) => {
          const key = assetKey(asset);
          if (key) byArtwork.set(key, poster);
        });

        const type = normalizeType(row?.type);
        const tmdbId = Number(
          row?.tmdb_id || row?.tmdbId || row?.ids?.tmdbId || row?.ids?.tmdb_id || 0
        );
        if (tmdbId) byTmdb.set(`${type}:${tmdbId}`, poster);

        [
          row?.name,
          row?.title,
          row?.original_title,
          row?.original_name,
          row?.slug?.replace(/-/g, " "),
        ].forEach((alias) => {
          const titleKey = normalize(alias);
          if (!titleKey) return;
          const bucket = byTitle.get(titleKey) || {};
          if (!bucket[type]) bucket[type] = poster;
          if (!bucket.any) bucket.any = poster;
          byTitle.set(titleKey, bucket);
        });
      });

      return { byArtwork, byTitle, byTmdb };
    })
    .catch(() => ({
      byArtwork: new Map(),
      byTitle: new Map(),
      byTmdb: new Map(),
    }));

  return posterIndexPromise;
}

function titlePoster(index: PosterIndex, title: string, type?: string | null) {
  const bucket = index.byTitle.get(normalize(title));
  if (!bucket) return "";
  if (type === "tv") return bucket.tv || bucket.any || "";
  if (type === "movie") return bucket.movie || bucket.any || "";
  return bucket.any || bucket.movie || bucket.tv || "";
}

function routeIdentity(href: string) {
  const match = String(href || "").match(/\/browse\/(movie|tv)\/(\d+)/i);
  return match ? { type: match[1].toLowerCase(), id: Number(match[2]) } : null;
}

function setPoster(root: HTMLElement, img: HTMLImageElement, poster: string) {
  root.classList.add("flixit-mobile-poster");
  root.classList.remove("flixit-mobile-no-poster");
  root.closest(".slick-slide")?.classList.remove("flixit-mobile-no-poster-slide");
  img.removeAttribute("srcset");
  if (img.src !== poster) img.src = poster;
}

function markMissingHomePoster(root: HTMLElement) {
  if (!root.closest('[data-testid="home-page"]')) return;
  root.classList.add("flixit-mobile-no-poster");
  root.closest(".slick-slide")?.classList.add("flixit-mobile-no-poster-slide");
}

function scopedElements(scope: ParentNode, selector: string) {
  const nodes: HTMLElement[] = [];
  const element = scope as HTMLElement;
  if (element?.matches?.(selector)) nodes.push(element);
  scope.querySelectorAll?.(selector).forEach((node: any) => nodes.push(node));
  return nodes;
}

function hydrateMobilePosters(index: PosterIndex, scope: ParentNode = document) {
  scopedElements(scope, ".netflix-standard-card-root").forEach((root) => {
    const link = root.querySelector<HTMLAnchorElement>('a[data-uia="standard-card"]');
    const img = root.querySelector<HTMLImageElement>("img.netflix-standard-card-image");
    if (!link || !img) return;

    const identity = routeIdentity(link.getAttribute("href") || "");
    const poster =
      (identity ? index.byTmdb.get(`${identity.type}:${identity.id}`) : "") ||
      index.byArtwork.get(assetKey(img.currentSrc || img.src)) ||
      titlePoster(index, link.getAttribute("aria-label") || "", identity?.type || null);

    if (!poster) {
      markMissingHomePoster(root);
      return;
    }
    setPoster(root, img, poster);
  });

  scopedElements(scope, '[data-testid^="horizontal-card-"]').forEach((root) => {
    const img = root.querySelector<HTMLImageElement>("img");
    if (!img) return;
    const id = Number((root.getAttribute("data-testid") || "").replace("horizontal-card-", ""));
    const poster =
      index.byTmdb.get(`movie:${id}`) ||
      index.byTmdb.get(`tv:${id}`) ||
      index.byArtwork.get(assetKey(img.currentSrc || img.src)) ||
      titlePoster(index, img.alt || "");
    if (!poster) return;
    root.classList.add("flixit-mobile-list-poster");
    img.removeAttribute("srcset");
    if (img.src !== poster) img.src = poster;
  });

  scopedElements(scope, '[data-testid^="account-item-"]').forEach((root) => {
    const img = root.querySelector<HTMLImageElement>("img");
    const id = Number((root.getAttribute("data-testid") || "").replace("account-item-", ""));
    if (!img || !id) return;
    const poster =
      index.byTmdb.get(`movie:${id}`) ||
      index.byTmdb.get(`tv:${id}`) ||
      titlePoster(index, img.alt || "");
    if (poster && img.src !== poster) img.src = poster;
  });

  scopedElements(scope, '[data-testid^="search-result-"]').forEach((row) => {
    const img = row.querySelector<HTMLImageElement>("img");
    const titleNode = row.querySelector<HTMLElement>(".MuiTypography-root");
    const id = Number((row.getAttribute("data-testid") || "").replace("search-result-", ""));
    if (!img || !titleNode) return;
    const allText = row.textContent || "";
    const type = /Serie TV/i.test(allText) ? "tv" : /Film/i.test(allText) ? "movie" : null;
    const poster =
      (id && type ? index.byTmdb.get(`${type}:${id}`) : "") ||
      titlePoster(index, titleNode.textContent || "", type);
    if (poster && img.src !== poster) img.src = poster;
  });
}

function isActivePath(pathname: string, path: string) {
  if (path === "/browse") return pathname === "/" || pathname === "/browse";
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function MobileSCExperience() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const navigate = useNavigate();
  const isWatch = location.pathname.startsWith("/watch");
  const isHome = location.pathname === "/" || location.pathname === "/browse";
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (!isMobile) {
      root.classList.remove("flixit-mobile-sc", "flixit-home-reference");
      return;
    }
    root.classList.add("flixit-mobile-sc");
    root.classList.toggle("flixit-home-reference", isHome);
    return () => root.classList.remove("flixit-mobile-sc", "flixit-home-reference");
  }, [isMobile, isHome]);

  useEffect(() => {
    if (!isMobile) return;
    ["https://cdn.streamingunity.win", "https://cdn.streamingunity-premium.to"].forEach((href) => {
      if (document.head.querySelector(`link[data-flixit-preconnect="${href}"]`)) return;
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = href;
      link.crossOrigin = "anonymous";
      link.dataset.flixitPreconnect = href;
      document.head.appendChild(link);
    });
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let raf = 0;
    const pending = new Set<ParentNode>();

    loadPosterIndex().then((index) => {
      if (cancelled) return;

      const flush = () => {
        raf = 0;
        const scopes = Array.from(pending);
        pending.clear();
        if (scopes.length === 0) scopes.push(document);
        scopes.forEach((scope) => hydrateMobilePosters(index, scope));
      };

      const schedule = (scope: ParentNode = document) => {
        pending.add(scope);
        if (raf) return;
        raf = requestAnimationFrame(flush);
      };

      schedule(document);
      observer = new MutationObserver((records) => {
        records.forEach((record) => {
          record.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) schedule(node as HTMLElement);
          });
        });
      });
      observer.observe(document.body, { subtree: true, childList: true });
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      pending.clear();
    };
  }, [isMobile, location.pathname]);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const drawerItems = useMemo(
    () => [
      { label: "Home", path: "/browse", icon: HomeRoundedIcon },
      { label: "Serie TV", path: "/serie", icon: LiveTvOutlinedIcon },
      { label: "Cinema", path: "/cinema", icon: GridViewRoundedIcon },
      { label: "Catalogo", path: "/archivio", icon: CategoryOutlinedIcon },
      { label: "Prime Visioni", path: "/p/prime-visioni", icon: LocalMoviesOutlinedIcon },
      { label: "Cinema d'Autore", path: "/p/cinema-d-autore", icon: MovieCreationOutlinedIcon },
      { label: "In arrivo", path: "/in-arrivo", icon: UpcomingOutlinedIcon },
      { label: "La mia lista", path: "/my-list", icon: BookmarkBorderRoundedIcon },
      { label: "Account", path: "/account", icon: AccountCircleOutlinedIcon },
    ],
    []
  );

  if (!isMobile || isWatch || isHome) return null;

  return (
    <>
      <Box
        component="button"
        type="button"
        className="flixit-sc-navbar-toggler"
        aria-label="Apri menu"
        onClick={() => setDrawerOpen(true)}
      >
        <MenuRoundedIcon />
      </Box>

      {drawerOpen && (
        <Box className="flixit-mobile-menu-backdrop" onClick={() => setDrawerOpen(false)}>
          <Box
            className="flixit-mobile-menu-panel"
            onClick={(event) => event.stopPropagation()}
            data-testid="mobile-navigation-drawer"
          >
            <Box className="flixit-mobile-menu-head">
              <Box className="flixit-mobile-menu-logo"><span>FLIX</span><b>IT</b></Box>
              <Box component="button" type="button" aria-label="Chiudi menu" onClick={() => setDrawerOpen(false)}>
                <CloseRoundedIcon />
              </Box>
            </Box>

            <Box className="flixit-mobile-menu-list">
              {drawerItems.map(({ label, path, icon: Icon }) => (
                <Box
                  key={label}
                  component="button"
                  type="button"
                  onClick={() => { setDrawerOpen(false); navigate(path); }}
                  className={isActivePath(location.pathname, path) ? "is-active" : ""}
                >
                  <Icon />
                  <span>{label}</span>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </>
  );
}
