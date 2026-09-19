"use strict";

// Infrastructure-only Stremio-compatible harness used to validate FastAPI <->
// Node localhost lifecycle. No provider or scraping implementation lives here.
const http = require("http");

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "7001", 10);
const manifest = {
  id: "org.flixit.local-runtime-harness",
  version: "1.0.0",
  name: "FlixIT Local Runtime Harness",
  description: "Local staging connectivity test runtime",
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

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?", 1)[0];
  if (req.method === "GET" && path === "/manifest.json") return json(res, 200, manifest);
  if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true, service: manifest.id });
  if (req.method === "GET" && /^\/stream\/(movie|series)\/[^/]+\.json$/.test(path)) {
    return json(res, 200, { streams: [] });
  }
  return json(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`[flixit-runtime] listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`[flixit-runtime] ${signal}; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
