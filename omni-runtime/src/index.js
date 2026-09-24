"use strict";

// FlixIT Omni runtime.
//
// Sources:
// - existing authorized HTTP/HLS streams stored in MongoDB collections
//   `omni_stream_sources` and `stream_sources`;
// - optional remote Stremio-compatible HTTP providers from OMNI_PROVIDER_URLS;
// - optional public 4K test stream for end-to-end validation.
//
// Streams are merged, deduplicated and ranked 4K-first. No torrent resolution,
// scraping or debrid logic lives in this runtime.
const http = require("http");
const { MongoClient } = require("mongodb");

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "7001", 10);
const test4kEnabled = /^(1|true|yes|on)$/i.test(process.env.OMNI_4K_TEST_MODE || "");
const prefer4k = !/^(0|false|no|off)$/i.test(process.env.OMNI_PREFER_4K || "true");
const mongoEnabled = !/^(0|false|no|off)$/i.test(process.env.OMNI_MONGO_ENABLED || "true");
const mongoUrl = String(process.env.MONGO_URL || "mongodb://localhost:27017").trim();
const dbName = String(process.env.DB_NAME || "netflix_clone").trim();
const test4kId = String(process.env.OMNI_4K_TEST_ID || "tt15239678").trim();
const test4kUrl = String(
  process.env.OMNI_4K_TEST_URL ||
    "https://pbs.github.io/test-streams/pbs/test-pattern/pbs-bars_av1-vp9-hevc-avc.m3u8"
).trim();
const providerTimeoutMs = Math.max(
  1000,
  Number.parseInt(process.env.OMNI_PROVIDER_TIMEOUT_MS || "10000", 10) || 10000
);
const mongoTimeoutMs = Math.max(
  1000,
  Number.parseInt(process.env.OMNI_MONGO_TIMEOUT_MS || "5000", 10) || 5000
);
const maxProviders = Math.max(
  1,
  Math.min(12, Number.parseInt(process.env.OMNI_MAX_PROVIDERS || "8", 10) || 8)
);

let mongoClient = null;
let mongoDb = null;
let mongoConnectPromise = null;

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

function parseStreamIdentity(type, id) {
  const parts = String(id || "").split(":");
  const imdbId = parts[0] || "";
  const season = type === "series" && parts[1] ? Number.parseInt(parts[1], 10) : null;
  const episode = type === "series" && parts[2] ? Number.parseInt(parts[2], 10) : null;
  return {
    imdbId,
    mediaType: type === "series" ? "tv" : "movie",
    season: Number.isInteger(season) ? season : null,
    episode: Number.isInteger(episode) ? episode : null,
  };
}

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

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      out[String(key)] = String(value);
    }
  }
  return out;
}

function localDocToStream(doc, fallbackName) {
  const url = String(doc?.url || doc?.stream_url || "").trim();
  if (!url) return null;
  const headers = normalizeHeaders(doc?.headers || {});
  const behaviorHints = {
    notWebReady: false,
  };
  if (Object.keys(headers).length > 0) {
    behaviorHints.proxyHeaders = { request: headers };
  }

  const stream = {
    name: String(doc?.name || doc?.provider || fallbackName || "FlixIT Local"),
    title: String(doc?.title || doc?.quality || ""),
    quality: String(doc?.quality || ""),
    url,
    behaviorHints,
    source: "flixit-mongo",
  };
  stream.detectedQuality = detectedQuality(stream);
  return isPlayableHttpStream(stream) ? stream : null;
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

async function getMongoDb() {
  if (!mongoEnabled || !mongoUrl || !dbName) return null;
  if (mongoDb) return mongoDb;
  if (mongoConnectPromise) return mongoConnectPromise;

  mongoConnectPromise = (async () => {
    const client = new MongoClient(mongoUrl, {
      serverSelectionTimeoutMS: mongoTimeoutMs,
      connectTimeoutMS: mongoTimeoutMs,
    });
    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      mongoClient = client;
      mongoDb = client.db(dbName);
      console.log(`[flixit-runtime] MongoDB connected: ${dbName}`);
      return mongoDb;
    } catch (error) {
      try {
        await client.close();
      } catch {}
      throw error;
    }
  })().catch((error) => {
    console.error(`[flixit-runtime] MongoDB source unavailable: ${error?.message || error}`);
    mongoConnectPromise = null;
    return null;
  });

  return mongoConnectPromise;
}

