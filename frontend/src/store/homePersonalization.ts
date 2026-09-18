// @ts-nocheck

const PREFIX = "flix-home-preferences-v1";

export function homePreferenceKey(userId?: string) {
  return `${PREFIX}:${userId || "guest"}`;
}

export function readHomePreferences(userId?: string) {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(homePreferenceKey(userId)) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeHomePreferences(userId: string | undefined, value: any) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      homePreferenceKey(userId),
      JSON.stringify({ ...(value || {}), updatedAt: Date.now() })
    );
  } catch {}
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Small deterministic tie-breaker: different profiles do not see every generic
 * row in exactly the same order, but the order remains stable across reloads.
 */
export function stableProfileBias(userId: string, signature: string) {
  if (!userId || userId === "guest") return 0;
  return (hashString(`${userId}|${signature}`) % 700) / 100;
}

export function preferenceBoost(section: any, preferences: any) {
  if (!preferences) return 0;
  let boost = 0;
  const genreId = Number(section?.genre_id || 0);
  const favoriteGenres = Array.isArray(preferences.favoriteGenres)
    ? preferences.favoriteGenres.map(Number)
    : [];
  const genreIndex = favoriteGenres.indexOf(genreId);
  if (genreId && genreIndex >= 0) {
    boost += Math.max(12, 34 - genreIndex * 8);
  }

  const media = section?.media_type || section?.mediaType;
  if (
    preferences.preferredMediaType &&
    media &&
    media !== "mixed" &&
    media === preferences.preferredMediaType
  ) {
    boost += 7;
  }
  return boost;
}
