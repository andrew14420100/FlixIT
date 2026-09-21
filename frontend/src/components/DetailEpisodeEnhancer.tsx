// @ts-nocheck
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PLAY_GLYPH_PATH } from "src/components/PlayGlyph";

const DETAIL_RE = /^\/(?:detail|browse)\/tv\/(\d+)(?:\/|$)/i;

function userId() {
  let id = localStorage.getItem("netflix_user_id");
  if (!id) {
    id = `user_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem("netflix_user_id", id);
  }
  return id;
}

function storageKey(mediaId: number) {
  return `flixit-completed-episodes:${userId()}:${mediaId}`;
}

function readCompleted(mediaId: number) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(mediaId)) || "[]");
    return new Set<string>(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function writeCompleted(mediaId: number, set: Set<string>) {
  try {
    localStorage.setItem(storageKey(mediaId), JSON.stringify(Array.from(set)));
  } catch {}
}

function episodeKey(season: number, episode: number) {
  return `${Math.max(1, Number(season || 1))}:${Math.max(1, Number(episode || 1))}`;
}

function selectedSeasonFromDom() {
  const mobile = document.querySelector<HTMLElement>(".mobile-detail-season-select .MuiSelect-select");
  const desktop = document.querySelector<HTMLElement>("#episodes [role='combobox']");
  const text = mobile?.textContent || desktop?.textContent || "";
  const match = text.match(/(\d+)/);
  return Math.max(1, Number(match?.[1] || 1));
}

function playSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" data-flixit-play-glyph="true"><path d="${PLAY_GLYPH_PATH}" fill="currentColor"/></svg>`;
}

function actionMarkup(mediaId: number, season: number, episode: number) {
  return `
    <button type="button" class="flixit-episode-action flixit-episode-play" data-flixit-episode-action="play" data-media-id="${mediaId}" data-season="${season}" data-episode="${episode}" aria-label="Riproduci episodio ${episode}">
      ${playSvg()}<span>Riproduci</span>
    </button>
    <button type="button" class="flixit-episode-action flixit-episode-complete" data-flixit-episode-action="complete" data-media-id="${mediaId}" data-season="${season}" data-episode="${episode}" aria-pressed="false">
      <span class="flixit-episode-check" aria-hidden="true">✓</span><span>Completato</span>
    </button>
  `;
}

function removeGeneratedEpisodeLabels(row: HTMLElement) {
  row.querySelectorAll<HTMLElement>("*").forEach((node) => {
    if (node.closest(".flixit-episode-actions")) return;
    if (node.children.length) return;
    const text = String(node.textContent || "").trim();
    if (/^Prossimo episodio$/i.test(text)) node.style.setProperty("display", "none", "important");
    if (/^Completato$/i.test(text)) node.style.setProperty("display", "none", "important");
  });
}

function syncActionIdentity(actions: HTMLElement, mediaId: number, season: number, episode: number) {
  const identity = `${mediaId}:${season}:${episode}`;
  if (actions.dataset.flixitIdentity !== identity) {
    actions.dataset.flixitIdentity = identity;
    actions.dataset.mediaId = String(mediaId);
    actions.dataset.season = String(season);
    actions.dataset.episode = String(episode);
    actions.innerHTML = actionMarkup(mediaId, season, episode);
  }
}

function markCompletion(actions: HTMLElement, mediaId: number, season: number, episode: number) {
  const set = readCompleted(mediaId);
  const done = set.has(episodeKey(season, episode));
  const button = actions.querySelector<HTMLElement>(".flixit-episode-complete");
  if (button) {
    button.classList.toggle("is-complete", done);
    button.setAttribute("aria-pressed", done ? "true" : "false");
  }
  const mobileRow = actions.previousElementSibling as HTMLElement | null;
  mobileRow?.classList.toggle("is-manual-complete", done);
  actions.closest<HTMLElement>(".flixit-desktop-episode-row")?.classList.toggle("is-manual-complete", done);
}

function ensureMobileRows(mediaId: number) {
  const season = selectedSeasonFromDom();
  document.querySelectorAll<HTMLElement>(".mobile-detail-episode").forEach((row) => {
    const match = String(row.textContent || "").trim().match(/^(\d+)\./);
    const episode = Math.max(1, Number(match?.[1] || 0));
    if (!episode || !row.parentElement) return;

    let actions = row.nextElementSibling as HTMLElement | null;
    if (!actions?.classList.contains("flixit-episode-actions")) {
      actions = document.createElement("div");
      actions.className = "flixit-episode-actions is-mobile";
      row.insertAdjacentElement("afterend", actions);
    }

    syncActionIdentity(actions, mediaId, season, episode);
    markCompletion(actions, mediaId, season, episode);
  });
}

function findDesktopEpisodeRow(img: HTMLImageElement, root: HTMLElement) {
  let node = img.parentElement;
  while (node && node !== root) {
    const text = String(node.textContent || "").trim();
    const startsWithEpisode = /^\d+/.test(text);
    const hasAction = !!node.querySelector("button") || /Completato|Prossimo episodio|% visto/i.test(text);
    if (startsWithEpisode && hasAction && node.children.length >= 5) return node;
    node = node.parentElement;
  }
  return null;
}

function ensureDesktopRows(mediaId: number) {
  const root = document.getElementById("episodes");
  if (!root) return;
  const season = selectedSeasonFromDom();
  const rows = new Set<HTMLElement>();

  root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const row = findDesktopEpisodeRow(img, root);
    if (row) rows.add(row);
  });

  rows.forEach((row) => {
    const originalText = String(row.textContent || "");
    const match = originalText.trim().match(/^(\d+)/);
    const episode = Math.max(1, Number(match?.[1] || 0));
    if (!episode) return;

    row.classList.add("flixit-desktop-episode-row");
    removeGeneratedEpisodeLabels(row);

    const inferredComplete = /100% visto/i.test(originalText);
    const progressCell = row.children?.[5] as HTMLElement | undefined;
    if (progressCell) {
      if (inferredComplete) {
        progressCell.dataset.flixitInferredComplete = "true";
        progressCell.style.setProperty("opacity", "0", "important");
        progressCell.style.setProperty("pointer-events", "none", "important");
      } else if (progressCell.dataset.flixitInferredComplete === "true") {
        progressCell.style.removeProperty("opacity");
        progressCell.style.removeProperty("pointer-events");
        delete progressCell.dataset.flixitInferredComplete;
      }
    }

    const actionCell = row.lastElementChild as HTMLElement | null;
    if (!actionCell) return;
    actionCell.classList.add("flixit-episode-action-cell");

    let actions = actionCell.querySelector<HTMLElement>(":scope > .flixit-episode-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "flixit-episode-actions is-desktop";
      actionCell.appendChild(actions);
    }

    syncActionIdentity(actions, mediaId, season, episode);
    markCompletion(actions, mediaId, season, episode);
  });
}

