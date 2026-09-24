"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const host = process.env.PROVIDER_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PROVIDER_PORT || "9000", 10);
const providerTimeoutMs = Math.max(
  1000,
  Number.parseInt(process.env.OMNI_PROVIDER_TIMEOUT_MS || "10000", 10) || 10000
);

const providersDir = path.join(__dirname, "providers");
const loadedProviders = [];
const skippedProviders = [];

function loadProviders() {
  loadedProviders.length = 0;
  skippedProviders.length = 0;

  fs.mkdirSync(providersDir, { recursive: true });
  const files = fs.readdirSync(providersDir).filter((file) => file.endsWith(".js"));

  for (const file of files) {
    const fullPath = path.join(providersDir, file);
    try {
      delete require.cache[require.resolve(fullPath)];
      const mod = require(fullPath);
      if (mod && typeof mod.getStreams === "function") {
        loadedProviders.push({
          name: String(mod.name || path.basename(file, ".js")),
          file,
          getStreams: mod.getStreams.bind(mod),
        });
        console.log(`[flixit-provider] loaded provider: ${mod.name || file}`);
      } else {
        skippedProviders.push({ file, reason: "missing getStreams(type, id) export" });
        console.warn(`[flixit-provider] skipped ${file}: missing getStreams(type, id)`);
      }
    } catch (error) {
      skippedProviders.push({ file, reason: error?.message || String(error) });
      console.error(`[flixit-provider] failed to load ${file}: ${error?.message || error}`);
    }
  }
}

loadProviders();

// Public/open test movie retained for end-to-end validation.
const testId = String(process.env.PROVIDER_TEST_ID || "tt1727587").trim();
const testTitle = String(process.env.PROVIDER_TEST_TITLE || "Sintel (2010) - 4K test movie").trim();
const testUrl = String(
  process.env.PROVIDER_TEST_URL ||
    "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8"
).trim();

const manifest = {
  id: "org.flixit.local-provider-manager",
  version: "2.1.0",
  name: "FlixIT Local Provider Manager",
  description: "Local provider manager with HTTP and torrent metadata providers",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: []
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*"
  });
  res.end(body);
}

function normalizeStreams(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((stream) => {
    if (!stream || typeof stream !== "object") return false;
    const url = String(stream.url || "").trim();
    const magnet = String(stream.magnet || "").trim();
    return /^https?:\/\//i.test(url) || /^magnet:\?/i.test(magnet);
  });
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchLocalProviderStreams(type, id) {
  const jobs = loadedProviders.map(async (provider) => {
    try {
      const result = await withTimeout(provider.getStreams(type, id), providerTimeoutMs);
      return normalizeStreams(result);
    } catch (error) {
      console.error(`[flixit-provider] ${provider.name} failed: ${error?.message || error}`);
      return [];
    }
  });

  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((entry) =>
    entry.status === "fulfilled" && Array.isArray(entry.value) ? entry.value : []
  );
}

async function streamResponse(requestPath) {
  const match = requestPath.match(/^\/stream\/(movie|series)\/([^/]+)\.json$/);
  if (!match) return null;

  const [, type, id] = match;
  const streams = await fetchLocalProviderStreams(type, id);

  if (streams.length > 0) return { streams };

  if (type === "movie" && id === testId && testUrl) {
    return {
      streams: [
        {
          name: "FlixIT Local Test",
          title: testTitle,
          url: testUrl,
        },
      ],
    };
  }

  return { streams: [] };
}

const server = http.createServer(async (req, res) => {
  const requestPath = (req.url || "/").split("?", 1)[0];

  if (req.method === "GET" && requestPath === "/manifest.json") {
    return sendJson(res, 200, manifest);
  }

  if (req.method === "GET" && requestPath === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: manifest.id,
      providerManager: {
        directory: providersDir,
        loaded: loadedProviders.map((p) => ({ name: p.name, file: p.file })),
        skipped: skippedProviders,
        timeoutMs: providerTimeoutMs,
      },
      testMovie: {
        title: testTitle,
        imdbId: testId,
        tmdbId: 45745,
        url: testUrl,
      },
    });
  }

  if (req.method === "GET") {
    const payload = await streamResponse(requestPath);
    if (payload) return sendJson(res, 200, payload);
  }

  return sendJson(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`[flixit-provider] manager listening on http://${host}:${port}`);
  console.log(`[flixit-provider] loaded providers: ${loadedProviders.length}`);
  console.log(`[flixit-provider] skipped providers: ${skippedProviders.length}`);
});

function shutdown(signal) {
  console.log(`[flixit-provider] ${signal}; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
