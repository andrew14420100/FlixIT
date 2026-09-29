// @ts-nocheck
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const WATCH_TV_RE = /^\/watch\/tv\/(\d+)(?:\/|$)/i;
const COMPLETION_RATIO = 0.95;

function authenticatedProfileId() {
  try {
    const token = localStorage.getItem("user_token");
    const userId = localStorage.getItem("netflix_user_id");
    return token && userId ? userId : null;
  } catch {
    return null;
  }
}

function completionStorageKey(mediaId: number) {
  const profileId = authenticatedProfileId();
  return profileId ? `flixit-completed-episodes:${profileId}:${mediaId}` : null;
}

function markEpisodeCompleted(mediaId: number, season: number, episode: number, source = "player-complete") {
  const key = completionStorageKey(mediaId);
  if (!key) return;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    const set = new Set<string>(Array.isArray(parsed) ? parsed.map(String) : []);
    const value = `${Math.max(1, season)}:${Math.max(1, episode)}`;
    if (set.has(value)) return;
    set.add(value);
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

/**
 * Completion comes only from actual media playback. Navigating forward, opening
 * an episode card or auto-advancing the route is not completion evidence.
 */
export default function WatchEpisodeAdvanceTracker() {
  const location = useLocation();
  const locationRef = useRef({ pathname: location.pathname, search: location.search });
  const completedInSession = useRef(new Set<string>());

  useEffect(() => {
    locationRef.current = { pathname: location.pathname, search: location.search };
  }, [location.pathname, location.search]);

  useEffect(() => {
    const completeCurrent = (target: HTMLMediaElement, source: string) => {
      const current = parseWatchLocation(locationRef.current.pathname, locationRef.current.search);
      if (!current?.mediaId || !authenticatedProfileId()) return;
      const key = `${current.mediaId}:${current.season}:${current.episode}`;
      if (completedInSession.current.has(key)) return;

      const duration = Number(target.duration || 0);
      const currentTime = Number(target.currentTime || 0);
      const ratio = duration > 0 && Number.isFinite(duration) ? currentTime / duration : 0;
      if (source !== "player-ended" && ratio < COMPLETION_RATIO) return;

      completedInSession.current.add(key);
      markEpisodeCompleted(current.mediaId, current.season, current.episode, source);
    };

    const onEnded = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLMediaElement) completeCurrent(target, "player-ended");
    };

    const onTimeUpdate = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLMediaElement) completeCurrent(target, "player-95-percent");
    };

    document.addEventListener("ended", onEnded, true);
    document.addEventListener("timeupdate", onTimeUpdate, true);
    return () => {
      document.removeEventListener("ended", onEnded, true);
      document.removeEventListener("timeupdate", onTimeUpdate, true);
    };
  }, []);

  return null;
}
