// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const DETAIL_TV_RE = /^\/(?:detail|browse)\/tv\/(\d+)(?:\/|$)/i;
const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const RECHECK_MS = 90_000;

function selectedSeasonFromDom() {
  const mobile = document.querySelector<HTMLElement>(".mobile-detail-season-select .MuiSelect-select");
  const desktop = document.querySelector<HTMLElement>("#episodes [role='combobox']");
  const text = String(mobile?.textContent || desktop?.textContent || "");
  const match = text.match(/(\d+)/);
  return Math.max(1, Number(match?.[1] || 1));
}

function episodeNumber(row: HTMLElement) {
  const text = String(row.textContent || "").trim();
  const match = text.match(/^(\d+)(?:\.|\s)/);
  return Math.max(0, Number(match?.[1] || 0));
}

function noteHost(row: HTMLElement) {
  if (row.classList.contains("mobile-detail-episode")) {
    return row.querySelector<HTMLElement>(".mobile-detail-episode-copy");
  }
  return row.children?.[2] as HTMLElement | null;
}

function actionGroups(row: HTMLElement) {
  const groups: HTMLElement[] = [];
  if (row.classList.contains("mobile-detail-episode")) {
    const sibling = row.nextElementSibling as HTMLElement | null;
    if (sibling?.classList.contains("flixit-episode-actions")) groups.push(sibling);
  }
  row.querySelectorAll<HTMLElement>(".flixit-episode-actions").forEach((node) => groups.push(node));
  return groups;
}

function setPending(row: HTMLElement, pending: boolean) {
  row.classList.toggle("is-italian-pending", pending);
  row.dataset.italianAvailable = pending ? "false" : "true";
  row.setAttribute("aria-disabled", pending ? "true" : "false");

  if (row instanceof HTMLButtonElement) row.disabled = pending;

  actionGroups(row).forEach((actions) => {
    actions.classList.toggle("is-italian-pending", pending);
    actions.setAttribute("aria-disabled", pending ? "true" : "false");
    actions.style.setProperty("display", pending ? "none" : "", pending ? "important" : "");
    actions.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = pending;
      button.setAttribute("aria-disabled", pending ? "true" : "false");
    });
  });

  const host = noteHost(row);
  if (!host) return;
  let note = host.querySelector<HTMLElement>(":scope > .flixit-italian-pending-note");
  if (pending && !note) {
    note = document.createElement("span");
    note.className = "flixit-italian-pending-note";
    note.textContent = "Disponibile prossimamente in italiano";
    host.appendChild(note);
  } else if (!pending && note) {
    note.remove();
  }
}

function applyAvailability(map: Map<number, boolean>) {
  document.querySelectorAll<HTMLElement>(".mobile-detail-episode").forEach((row) => {
    const number = episodeNumber(row);
    if (!number || !map.has(number)) return;
    setPending(row, map.get(number) === false);
  });

  document.querySelectorAll<HTMLElement>("#episodes .flixit-desktop-episode-row").forEach((row) => {
    const number = episodeNumber(row);
    if (!number || !map.has(number)) return;
    setPending(row, map.get(number) === false);
  });
}

export default function ItalianEpisodeAvailabilityRuntime() {
  const location = useLocation();

  useEffect(() => {
    const match = location.pathname.match(DETAIL_TV_RE);
    if (!match) return;
    const mediaId = Number(match[1] || 0);
    if (!mediaId) return;

    let disposed = false;
    let currentSeason = 0;
    let currentMap = new Map<number, boolean>();
    let requestToken = 0;
    let raf = 0;

    const refresh = async (season: number) => {
      const token = ++requestToken;
      try {
        const response = await fetch(`${API_URL}/api/public/tv/${mediaId}/season/${season}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (disposed || token !== requestToken) return;
        const next = new Map<number, boolean>();
        (Array.isArray(payload?.episodes) ? payload.episodes : []).forEach((episode: any, index: number) => {
          const number = Math.max(1, Number(episode?.episode_number || index + 1));
          next.set(number, episode?.italian_available === true);
        });
        currentMap = next;
        applyAvailability(currentMap);
      } catch {}
    };

    const scan = () => {
      if (raf || disposed) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const season = selectedSeasonFromDom();
        if (season !== currentSeason) {
          currentSeason = season;
          currentMap = new Map();
          refresh(season);
          return;
        }
        if (currentMap.size) applyAvailability(currentMap);
      });
    };

    const blockPendingClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const pendingRow = target?.closest?.(".mobile-detail-episode.is-italian-pending, #episodes .flixit-desktop-episode-row.is-italian-pending") as HTMLElement | null;
      const pendingActions = target?.closest?.(".flixit-episode-actions.is-italian-pending") as HTMLElement | null;
      if (!pendingRow && !pendingActions) return;
      event.preventDefault();
      event.stopPropagation();
      if ("stopImmediatePropagation" in event) (event as any).stopImmediatePropagation();
    };

    const observer = new MutationObserver(scan);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "aria-expanded"],
    });

    document.addEventListener("click", blockPendingClick, true);
    document.addEventListener("pointerdown", blockPendingClick, true);
    const poll = window.setInterval(() => {
      const season = selectedSeasonFromDom();
      currentSeason = season;
      refresh(season);
    }, RECHECK_MS);

    scan();
    return () => {
      disposed = true;
      requestToken += 1;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("click", blockPendingClick, true);
      document.removeEventListener("pointerdown", blockPendingClick, true);
      window.clearInterval(poll);
    };
  }, [location.pathname]);

  return null;
}
