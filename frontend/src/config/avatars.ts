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

function warmUrl(value: any, high = false) {
  if (typeof Image === "undefined") return;
  const src = String(value || "").trim();
  if (!src || warmedUrls.has(src)) return;
  warmedUrls.add(src);
  const image = new Image();
  image.decoding = "async";
  (image as any).fetchPriority = high ? "high" : "auto";
  image.src = src;
  bootImageWarmers.push(image);
  if (bootImageWarmers.length > 80) bootImageWarmers.splice(0, bootImageWarmers.length - 80);
}

function warmHomePayload(data: any) {
  if (!data || typeof window === "undefined") return;
  const mobile = window.innerWidth < 900;
  const hero = data?.hero || {};
  const assets = hero?.assets || {};
  warmUrl(hero?.customBackdrop || assets?.hero_backdrop_path || assets?.backdrop_path, true);
  warmUrl(assets?.logo_path || assets?.logo_url, true);

  const rows = Array.isArray(data?.rows) ? data.rows.slice(0, 7) : [];
  let warmed = 0;
  for (const row of rows) {
    const items = Array.isArray(row?.items) ? row.items : [];
    for (const item of items.slice(0, mobile ? 5 : 9)) {
      const art = item?.__artwork || {};
      const url = mobile
        ? (art?.poster_url || item?.poster_path)
        : (art?.backdrop_url || art?.titled_backdrop_url || item?.titled_backdrop_path || item?.backdrop_path);
      warmUrl(url, warmed < (mobile ? 8 : 14));
      warmed += 1;
    }
  }
}

// MainHeader imports this module during bundle evaluation, before React paints.
// Prime visual bytes from the last Home snapshot immediately, and also adopt the
// bootstrap promise that index.html started while the JS bundle was downloading.
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
