const VISUAL_CACHE = "flixit-visual-cache-v1";
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !shouldCache(request)) return;

  event.respondWith((async () => {
    const cache = await caches.open(VISUAL_CACHE);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === "opaque")) {
        event.waitUntil(
          cache.put(request, response.clone())
            .then(() => trim(cache))
            .catch(() => {})
        );
      }
      return response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  })());
});