function freezeSeasonMenus() {
  let found = false;
  document.querySelectorAll<HTMLElement>(".MuiPopover-root .MuiPaper-root, .MuiMenu-root .MuiPaper-root").forEach((paper) => {
    const options = Array.from(paper.querySelectorAll<HTMLElement>("[role='option'], .MuiMenuItem-root"));
    if (!options.some((option) => /Stagione\s+\d+/i.test(String(option.textContent || "")))) return;
    found = true;

    if (paper.dataset.flixitFrozenSeasonMenu !== "true") {
      const rect = paper.getBoundingClientRect();
      paper.dataset.flixitFrozenSeasonMenu = "true";
      paper.classList.add("flixit-frozen-season-menu");
      paper.style.setProperty("--flixit-season-menu-top", `${Math.round(rect.top)}px`);
      paper.style.setProperty("--flixit-season-menu-left", `${Math.round(rect.left)}px`);
      paper.style.setProperty("--flixit-season-menu-width", `${Math.round(rect.width)}px`);
      paper.parentElement?.classList.add("flixit-frozen-season-menu-root");
    }
  });
  document.documentElement.classList.toggle("flixit-season-menu-open", found);
}

export default function DetailEpisodeEnhancer() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const match = location.pathname.match(DETAIL_RE);
    if (!match) {
      document.documentElement.classList.remove("flixit-season-menu-open");
      return;
    }
    const mediaId = Number(match[1] || 0);
    if (!mediaId) return;

    let raf = 0;
    const scan = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        freezeSeasonMenus();
        ensureMobileRows(mediaId);
        ensureDesktopRows(mediaId);
      });
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const action = target?.closest?.("[data-flixit-episode-action]") as HTMLElement | null;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();

      const season = Math.max(1, Number(action.dataset.season || 1));
      const episode = Math.max(1, Number(action.dataset.episode || 1));
      const kind = action.dataset.flixitEpisodeAction;

      if (kind === "play") {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        navigate(`/watch/tv/${mediaId}?s=${season}&e=${episode}`);
        return;
      }

      if (kind === "complete") {
        const set = readCompleted(mediaId);
        const key = episodeKey(season, episode);
        if (set.has(key)) set.delete(key);
        else set.add(key);
        writeCompleted(mediaId, set);
        scan();
      }
    };

    scan();
    document.addEventListener("click", onClick, true);
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { subtree: true, childList: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("click", onClick, true);
      observer.disconnect();
      document.documentElement.classList.remove("flixit-season-menu-open");
    };
  }, [location.pathname, navigate]);

  return null;
}
