"use strict";

const http = require("http");

const host = process.env.PROVIDER_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PROVIDER_PORT || "9000", 10);

// Sintel (2010), Blender Foundation open movie.
// IMDb: tt1727587 | TMDB: 45745
// The default HLS master is a public adaptive Sintel test asset that exposes
// UHD/4K renditions for player quality-selection tests.
const testId = String(process.env.PROVIDER_TEST_ID || "tt1727587").trim();
const testTitle = String(process.env.PROVIDER_TEST_TITLE || "Sintel (2010) - 4K test movie").trim();
const testUrl = String(
  process.env.PROVIDER_TEST_URL ||
    "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8"
).trim();

const manifest = {
  id: "org.flixit.local-test-provider",
  version: "1.1.0",
  name: "FlixIT Local Test Provider",
  description: "Authorized local Stremio-compatible provider used only for end-to-end movie and 4K testing",
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

function streamResponse(path) {
  const match = path.match(/^\/stream\/(movie|series)\/([^/]+)\.json$/);
  if (!match) return null;

  const [, type, id] = match;

  if (type === "movie" && id === testId && testUrl) {
    return {
      streams: [
        {
          name: "FlixIT Local Provider",
          title: testTitle,
          url: testUrl
        }
      ]
    };
  }

  return { streams: [] };
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?", 1)[0];

  if (req.method === "GET" && path === "/manifest.json") {
    return sendJson(res, 200, manifest);
  }

  if (req.method === "GET" && path === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: manifest.id,
      testMovie: {
        title: testTitle,
        imdbId: testId,
        tmdbId: 45745,
        url: testUrl
      }
    });
  }

  if (req.method === "GET") {
    const payload = streamResponse(path);
    if (payload) return sendJson(res, 200, payload);
  }

  return sendJson(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`[flixit-provider] listening on http://${host}:${port}`);
  console.log(`[flixit-provider] 4K test movie ${testTitle} (${testId})`);
});

function shutdown(signal) {
  console.log(`[flixit-provider] ${signal}; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