async function fetchMongoStreams(type, id) {
  const { imdbId, mediaType, season, episode } = parseStreamIdentity(type, id);
  if (!/^tt\d+$/i.test(imdbId)) return [];

  const db = await getMongoDb();
  if (!db) return [];

  const out = [];
  const omniQuery = {
    imdb_id: imdbId,
    media_type: mediaType,
    enabled: { $ne: false },
  };

  if (mediaType === "tv") {
    omniQuery.season = season;
    omniQuery.episode = episode;
  } else {
    omniQuery.season = { $in: [null, 0] };
    omniQuery.episode = { $in: [null, 0] };
  }

  try {
    const docs = await db.collection("omni_stream_sources").find(omniQuery).limit(50).toArray();
    for (const doc of docs) {
      const stream = localDocToStream(doc, "FlixIT Embedded");
      if (stream) out.push(stream);
    }
  } catch (error) {
    console.error(`[flixit-runtime] omni_stream_sources lookup failed: ${error?.message || error}`);
  }

  let tmdbId = null;
  try {
    const external = await db.collection("external_ids").findOne(
      { imdb_id: imdbId, media_type: mediaType },
      { projection: { _id: 0, tmdbId: 1 } }
    );
    if (external?.tmdbId !== undefined && external?.tmdbId !== null) {
      tmdbId = Number(external.tmdbId);
    }
  } catch (error) {
    console.error(`[flixit-runtime] external_ids lookup failed: ${error?.message || error}`);
  }

  if (Number.isFinite(tmdbId)) {
    const adminQuery = {
      tmdbId,
      media_type: mediaType,
      season: mediaType === "tv" ? season : null,
      episode: mediaType === "tv" ? episode : null,
    };
    try {
      const doc = await db.collection("stream_sources").findOne(adminQuery);
      const stream = localDocToStream(doc, "FlixIT Admin");
      if (stream) out.push(stream);
    } catch (error) {
      console.error(`[flixit-runtime] stream_sources lookup failed: ${error?.message || error}`);
    }
  }

  return normalizeHttpStreams(out, "http://flixit.local/mongo");
}

const manifest = {
  id: "org.flixit.local-runtime-harness",
  version: "1.6.0",
  name: "FlixIT Omni Runtime",
  description: "Local Mongo + multi-provider HTTP stream aggregator with 4K-first ranking",
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
    configured: mongoEnabled || providerUrls.length > 0,
    remoteCount: providerUrls.length,
    localMongo: {
      enabled: mongoEnabled,
      connected: Boolean(mongoDb),
      database: dbName,
      collections: ["omni_stream_sources", "stream_sources"],
    },
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
        "User-Agent": "FlixIT-Omni-Bridge/1.6"
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
  const jobs = [fetchMongoStreams(type, id)];
  for (const providerUrl of providerUrls) {
    jobs.push(fetchOneProvider(providerUrl, type, id));
  }

  const settled = await Promise.allSettled(jobs);
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
    `[flixit-runtime] local Mongo sources ${mongoEnabled ? `enabled (${dbName})` : "disabled"}`
  );
  console.log(
    `[flixit-runtime] remote providers ${providerUrls.length > 0 ? `configured: ${providerUrls.length}` : "none"}`
  );
  console.log(`[flixit-runtime] prefer 4K ${prefer4k ? "enabled" : "disabled"}`);

  if (mongoEnabled) {
    getMongoDb().catch(() => {});
  }
});

async function closeMongo() {
  if (mongoClient) {
    try {
      await mongoClient.close();
    } catch {}
    mongoClient = null;
    mongoDb = null;
    mongoConnectPromise = null;
  }
}

function shutdown(signal) {
  console.log(`[flixit-runtime] ${signal}; shutting down`);
  server.close(async () => {
    await closeMongo();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
