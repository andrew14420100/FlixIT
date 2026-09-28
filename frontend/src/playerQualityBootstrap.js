// FlixIT plan-aware HLS quality enforcement.
// Free + Base: max 720p. Pro + Unlimited: max 1080p. Superadmin: unrestricted.
// The cap is applied to ABR and manual level changes, not only to the UI.
import Hls from "hls.js";

const PATCH_FLAG = "__flixitPlanQualityPatched";
const SOURCE_FLAG = "__flixitPlanStartApplied";
const QUALITY_CAP_KEY = "flixit_max_quality_height";
const INSTANCES = new Set();

function readCap() {
  try {
    const value = Number(localStorage.getItem(QUALITY_CAP_KEY));
    if (value === 0) return 0;
    if (Number.isFinite(value) && value >= 144) return value;
  } catch {}
  return 720;
}

function levelHeight(level) {
  return Number(level?.height) || 0;
}

function bestAllowedIndex(hls, requestedIndex = null) {
  const levels = Array.isArray(hls?.levels) ? hls.levels : [];
  if (!levels.length) return -1;
  const cap = readCap();
  if (!cap) {
    if (Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < levels.length) return requestedIndex;
    let best = 0;
    for (let i = 1; i < levels.length; i += 1) {
      const a = levels[i] || {};
      const b = levels[best] || {};
      const aPixels = (Number(a.width) || 0) * (Number(a.height) || 0);
      const bPixels = (Number(b.width) || 0) * (Number(b.height) || 0);
      if (aPixels > bPixels || (aPixels === bPixels && (Number(a.bitrate) || 0) > (Number(b.bitrate) || 0))) best = i;
    }
    return best;
  }

  if (Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < levels.length) {
    const requestedHeight = levelHeight(levels[requestedIndex]);
    if (!requestedHeight || requestedHeight <= cap) return requestedIndex;
  }

  let best = -1;
  for (let i = 0; i < levels.length; i += 1) {
    const height = levelHeight(levels[i]);
    if (height > cap) continue;
    if (best < 0) { best = i; continue; }
    const current = levels[best] || {};
    const candidate = levels[i] || {};
    const currentPixels = (Number(current.width) || 0) * (Number(current.height) || 0);
    const candidatePixels = (Number(candidate.width) || 0) * (Number(candidate.height) || 0);
    if (candidatePixels > currentPixels || (candidatePixels === currentPixels && (Number(candidate.bitrate) || 0) > (Number(current.bitrate) || 0))) best = i;
  }
  return best;
}

function applyCap(hls) {
  if (!hls) return;
  const levels = Array.isArray(hls.levels) ? hls.levels : [];
  if (!levels.length) return;
  const cap = readCap();
  const allowed = bestAllowedIndex(hls);

  // hls.js uses -1 for no ABR ceiling. If a plan is capped and no compliant
  // rendition exists, keep the lowest rendition rather than ever selecting a
  // higher one automatically.
  if (!cap) hls.autoLevelCapping = -1;
  else if (allowed >= 0) hls.autoLevelCapping = allowed;
  else {
    let lowest = 0;
    for (let i = 1; i < levels.length; i += 1) {
      if ((levelHeight(levels[i]) || Number.MAX_SAFE_INTEGER) < (levelHeight(levels[lowest]) || Number.MAX_SAFE_INTEGER)) lowest = i;
    }
    hls.autoLevelCapping = lowest;
  }

  const current = Number(hls.currentLevel);
  if (cap && current >= 0 && levelHeight(levels[current]) > cap) {
    const fallback = bestAllowedIndex(hls, current);
    if (fallback >= 0) {
      try { hls.nextLevel = fallback; } catch {}
      try { hls.currentLevel = fallback; } catch {}
    }
  }
}

function setUiVisibility() {
  if (typeof document === "undefined") return;
  const cap = readCap();
  document.querySelectorAll('[data-testid^="quality-option-"]').forEach((el) => {
    const testId = String(el.getAttribute("data-testid") || "");
    if (testId === "quality-option-auto") return;
    const height = Number(testId.replace("quality-option-", ""));
    const blocked = Boolean(cap && Number.isFinite(height) && height > cap);
    el.style.display = blocked ? "none" : "";
    el.setAttribute("aria-hidden", blocked ? "true" : "false");
  });
}

async function refreshPolicyFromSession() {
  let cap = 720;
  try {
    const token = localStorage.getItem("user_token");
    if (token) {
      const base = process.env.REACT_APP_BACKEND_URL || "";
      const response = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (response.ok) {
        const user = await response.json();
        const planName = String(user?.premium?.plan_name || "").toLowerCase();
        if (user?.role === "superadmin") cap = 0;
        else if (user?.is_premium && (planName.includes("pro") || planName.includes("unlimited") || planName.includes("illimit"))) cap = 1080;
      }
    }
    localStorage.setItem(QUALITY_CAP_KEY, String(cap));
  } catch {}
  INSTANCES.forEach(applyCap);
  setUiVisibility();
}

if (!Hls.prototype[PATCH_FLAG]) {
  const originalLoadSource = Hls.prototype.loadSource;
  const originalStartLoad = Hls.prototype.startLoad;

  Hls.prototype.loadSource = function loadSourceWithPlanCap(url) {
    this[SOURCE_FLAG] = false;
    INSTANCES.add(this);
    return originalLoadSource.call(this, url);
  };

  Hls.prototype.startLoad = function startLoadWithPlanCap(startPosition = -1, skipSeekToStartPosition = false) {
    const levels = Array.isArray(this.levels) ? this.levels : [];
    if (levels.length > 0) {
      applyCap(this);
      if (!this[SOURCE_FLAG]) {
        const best = bestAllowedIndex(this);
        if (best >= 0) this.startLevel = best;
        this[SOURCE_FLAG] = true;
      }
    }
    return originalStartLoad.call(this, startPosition, skipSeekToStartPosition);
  };

  // Manual quality selection in CustomVideoPlayer sets currentLevel/nextLevel.
  // Clamp those setters too so a Base user cannot bypass the ABR ceiling.
  for (const prop of ["currentLevel", "nextLevel", "loadLevel", "nextAutoLevel"]) {
    const descriptor = Object.getOwnPropertyDescriptor(Hls.prototype, prop);
    if (!descriptor?.set || !descriptor?.get || descriptor.configurable === false) continue;
    Object.defineProperty(Hls.prototype, prop, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        let nextValue = value;
        const numeric = Number(value);
        const cap = readCap();
        if (cap && Number.isInteger(numeric) && numeric >= 0) {
          const safe = bestAllowedIndex(this, numeric);
          if (safe >= 0) nextValue = safe;
        }
        return descriptor.set.call(this, nextValue);
      },
    });
  }

  Object.defineProperty(Hls.prototype, PATCH_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

if (typeof window !== "undefined") {
  refreshPolicyFromSession();
  window.addEventListener("flixit-auth-changed", refreshPolicyFromSession);
  window.addEventListener("flixit-quality-cap-changed", () => {
    INSTANCES.forEach(applyCap);
    setUiVisibility();
  });
  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(setUiVisibility);
    const startObserver = () => {
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) startObserver();
    else window.addEventListener("DOMContentLoaded", startObserver, { once: true });
  }
}
