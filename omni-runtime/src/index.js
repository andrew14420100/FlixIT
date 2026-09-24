"use strict";

// Stremio-compatible localhost bridge used by FlixIT.
//
// - Optional 4K test mode keeps the public PBS test pattern available for
//   end-to-end player validation.
// - OMNI_PROVIDER_URLS can contain multiple authorized Stremio-compatible
//   HTTP providers (comma, semicolon or newline separated).
// - Legacy OMNI_PROVIDER_URL remains supported and is merged into the list.
// - Providers are queried in parallel, playable HTTP(S) streams are merged,
//   deduplicated and ranked by detected quality.
// - When OMNI_PREFER_4K is enabled (default), streams are ordered as
//   2160p/4K/UHD, 1440p, 1080p, 720p, then the remaining streams.
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
const maxProviders = Math.max(
  1,
  Math.min(12, Number.parseInt(process.env.OMNI_MAX_PROVIDERS || "8", 10) || 8)
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

function parseProviderUrls() {
  const values = [];
  const multi = String(process.env.OMNI_PROVIDER_URLS || "");
  if (multi.trim()) values.push(...multi.split(/[,;\n]+/));

  const legacy = String(process.env.OMNI_PROVIDER_URL || "").trim();
  if (legacy) values.push(legacy);

  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeProviderUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxProviders) break;
  }
  return out;
}

const providerUrls = parseProviderUrls();

function streamText(stream) {
  const hints = stream && typeof stream.behaviorHints === "object" ? stream.behaviorHints : {};
  return [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.quality,
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

function detectedQuality(stream) {
  const score = qualityScore(stream);
  if (score >= 400) return "2160p";
  if (score >= 300) return "1440p";
  if (score >= 200) return "1080p";
  if (score >= 100) return "720p";
  if (score >= 50) return "SD";
  return "unknown";
}

function streamTypeScore(stream) {
  const hints = stream && typeof stream.behaviorHints === "object" ? stream.behaviorHints : {};
  const candidate = String(hints?.filename || stream?.url || "").toLowerCase();
  return candidate.includes(".m3u8") || candidate.includes("/hls/") ? 20 : 0;
}

function isPlayableHttpStream(stream) {
  if (!stream || typeof stream !== "object") return false;
  const raw = String(stream.url || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return /^https?:$/.test(parsed.protocol);
  } catch {
    return false;
  }
}

function normalizeHttpStreams(streams, providerUrl) {
  if (!Array.isArray(streams)) return [];
  let providerOrigin = "";
  try {
    providerOrigin = new URL(providerUrl).origin;
  } catch {
    providerOrigin = "";
  }

  return streams
    .filter(isPlayableHttpStream)
    .map((stream) => ({
      ...stream,
      detectedQuality: stream.detectedQuality || detectedQuality(stream),
      providerOrigin: stream.providerOrigin || providerOrigin || undefined,
    }));
}

function dedupeStreams(streams) {
  const seen = new Set();
  const out = [];
  for (const stream of streams) {
    const key = String(stream?.url || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(stream);
  }
  return out;
}

function rankStreams(streams) {
  if (!Array.isArray(streams)) return [];
  if (!prefer4k) return streams;

  return streams
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => {
      const aNotWebReady = Boolean(a.stream?.behaviorHints?.notWebReady);
      const bNotWebReady = Boolean(b.stream?.behaviorHints?.notWebReady);
      if (aNotWebReady !== bNotWebReady) return aNotWebReady ? 1 : -1;

      const aScore = qualityScore(a.stream) + streamTypeScore(a.stream);
      const bScore = qualityScore(b.stream) + streamTypeScore(b.stream);
      if (aScore !== bScore) return bScore - aScore;

      const aSeeders = Number(a.stream?.seeders || 0);
      const bSeeders = Number(b.stream?.seeders || 0);
      if (aSeeders !== bSeeders) return bSeeders - aSeeders;

      return a.index - b.index;
    })
    .map((entry) => entry.stream);
}

const manifest = {
  id: "org.flixit.local-runtime-harness",
  version: "1.5.0",
  name: "FlixIT Omni Runtime",
  description: "Multi-provider HTTP stream aggregator with 4K-first ranking",
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

function localOrigins() {
  return new Set([
    `http://${host}:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`
  ]);
}

function providerInfo() {
  return {
    configured: providerUrls.length > 0,
    count: providerUrls.length,
    prefer4k,
    timeoutMs: providerTimeoutMs,
    maxProviders,
    providers: providerUrls.map((value) => {
      try {
        return { origin: new URL(value).origin };
      } catch {
        return { origin: "invalid" };
      }
    })
  };
}

async function fetchOneProvider(providerUrl, type, id) {
  let upstream;
  try {
    upstream = new URL(providerUrl);
  } catch {
    return [];
  }

  if (localOrigins().has(upstream.origin)) {
    console.error(`[flixit-runtime] refusing recursive provider: ${upstream.origin}`);
    return [];
  }

  const target = `${providerUrl}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "FlixIT-Omni-Bridge/1.5"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(providerTimeoutMs)
    });

    if (response.status === 404) return [];
    if (!response.ok) {
      console.error(`[flixit-runtime] provider ${upstream.origin} returned HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.streams)) return [];
    return normalizeHttpStreams(data.streams, providerUrl);
  } catch (error) {
    const message = error && error.name === "TimeoutError"
      ? `timeout after ${providerTimeoutMs}ms`
      : (error?.message || String(error));
    console.error(`[flixit-runtime] provider ${upstream.origin} failed: ${message}`);
    return [];
  }
}

async function fetchProviderStreams(type, id) {
  if (providerUrls.length === 0) return { streams: [] };

  const settled = await Promise.allSettled(
    providerUrls.map((providerUrl) => fetchOneProvider(providerUrl, type, id))
  );

  const merged = settled.flatMap((entry) =>
    entry.status === "fulfilled" && Array.isArray(entry.value) ? entry.value : []
  );

  return { streams: rankStreams(dedupeStreams(merged)) };
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
          url: test4kUrl,
          detectedQuality: "2160p"
        }
      ]
    };
  }

  return fetchProviderStreams(type, id);
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?", 1)[0];

  if (req.method === "GET" && path === "/manifest.json") {
    return json(res, 200, manifest);
  }

  if (req.method === "GET" && path === "/health") {
    return json(res, 200, {
      ok: true,
      service: manifest.id,
      version: manifest.version,
      qualityOrder: prefer4k ? ["2160p", "1440p", "1080p", "720p", "SD"] : "provider-order",
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
  console.log(`[flixit-runtime] version ${manifest.version}`);
  console.log(
    `[flixit-runtime] 4K test mode ${test4kEnabled ? `enabled for ${test4kId}` : "disabled"}`
  );
  console.log(
    `[flixit-runtime] providers ${providerUrls.length > 0 ? `configured: ${providerUrls.length}` : "disabled (OMNI_PROVIDER_URLS not set)"}`
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
