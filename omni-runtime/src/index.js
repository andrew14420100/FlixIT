"use strict";

// Stremio-compatible localhost bridge used by FlixIT.
//
// - Optional 4K test mode keeps the public PBS test pattern available for
//   end-to-end player validation.
// - Optional OMNI_PROVIDER_URL forwards normal /stream requests to an
//   authorized Stremio-compatible HTTP provider.
// - When OMNI_PREFER_4K is enabled (default), playable streams are ordered by
//   detected quality: 2160p/4K, 1440p, 1080p, 720p, then the remaining streams.
// - No scraping, torrent resolution or debrid logic lives in this runtime.
const http = require("http");

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "7001", 10);
const test4kEnabled = /^(1|true|yes|on)$/i.test(process.env.OMNI_4K_TEST_MODE || "");
const prefer4k = !/^(0|false|no|off)$/i.test(process.env.OMNI_PREFER_4K || "true");
const test4kId = String(process.env.OMNI_4K_TEST_ID || "tt15239678").trim();
const test4kUrl = String(
  process.env.OMNI_4K_TEST_URL ||
    "https://pbs.github.io/test-streams/pbs/test-pattern/pbs-bars_av1-vp9-hevc-avc.m3u8"
).trim();
const providerTimeoutMs = Math.max(
  1000,
  Number.parseInt(process.env.OMNI_PROVIDER_TIMEOUT_MS || "10000", 10) || 10000
);

function normalizeProviderUrl(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.endsWith("/manifest.json")) raw = raw.slice(0, -"/manifest.json".length);
  raw = raw.replace(/\/+$/, "");
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    return raw;
  } catch {
    return "";
  }
}

function streamText(stream) {
  const hints = stream && typeof stream.behaviorHints === "object" ? stream.behaviorHints : {};
  return [
    stream?.name,
    stream?.title,
    stream?.description,
    hints?.filename,
    stream?.url
  ].filter(Boolean).join(" ").toLowerCase();
}

function qualityScore(stream) {
  const text = streamText(stream);
  if (/\b(2160p|4k|uhd)\b/i.test(text)) return 400;
  if (/\b1440p\b/i.test(text)) return 300;
  if (/\b(1080p|fhd|full[ ._-]?hd)\b/i.test(text)) return 200;
  if (/\b720p\b/i.test(text)) return 100;
  if (/\b(576p|480p|sd)\b/i.test(text)) return 50;
  return 0;
}

function streamTypeScore(stream) {
  const hints = stream && typeof stream.behaviorHints === "object" ? stream.behaviorHints : {};
  const candidate = String(hints?.filename || stream?.url || "").toLowerCase();
  return candidate.includes(".m3u8") || candidate.includes("/hls/") ? 20 : 0;
}

function rankStreams(streams) {
  if (!prefer4k || !Array.isArray(streams)) return streams || [];
  return streams
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => {
      const aNotWebReady = Boolean(a.stream?.behaviorHints?.notWebReady);
      const bNotWebReady = Boolean(b.stream?.behaviorHints?.notWebReady);
      if (aNotWebReady !== bNotWebReady) return aNotWebReady ? 1 : -1;

      const aScore = qualityScore(a.stream) + streamTypeScore(a.stream);
      const bScore = qualityScore(b.stream) + streamTypeScore(b.stream);
      if (aScore !== bScore) return bScore - aScore;
      return a.index - b.index;
    })
    .map((entry) => entry.stream);
}

const providerUrl = normalizeProviderUrl(process.env.OMNI_PROVIDER_URL);

const manifest = {
  id: "org.flixit.local-runtime-harness",
  version: "1.4.0",
  name: "FlixIT Local Runtime Bridge",
  description: "Local Stremio-compatible bridge for authorized HTTP stream providers with 4K preference",
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

function providerInfo() {
  if (!providerUrl) return { configured: false, prefer4k };
  try {
    const parsed = new URL(providerUrl);
    return { configured: true, origin: parsed.origin, prefer4k };
  } catch {
    return { configured: false, prefer4k };
  }
}

async function fetchProviderStreams(type, id) {
  if (!providerUrl) return { streams: [] };

  const localOrigins = new Set([
    `http://${host}:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`
  ]);
  let upstream;
  try {
    upstream = new URL(providerUrl);
  } catch {
    return { streams: [] };
  }
  if (localOrigins.has(upstream.origin)) {
    console.error("[flixit-runtime] OMNI_PROVIDER_URL points back to this runtime; refusing recursive proxy");
    return { streams: [] };
  }

  const target = `${providerUrl}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "FlixIT-Omni-Bridge/1.1"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(providerTimeoutMs)
    });

    if (response.status === 404) return { streams: [] };
    if (!response.ok) {
      console.error(`[flixit-runtime] provider returned HTTP ${response.status}`);
      return { streams: [] };
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.streams)) return { streams: [] };

    // Preserve standard Stremio stream objects. FlixIT's backend performs the
    // final HTTP(S)-URL validation and ignores unsupported torrent-only items.
    return { streams: rankStreams(data.streams) };
  } catch (error) {
    const message = error && error.name === "TimeoutError"
      ? `timeout after ${providerTimeoutMs}ms`
      : (error?.message || String(error));
    console.error(`[flixit-runtime] provider request failed: ${message}`);
    return { streams: [] };
  }
}

async function streamResponse(path) {
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

  return fetchProviderStreams(type, id);
}

const server = http.createServer(async (req, res) => {
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
      },
      provider: providerInfo()
    });
  }
  if (req.method === "GET") {
    const payload = await streamResponse(path);
    if (payload) return json(res, 200, payload);
  }
  return json(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`[flixit-runtime] listening on http://${host}:${port}`);
  console.log(
    `[flixit-runtime] 4K test mode ${test4kEnabled ? `enabled for ${test4kId}` : "disabled"}`
  );
  console.log(
    `[flixit-runtime] provider bridge ${providerUrl ? "configured" : "disabled (OMNI_PROVIDER_URL not set)"}`
  );
  console.log(`[flixit-runtime] prefer 4K ${prefer4k ? "enabled" : "disabled"}`);
});

function shutdown(signal) {
  console.log(`[flixit-runtime] ${signal}; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
