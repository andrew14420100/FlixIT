// Netflix-style illustrated profile avatars (ids match the legacy color ids stored in profileImage)
export const AVATARS = [
  { id: "red", label: "Mostro", src: "/avatars/red.webp", color: "#e50914" },
  { id: "blue", label: "Robot", src: "/avatars/blue.webp", color: "#0071eb" },
  { id: "green", label: "Alieno", src: "/avatars/green.webp", color: "#2bb535" },
  { id: "yellow", label: "Gatto", src: "/avatars/yellow.webp", color: "#f5c518" },
  { id: "purple", label: "Ninja", src: "/avatars/purple.webp", color: "#8b5cf6" },
  { id: "orange", label: "Volpe", src: "/avatars/orange.webp", color: "#f97316" },
  { id: "pink", label: "Panda", src: "/avatars/pink.webp", color: "#ec4899" },
  { id: "teal", label: "Astronauta", src: "/avatars/teal.webp", color: "#14b8a6" },
];

export const DEFAULT_AVATAR = "/avatars/default.webp";

const HOME_CACHE_KEY = "flix-home-bootstrap-v8-sc-logo-home-fixes";
const bootImageWarmers: HTMLImageElement[] = [];
const warmedUrls = new Set<string>();

function firstUrl(value: any) {
  if (typeof value === "string") return value;
  if (typeof value?.url === "string") return value.url;
  return "";
}

function artworkUrl(value: any, size = "w780") {
  const raw = String(firstUrl(value) || "").trim();
  if (!raw) return "";
  if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
  if (/^\/(?:avatars|api|assets|static|uploads|media|images)\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `https://image.tmdb.org/t/p/${size}${raw}`;
  return raw;
}

function warmUrl(value: any, high = false, size = "w780") {
  if (typeof Image === "undefined") return;
  const src = artworkUrl(value, size);
  if (!src || warmedUrls.has(src)) return;
  warmedUrls.add(src);
  const image = new Image();
  image.decoding = high ? "sync" : "async";
  (image as any).fetchPriority = high ? "high" : "auto";
  image.src = src;
  try { image.decode?.().catch(() => {}); } catch {}
  bootImageWarmers.push(image);
  if (bootImageWarmers.length > 28) bootImageWarmers.splice(0, bootImageWarmers.length - 28);
}

function scheduleVisibleCardWarm(data: any) {
  if (!data || typeof window === "undefined") return;
  const mobile = window.innerWidth < 900;
  const run = () => {
    // Warm only what can really become visible immediately. Starting downloads
    // for 80-100 cards at once starves the Hero/logo on a cold connection.
    const rows = Array.isArray(data?.rows) ? data.rows.slice(0, 2) : [];
    let warmed = 0;
    for (const row of rows) {
      const items = Array.isArray(row?.items) ? row.items : [];
      for (const item of items.slice(0, mobile ? 4 : 7)) {
        const art = item?.__artwork || {};
        const value = mobile
          ? (art?.poster_url || item?.poster_path || item?.poster)
          : (art?.backdrop_url || art?.titled_backdrop_url || item?.titled_backdrop_path || item?.backdrop_path);
        warmUrl(value, warmed < (mobile ? 4 : 7), mobile ? "w500" : "w780");
        warmed += 1;
      }
    }
  };

  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(run, { timeout: 500 });
  } else {
    window.setTimeout(run, 100);
  }
}

function warmHomePayload(data: any) {
  if (!data || typeof window === "undefined") return;
  const hero = data?.hero || {};
  const assets = hero?.assets || {};

  // Hero is the visual LCP. It must own the first network slots.
  warmUrl(
    hero?.customBackdrop || assets?.hero_backdrop_path || assets?.detail_backdrop_path || assets?.backdrop_path,
    true,
    "original"
  );
  warmUrl(assets?.logo_path || assets?.logo_url, true, "original");
  scheduleVisibleCardWarm(data);
}

if (typeof window !== "undefined") {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/flixit-sw.js", { scope: "/" }).catch(() => {});
  }
  try {
    const cached = JSON.parse(localStorage.getItem(HOME_CACHE_KEY) || "null");
    warmHomePayload(cached?.data || null);
  } catch {}
  try {
    const early = (window as any).__FLIXIT_HOME_FAST_PROMISE__;
    if (early) Promise.resolve(early).then(warmHomePayload).catch(() => {});
  } catch {}
}

export const avatarSrc = (profileImage?: string | null) =>
  AVATARS.find((a) => a.id === profileImage)?.src || DEFAULT_AVATAR;
