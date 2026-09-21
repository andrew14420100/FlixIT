// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const DETAIL_TV_RE = /^\/(?:detail|browse)\/tv\/(\d+)(?:\/|$)/i;
const seasonCache = new Map<string, Promise<Map<number, string>>>();

function selectedSeasonFromDom() {
  const mobile = document.querySelector<HTMLElement>(".mobile-detail-season-select .MuiSelect-select");
  const desktop = document.querySelector<HTMLElement>("#episodes [role='combobox']");
  const text = mobile?.textContent || desktop?.textContent || "";
  const match = text.match(/(\d+)/);
  return Math.max(1, Number(match?.[1] || 1));
}

function absoluteStill(value: any) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
  if (raw.startsWith("/")) return `https://image.tmdb.org/t/p/w780${raw}`;
  return "";
}

function loadSeasonStills(mediaId: number, season: number) {
  const key = `${mediaId}:${season}`;
  const hit = seasonCache.get(key);
  if (hit) return hit;

  const request = fetch(`/api/public/tv/${mediaId}/season/${season}`, {
    headers: { Accept: "application/json" },
    cache: "force-cache",
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      const map = new Map<number, string>();
      const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];
      episodes.forEach((episode: any, index: number) => {
        const number = Math.max(1, Number(episode?.episode_number || index + 1));
        const still = [
          episode?.still_path,
          episode?.still_url,
          episode?.image_url,
          episode?.thumbnail_url,
          episode?.backdrop_path,
        ].map(absoluteStill).find(Boolean);
        if (still) map.set(number, still);
      });
      return map;
    })
    .catch(() => new Map<number, string>());

  seasonCache.set(key, request);
  return request;
}

function episodeNumber(row: HTMLElement, fallback: number) {
  const explicit = Number(row.dataset.flixitEpisodeNumber || 0);
  if (explicit > 0) return explicit;
  const first = row.firstElementChild?.textContent || row.textContent || "";
  const match = String(first).trim().match(/(\d+)/);
  return Math.max(1, Number(match?.[1] || fallback));
}

function applyStill(img: HTMLImageElement | null, src: string, identity: string) {
  if (!img || !src) return;
  if (img.dataset.flixitPolishedStill === identity && img.currentSrc === src) return;
  img.src = src;
  img.removeAttribute("srcset");
  img.dataset.flixitPolishedStill = identity;
  img.style.objectFit = "cover";
  img.style.objectPosition = "center center";
}

async function syncEpisodeRows(mediaId: number) {
  const season = selectedSeasonFromDom();
  const stills = await loadSeasonStills(mediaId, season);
  if (!stills.size) return;

  const desktopRows = Array.from(document.querySelectorAll<HTMLElement>("#episodes .flixit-desktop-episode-row"));
  desktopRows.forEach((row, index) => {
    const number = episodeNumber(row, index + 1);
    row.dataset.flixitEpisodeNumber = String(number);
    applyStill(row.querySelector<HTMLImageElement>("img"), stills.get(number) || "", `${season}:${number}`);
  });

  const mobileRows = Array.from(document.querySelectorAll<HTMLElement>(".mobile-detail-episode"));
  mobileRows.forEach((row, index) => {
    const number = episodeNumber(row, index + 1);
    row.dataset.flixitEpisodeNumber = String(number);
    applyStill(row.querySelector<HTMLImageElement>("img"), stills.get(number) || "", `${season}:${number}`);
  });
}

function findContinueCard() {
  const labels = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,span,div"))
    .filter((node) => String(node.textContent || "").trim() === "Continua da dove hai interrotto");
  for (const label of labels) {
    let node = label.parentElement;
    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      if (node.querySelector("img") && /S\d+\s*:\s*E\d+/i.test(String(node.textContent || ""))) return node as HTMLElement;
    }
  }
  return null;
}

async function syncContinueCard(mediaId: number) {
  const card = findContinueCard();
  if (!card) return;
  const text = String(card.textContent || "");
  const match = text.match(/S\s*(\d+)\s*:\s*E\s*(\d+)/i);
  if (!match) return;
  const season = Math.max(1, Number(match[1] || 1));
  const episode = Math.max(1, Number(match[2] || 1));
  const stills = await loadSeasonStills(mediaId, season);
  const src = stills.get(episode) || "";
  if (!src) return;

  const img = card.querySelector<HTMLImageElement>("img");
  applyStill(img, src, `continue:${season}:${episode}`);
  if (img) {
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.objectPosition = "center center";
  }
}

export default function DetailEpisodeVisualPolish() {
  const location = useLocation();

  useEffect(() => {
    const match = location.pathname.match(DETAIL_TV_RE);
    if (!match) return;
    const mediaId = Number(match[1] || 0);
    if (!mediaId) return;

    let raf = 0;
    let disposed = false;
    const run = () => {
      if (disposed || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncEpisodeRows(mediaId);
        syncContinueCard(mediaId);
      });
    };

    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    document.addEventListener("click", run, true);
    window.addEventListener("flixit-episode-completion-changed", run as EventListener);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("click", run, true);
      window.removeEventListener("flixit-episode-completion-changed", run as EventListener);
    };
  }, [location.pathname]);

  return null;
}
