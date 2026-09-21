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

function markEpisodeCompleted(mediaId: number, season: number, episode: number, source = "player-ended") {
  try {
    const key = completionStorageKey(mediaId);
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    const set = new Set<string>(Array.isArray(parsed) ? parsed.map(String) : []);
    set.add(`${Math.max(1, season)}:${Math.max(1, episode)}`);
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
    window.dispatchEvent(new CustomEvent("flixit-episode-completion-changed", {
      detail: { mediaId, season, episode, completed: true, source },
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
 * Completion and Continue Watching intentionally use two different signals:
 * - a real HTMLMediaElement `ended` event marks the current episode completed;
 * - navigating with the player's forward arrow only moves Continue Watching to
 *   the target episode and NEVER completes the episode being skipped.
 *
 * `ended` does not bubble, therefore it is observed during the capture phase.
 */
export default function WatchEpisodeAdvanceTracker() {
  const location = useLocation();
  const { items, saveProgress } = useContinueWatching();
  const previousRef = useRef<any>(null);
  const itemsRef = useRef<any[]>(items || []);
  const locationRef = useRef({ pathname: location.pathname, search: location.search });

  useEffect(() => {
    itemsRef.current = items || [];
  }, [items]);

  useEffect(() => {
    locationRef.current = { pathname: location.pathname, search: location.search };
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onEnded = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLMediaElement)) return;
      const current = parseWatchLocation(locationRef.current.pathname, locationRef.current.search);
      if (!current?.mediaId) return;
      markEpisodeCompleted(current.mediaId, current.season, current.episode, "player-ended");
    };

    document.addEventListener("ended", onEnded, true);
    return () => document.removeEventListener("ended", onEnded, true);
  }, []);

  useEffect(() => {
    const current = parseWatchLocation(location.pathname, location.search);
    const previous = previousRef.current;
    previousRef.current = current;

    if (!isForwardEpisode(previous, current)) return;

    // WatchPage persists the outgoing episode while route state changes. Apply
    // the target shortly afterwards so Continue Watching resumes the episode the
    // user actually moved to. Importantly, no completion is written here.
    const timer = window.setTimeout(() => {
      const existing = (itemsRef.current || []).find((item: any) => Number(item?.tmdb_id || 0) === current.mediaId);
      saveProgress({
        tmdb_id: current.mediaId,
        media_type: "tv",
        // The backend ignores values below 10 seconds. Ten records the target
        // episode while WatchPage still starts from 0 because resume rewind is
        // only used after 30 seconds.
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
