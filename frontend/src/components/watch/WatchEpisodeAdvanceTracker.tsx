// @ts-nocheck
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useContinueWatching } from "src/hooks/useContinueWatching";

const WATCH_TV_RE = /^\/watch\/tv\/(\d+)(?:\/|$)/i;

function localUserId() {
  let id = localStorage.getItem("netflix_user_id");
  if (!id) {
    id = `user_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem("netflix_user_id", id);
  }
  return id;
}

function completionStorageKey(mediaId: number) {
  return `flixit-completed-episodes:${localUserId()}:${mediaId}`;
}

function markEpisodeCompleted(mediaId: number, season: number, episode: number) {
  try {
    const key = completionStorageKey(mediaId);
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    const set = new Set<string>(Array.isArray(parsed) ? parsed.map(String) : []);
    set.add(`${Math.max(1, season)}:${Math.max(1, episode)}`);
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
    window.dispatchEvent(new CustomEvent("flixit-episode-completion-changed", {
      detail: { mediaId, season, episode, completed: true, source: "player-next" },
    }));
  } catch {}
}

function parseWatchLocation(pathname: string, search: string) {
  const match = pathname.match(WATCH_TV_RE);
  if (!match) return null;
  const params = new URLSearchParams(search || "");
  return {
    mediaId: Number(match[1] || 0),
    season: Math.max(1, Number(params.get("s") || 1)),
    episode: Math.max(1, Number(params.get("e") || 1)),
  };
}

function isForwardEpisode(previous: any, current: any) {
  if (!previous || !current || previous.mediaId !== current.mediaId) return false;
  if (current.season === previous.season && current.episode === previous.episode + 1) return true;
  if (current.season === previous.season + 1 && current.episode === 1) return true;
  return false;
}

/**
 * Keeps episode completion and Continue Watching aligned with the player's
 * forward-arrow navigation. Opening an arbitrary later episode from Detail
 * never completes the episodes before it: only watch -> next does.
 */
export default function WatchEpisodeAdvanceTracker() {
  const location = useLocation();
  const { items, saveProgress } = useContinueWatching();
  const previousRef = useRef<any>(null);
  const itemsRef = useRef<any[]>(items || []);

  useEffect(() => {
    itemsRef.current = items || [];
  }, [items]);

  useEffect(() => {
    const current = parseWatchLocation(location.pathname, location.search);
    const previous = previousRef.current;
    previousRef.current = current;

    if (!isForwardEpisode(previous, current)) return;

    // WatchPage persists the outgoing episode during unmount. Apply the new
    // target just after that cleanup. Progress refreshes must not cancel this
    // timer, hence items are read through a ref rather than being a dependency.
    const timer = window.setTimeout(() => {
      markEpisodeCompleted(previous.mediaId, previous.season, previous.episode);

      const existing = (itemsRef.current || []).find((item: any) => Number(item?.tmdb_id || 0) === current.mediaId);
      saveProgress({
        tmdb_id: current.mediaId,
        media_type: "tv",
        // The backend ignores values below 10 seconds. Ten records the new
        // episode, while WatchPage still starts it at 0 because resume rewind
        // is only applied after 30 seconds.
        progress: 10,
        duration: Math.max(60, Number(existing?.duration || 2700)),
        title: existing?.title || `Serie TV ${current.mediaId}`,
        backdrop_path: existing?.backdrop_path || "",
        poster_path: existing?.poster_path || "",
        season: current.season,
        episode: current.episode,
      });
    }, 140);

    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search, saveProgress]);

  return null;
}
