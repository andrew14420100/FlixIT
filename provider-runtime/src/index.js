"use strict";

const http = require("http");

const host = process.env.PROVIDER_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PROVIDER_PORT || "9000", 10);
const testId = String(process.env.PROVIDER_TEST_ID || "tt15239678").trim();
const testUrl = String(
  process.env.PROVIDER_TEST_URL ||
    "https://pbs.github.io/test-streams/pbs/test-pattern/pbs-bars_av1-vp9-hevc-avc.m3u8"
).trim();

const manifest = {
  id: "org.flixit.local-test-provider",
  version: "1.0.0",
  name: "FlixIT Local Test Provider",
  description: "Authorized local Stremio-compatible provider used only for end-to-end testing",
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
          title: "Public 4K HLS connectivity test",
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
      testId,
      testUrl
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
  console.log(`[flixit-provider] test movie id ${testId}`);
});

function shutdown(signal) {
  console.log(`[flixit-provider] ${signal}; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
