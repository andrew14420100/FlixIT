const VISUAL_CACHE = "flixit-visual-cache-v2-swr";
const MAX_ENTRIES = 1400;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("flixit-visual-cache-") && key !== VISUAL_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  if (excess <= 0) return;
  for (const request of keys.slice(0, excess)) {
    await cache.delete(request);
  }
}

function shouldCache(request) {
  const destination = request.destination;
  if (destination === "image" || destination === "font") return true;
  if (destination !== "style") return false;
  try {
    return new URL(request.url).hostname === "fonts.googleapis.com";
  } catch {
    return false;
  }
}

async function refresh(cache, request) {
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === "opaque")) {
      await cache.put(request, response.clone()).catch(() => {});
      await trim(cache).catch(() => {});
    }
    return response;
  } catch {
    return null;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !shouldCache(request)) return;

  event.respondWith((async () => {
    const cache = await caches.open(VISUAL_CACHE);
    const cached = await cache.match(request, { ignoreVary: true });

    if (cached) {
      // Fast first paint, but always revalidate in the background. A temporary
      // broken/old Hero or logo can therefore heal without asking the user to
      // clear site data manually.
      event.waitUntil(refresh(cache, request));
      return cached;
    }

    const network = await refresh(cache, request);
    if (network) return network;
    return new Response("", { status: 504, statusText: "Visual asset unavailable" });
  })());
});
