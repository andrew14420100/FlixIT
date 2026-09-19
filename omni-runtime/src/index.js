"use strict";

// Infrastructure-only Stremio-compatible harness used to validate FastAPI <->
// Node localhost lifecycle. No provider or scraping implementation lives here.
//
// Optional 4K test mode exposes a public HLS test stream for one explicit IMDb
// id so the FlixIT player/quality selector can be validated end-to-end without
// introducing any third-party content provider integration.
const http = require("http");

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "7001", 10);
const test4kEnabled = /^(1|true|yes|on)$/i.test(process.env.OMNI_4K_TEST_MODE || "");
const test4kId = String(process.env.OMNI_4K_TEST_ID || "tt15239678").trim();
const test4kUrl = String(
  process.env.OMNI_4K_TEST_URL ||
    "https://pbs.github.io/test-streams/pbs/test-pattern/pbs-bars_av1-vp9-hevc-avc.m3u8"
).trim();

const manifest = {
  id: "org.flixit.local-runtime-harness",
  version: "1.2.0",
  name: "FlixIT Local Runtime Harness",
  description: "Local staging connectivity and public HLS quality test runtime",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: []
};

function json(res, status, payload) {
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
  if (test4kEnabled && type === "movie" && id === test4kId && test4kUrl) {
    return {
      streams: [
        {
          name: "FlixIT 4K Test",
          title: "PBS public 4K multicodec HLS test pattern",
          url: test4kUrl
        }
      ]
    };
  }

  return { streams: [] };
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?", 1)[0];
  if (req.method === "GET" && path === "/manifest.json") return json(res, 200, manifest);
  if (req.method === "GET" && path === "/health") {
    return json(res, 200, {
      ok: true,
      service: manifest.id,
      test4k: {
        enabled: test4kEnabled,
        id: test4kId,
        url: test4kEnabled ? test4kUrl : null
      }
    });
  }
  if (req.method === "GET") {
    const payload = streamResponse(path);
    if (payload) return json(res, 200, payload);
  }
  return json(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`[flixit-runtime] listening on http://${host}:${port}`);
  console.log(
    `[flixit-runtime] 4K test mode ${test4kEnabled ? `enabled for ${test4kId}` : "disabled"}`
  );
});

function shutdown(signal) {
  console.log(`[flixit-runtime] ${signal}; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
