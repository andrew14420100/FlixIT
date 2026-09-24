"use strict";

const http = require("http");
const { MongoClient } = require("mongodb");

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "7001", 10);
const prefer4k = !/^(0|false|no|off)$/i.test(process.env.OMNI_PREFER_4K || "true");
const mongoEnabled = !/^(0|false|no|off)$/i.test(process.env.OMNI_MONGO_ENABLED || "true");
const mongoUrl = String(process.env.MONGO_URL || "mongodb://localhost:27017").trim();
const dbName = String(process.env.DB_NAME || "netflix_clone").trim();
const test4kEnabled = /^(1|true|yes|on)$/i.test(process.env.OMNI_4K_TEST_MODE || "");
const test4kId = String(process.env.OMNI_4K_TEST_ID || "tt15239678").trim();
const test4kUrl = String(
  process.env.OMNI_4K_TEST_URL ||
    "https://pbs.github.io/test-streams/pbs/test-pattern/pbs-bars_av1-vp9-hevc-avc.m3u8"
).trim();
const providerTimeoutMs = Math.max(1000, Number.parseInt(process.env.OMNI_PROVIDER_TIMEOUT_MS || "10000", 10) || 10000);
const mongoTimeoutMs = Math.max(1000, Number.parseInt(process.env.OMNI_MONGO_TIMEOUT_MS || "5000", 10) || 5000);
const maxProviders = Math.max(1, Math.min(20, Number.parseInt(process.env.OMNI_MAX_PROVIDERS || "12", 10) || 12));

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
    return /^https?:$/.test(parsed.protocol) ? raw : "";
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
  return [stream?.name, stream?.title, stream?.description, stream?.quality, stream?.language, hints?.filename, stream?.url]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function qualityScore(stream) {
  const text = streamText(stream);
  if (/\b(2160p|4k|uhd|3840x2160)\b/i.test(text)) return 5;
  if (/\b1440p\b/i.test(text)) return 4;
  if (/\b(1080p|fhd|full[ ._-]?hd)\b/i.test(text)) return 3;
  if (/\b720p\b/i.test(text)) return 2;
  if (/\b(576p|480p|sd)\b/i.test(text)) return 1;
  return 0;
}

function detectedQuality(stream) {
  return ["unknown", "SD", "720p", "1080p", "1440p", "2160p"][qualityScore(stream)] || "unknown";
}

function languageScore(stream) {
  const text = streamText(stream);
  if (/\b(ita|italian|italiano|it-it)\b/i.test(text)) return 3;
  if (/\b(multi|multiaudio|dual)\b/i.test(text)) return 2;
  if (/\b(eng|english|en-us|en-gb)\b/i.test(text)) return 0;
  return 1;
}

function streamTypeScore(stream) {
  const candidate = String(stream?.behaviorHints?.filename || stream?.url || "").toLowerCase();
  return candidate.includes(".m3u8") || candidate.includes("/hls/") ? 1 : 0;
}

function isPlayableHttpStream(stream) {
  const raw = String(stream?.url || "").trim();
  if (!raw) return false;
  try {
    return /^https?:$/.test(new URL(raw).protocol);
  } catch {
    return false;
  }
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null && String(value).trim()) out[String(key)] = String(value);
  }
  return out;
}

function localDocToStream(doc, fallbackName) {
  const url = String(doc?.url || doc?.stream_url || "").trim();
  if (!url) return null;
  const headers = normalizeHeaders(doc?.headers || {});
  const behaviorHints = { notWebReady: false };
  if (Object.keys(headers).length) behaviorHints.proxyHeaders = { request: headers };
  const stream = {
    name: String(doc?.name || doc?.provider || fallbackName || "FlixIT Local"),
    title: String(doc?.title || doc?.quality || ""),
    quality: String(doc?.quality || ""),
    language: String(doc?.language || doc?.lang || ""),
    url,
    behaviorHints,
    source: "flixit-mongo",
    providerPriority: Number(doc?.priority || 0),
  };
  stream.detectedQuality = detectedQuality(stream);
  return isPlayableHttpStream(stream) ? stream : null;
}

function normalizeHttpStreams(streams, providerUrl) {
  if (!Array.isArray(streams)) return [];
  let providerOrigin = "";
  try { providerOrigin = new URL(providerUrl).origin; } catch {}
  return streams.filter(isPlayableHttpStream).map((stream) => ({
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
  return streams.map((stream, index) => ({ stream, index })).sort((a, b) => {
    const aNotReady = Boolean(a.stream?.behaviorHints?.notWebReady);
    const bNotReady = Boolean(b.stream?.behaviorHints?.notWebReady);
    if (aNotReady !== bNotReady) return aNotReady ? 1 : -1;
    if (prefer4k) {
      const aq = qualityScore(a.stream);
      const bq = qualityScore(b.stream);
      if (aq !== bq) return bq - aq;
    }
    const al = languageScore(a.stream);
    const bl = languageScore(b.stream);
    if (al !== bl) return bl - al;
    const at = streamTypeScore(a.stream);
    const bt = streamTypeScore(b.stream);
    if (at !== bt) return bt - at;
    const ap = Number(a.stream?.providerPriority || 0);
    const bp = Number(b.stream?.providerPriority || 0);
    if (ap !== bp) return bp - ap;
    const as = Number(a.stream?.seeders || 0);
    const bs = Number(b.stream?.seeders || 0);
    if (as !== bs) return bs - as;
    return a.index - b.index;
  }).map((entry) => entry.stream);
}

async function getMongoDb() {
  if (!mongoEnabled || !mongoUrl || !dbName) return null;
  if (mongoDb) return mongoDb;
  if (mongoConnectPromise) return mongoConnectPromise;
  mongoConnectPromise = (async () => {
    const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: mongoTimeoutMs, connectTimeoutMS: mongoTimeoutMs });
    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      mongoClient = client;
      mongoDb = client.db(dbName);
      try {
        await mongoDb.collection("omni_api_providers").createIndex({ id: 1 }, { unique: true });
        await mongoDb.collection("omni_api_providers").createIndex({ enabled: 1, priority: -1 });
      } catch {}
      console.log(`[flixit-runtime] MongoDB connected: ${dbName}`);
      return mongoDb;
    } catch (error) {
      try { await client.close(); } catch {}
      throw error;
    }
  })().catch((error) => {
    console.error(`[flixit-runtime] MongoDB unavailable: ${error?.message || error}`);
    mongoConnectPromise = null;
    return null;
  });
  return mongoConnectPromise;
}

async function resolveTmdbId(db, imdbId, mediaType) {
  try {
    const external = await db.collection("external_ids").findOne(
      { imdb_id: imdbId, media_type: mediaType },
      { projection: { _id: 0, tmdbId: 1 } }
    );
    const value = Number(external?.tmdbId);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function fetchMongoStreams(type, id) {
  const identity = parseStreamIdentity(type, id);
  if (!/^tt\d+$/i.test(identity.imdbId)) return [];
  const db = await getMongoDb();
  if (!db) return [];
  const out = [];
  const omniQuery = { imdb_id: identity.imdbId, media_type: identity.mediaType, enabled: { $ne: false } };
  if (identity.mediaType === "tv") {
    omniQuery.season = identity.season;
    omniQuery.episode = identity.episode;
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
  const tmdbId = await resolveTmdbId(db, identity.imdbId, identity.mediaType);
  if (Number.isFinite(tmdbId)) {
    const query = {
      tmdbId,
      media_type: identity.mediaType,
      season: identity.mediaType === "tv" ? identity.season : null,
      episode: identity.mediaType === "tv" ? identity.episode : null,
    };
    try {
      const doc = await db.collection("stream_sources").findOne(query);
      const stream = localDocToStream(doc, "FlixIT Admin");
      if (stream) out.push(stream);
    } catch (error) {
      console.error(`[flixit-runtime] stream_sources lookup failed: ${error?.message || error}`);
    }
  }
  return normalizeHttpStreams(out, "http://flixit.local/mongo");
}

function getPath(value, path) {
  if (!path) return value;
  return String(path).split(".").filter(Boolean).reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[Number(key)];
    return acc[key];
  }, value);
}

function templateString(value, vars) {
  return String(value ?? "").replace(/\{(imdb_id|tmdb_id|media_type|type|season|episode)\}/g, (_, key) => {
    const mapped = key === "type" ? vars.media_type : vars[key];
    return mapped === undefined || mapped === null ? "" : String(mapped);
  });
}

function templateValue(value, vars) {
  if (typeof value === "string") return templateString(value, vars);
  if (Array.isArray(value)) return value.map((item) => templateValue(item, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, templateValue(item, vars)]));
  }
  return value;
}

function pickApiItems(data, provider) {
  const configured = getPath(data, provider.response_path || provider.responsePath || "");
  if (provider.response_path || provider.responsePath) return configured;
  const candidates = [
    data?.streams,
    data?.sources,
    data?.results,
    data?.items,
    data?.data?.streams,
    data?.data?.sources,
    data?.data?.results,
    data?.data?.items,
    data?.data,
    data,
  ];
  return candidates.find((value) => Array.isArray(value) || typeof value === "string" || (value && typeof value === "object"));
}

function fieldValue(item, configured, fallbacks) {
  if (configured) {
    const value = getPath(item, configured);
    if (value !== undefined && value !== null) return value;
  }
  for (const key of fallbacks) {
    const value = getPath(item, key);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function apiItemToStream(item, provider) {
  if (typeof item === "string") item = { url: item };
  if (!item || typeof item !== "object") return null;
  const url = String(fieldValue(item, provider.url_field, ["url", "stream_url", "stream", "src", "file", "link"]) || "").trim();
  if (!url) return null;
  const requestHeaders = normalizeHeaders(provider.playback_headers || provider.playbackHeaders || {});
  const itemHeaders = normalizeHeaders(fieldValue(item, provider.playback_headers_field, ["headers", "request_headers"]) || {});
  const headers = { ...requestHeaders, ...itemHeaders };
  const behaviorHints = { notWebReady: false };
  if (Object.keys(headers).length) behaviorHints.proxyHeaders = { request: headers };
  const title = String(fieldValue(item, provider.title_field, ["title", "name", "filename", "label"]) || "");
  const quality = String(fieldValue(item, provider.quality_field, ["quality", "resolution", "video_quality"]) || "");
  const language = String(fieldValue(item, provider.language_field, ["language", "lang", "audio", "audio_language"]) || "");
  const stream = {
    name: String(provider.name || provider.id || "API Provider"),
    title,
    quality,
    language,
    url,
    behaviorHints,
    source: `api:${provider.id}`,
    providerId: provider.id,
    providerPriority: Number(provider.priority || 0),
  };
  stream.detectedQuality = detectedQuality(stream);
  return isPlayableHttpStream(stream) ? stream : null;
}

async function fetchApiProvider(provider, type, id, forcedDb = null) {
  const identity = parseStreamIdentity(type, id);
  if (!/^tt\d+$/i.test(identity.imdbId)) return [];
  const db = forcedDb || await getMongoDb();
  if (!db) return [];
  const supported = Array.isArray(provider.supports) ? provider.supports.map(String) : [];
  if (supported.length && !supported.includes(identity.mediaType) && !supported.includes(type)) return [];
  const tmdbId = await resolveTmdbId(db, identity.imdbId, identity.mediaType);
  const vars = {
    imdb_id: identity.imdbId,
    tmdb_id: tmdbId ?? "",
    media_type: identity.mediaType,
    season: identity.season ?? "",
    episode: identity.episode ?? "",
  };
  const endpoint = templateString(provider.endpoint || provider.url || "", vars);
  let target;
  try {
    target = new URL(endpoint);
    if (!/^https?:$/.test(target.protocol)) return [];
  } catch {
    return [];
  }
  const query = templateValue(provider.query || {}, vars);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && String(value) !== "") target.searchParams.set(key, String(value));
  }
  const method = String(provider.method || "GET").toUpperCase();
  const headers = {
    Accept: "application/json",
    "User-Agent": "FlixIT-Omni-API/1.7",
    ...normalizeHeaders(templateValue(provider.headers || {}, vars)),
  };
  const timeout = Math.max(1000, Math.min(30000, Number(provider.timeout_ms || provider.timeoutMs || providerTimeoutMs) || providerTimeoutMs));
  const options = { method, headers, redirect: "follow", signal: AbortSignal.timeout(timeout) };
  if (!["GET", "HEAD"].includes(method)) {
    options.headers["Content-Type"] = options.headers["Content-Type"] || "application/json";
    options.body = JSON.stringify(templateValue(provider.body || {}, vars));
  }
  try {
    const response = await fetch(target, options);
    if (response.status === 404) return [];
    if (!response.ok) {
      console.error(`[flixit-runtime] API provider ${provider.id} returned HTTP ${response.status}`);
      return [];
    }
    const data = await response.json();
    let items = pickApiItems(data, provider);
    if (items === undefined || items === null) return [];
    if (!Array.isArray(items)) items = [items];
    return items.map((item) => apiItemToStream(item, provider)).filter(Boolean);
  } catch (error) {
    console.error(`[flixit-runtime] API provider ${provider.id} failed: ${error?.message || error}`);
    return [];
  }
}

async function fetchDynamicApiStreams(type, id) {
  const db = await getMongoDb();
  if (!db) return [];
  let providers = [];
  try {
    providers = await db.collection("omni_api_providers")
      .find({ enabled: { $ne: false } }, { projection: { _id: 0 } })
      .sort({ priority: -1, name: 1 })
      .limit(maxProviders)
      .toArray();
  } catch (error) {
    console.error(`[flixit-runtime] omni_api_providers lookup failed: ${error?.message || error}`);
    return [];
  }
  const settled = await Promise.allSettled(providers.map((provider) => fetchApiProvider(provider, type, id, db)));
  return settled.flatMap((entry) => entry.status === "fulfilled" && Array.isArray(entry.value) ? entry.value : []);
}

function localOrigins() {
  return new Set([`http://${host}:${port}`, `http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

async function fetchOneProvider(providerUrl, type, id) {
  let upstream;
  try { upstream = new URL(providerUrl); } catch { return []; }
  if (localOrigins().has(upstream.origin)) return [];
  const target = `${providerUrl}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "FlixIT-Omni-Bridge/1.7" },
      redirect: "follow",
      signal: AbortSignal.timeout(providerTimeoutMs),
    });
    if (response.status === 404) return [];
    if (!response.ok) return [];
    const data = await response.json();
    return data && Array.isArray(data.streams) ? normalizeHttpStreams(data.streams, providerUrl) : [];
  } catch {
    return [];
  }
}

async function fetchProviderStreams(type, id) {
  const jobs = [fetchMongoStreams(type, id), fetchDynamicApiStreams(type, id)];
  for (const providerUrl of providerUrls) jobs.push(fetchOneProvider(providerUrl, type, id));
  const settled = await Promise.allSettled(jobs);
  const merged = settled.flatMap((entry) => entry.status === "fulfilled" && Array.isArray(entry.value) ? entry.value : []);
  return { streams: rankStreams(dedupeStreams(merged)) };
}

const manifest = {
  id: "org.flixit.local-runtime-harness",
  version: "1.7.0",
  name: "FlixIT Omni Runtime",
  description: "Mongo + configurable API + Stremio HTTP aggregator with automatic 4K-first selection",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function isLocalRequest(req) {
  const value = String(req.socket?.remoteAddress || "");
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

async function readJsonBody(req, maxBytes = 256 * 1024) {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("invalid_json")); }
    });
    req.on("error", reject);
  });
}

function sanitizeProvider(doc) {
  if (!doc) return doc;
  const out = { ...doc };
  delete out._id;
  const masked = {};
  for (const [key, value] of Object.entries(out.headers || {})) {
    masked[key] = /authorization|api[-_]?key|token|secret/i.test(key) ? "***" : value;
  }
  out.headers = masked;
  return out;
}

function validateProvider(input) {
  const id = String(input?.id || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(id)) throw new Error("invalid_id");
  const endpoint = String(input?.endpoint || input?.url || "").trim();
  const probe = templateString(endpoint, { imdb_id: "tt123", tmdb_id: "123", media_type: "movie", season: "1", episode: "1" });
  try {
    const parsed = new URL(probe);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("invalid_endpoint");
  } catch {
    throw new Error("invalid_endpoint");
  }
  const method = String(input?.method || "GET").toUpperCase();
  if (!["GET", "POST", "PUT"].includes(method)) throw new Error("invalid_method");
  return {
    id,
    name: String(input?.name || id).trim(),
    enabled: input?.enabled !== false,
    priority: Number(input?.priority || 0),
    endpoint,
    method,
    headers: normalizeHeaders(input?.headers || {}),
    query: input?.query && typeof input.query === "object" ? input.query : {},
    body: input?.body && typeof input.body === "object" ? input.body : {},
    response_path: String(input?.response_path || input?.responsePath || "").trim(),
    url_field: String(input?.url_field || input?.urlField || "").trim(),
    title_field: String(input?.title_field || input?.titleField || "").trim(),
    quality_field: String(input?.quality_field || input?.qualityField || "").trim(),
    language_field: String(input?.language_field || input?.languageField || "").trim(),
    playback_headers_field: String(input?.playback_headers_field || input?.playbackHeadersField || "").trim(),
    playback_headers: normalizeHeaders(input?.playback_headers || input?.playbackHeaders || {}),
    supports: Array.isArray(input?.supports) ? input.supports.map(String) : ["movie", "tv"],
    timeout_ms: Math.max(1000, Math.min(30000, Number(input?.timeout_ms || input?.timeoutMs || providerTimeoutMs) || providerTimeoutMs)),
  };
}

async function handleProviderAdmin(req, res, path) {
  if (!path.startsWith("/providers")) return false;
  if (!isLocalRequest(req)) {
    json(res, 403, { error: "local_only" });
    return true;
  }
  const db = await getMongoDb();
  if (!db) {
    json(res, 503, { error: "mongo_unavailable" });
    return true;
  }
  if (req.method === "GET" && path === "/providers") {
    const docs = await db.collection("omni_api_providers").find({}, { projection: { _id: 0 } }).sort({ priority: -1, name: 1 }).toArray();
    json(res, 200, { items: docs.map(sanitizeProvider), count: docs.length });
    return true;
  }
  if (req.method === "POST" && path === "/providers") {
    try {
      const body = await readJsonBody(req);
      const provider = validateProvider(body);
      const now = new Date().toISOString();
      await db.collection("omni_api_providers").updateOne(
        { id: provider.id },
        { $set: { ...provider, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
      json(res, 200, { success: true, provider: sanitizeProvider(provider) });
    } catch (error) {
      json(res, 400, { error: error?.message || "invalid_provider" });
    }
    return true;
  }
  const testMatch = path.match(/^\/providers\/([a-z0-9._-]+)\/test$/i);
  if (req.method === "POST" && testMatch) {
    const provider = await db.collection("omni_api_providers").findOne({ id: testMatch[1] }, { projection: { _id: 0 } });
    if (!provider) {
      json(res, 404, { error: "provider_not_found" });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const type = body.type === "series" || body.type === "tv" ? "series" : "movie";
      const id = String(body.id || body.imdb_id || "").trim();
      if (!/^tt\d+(?::\d+:\d+)?$/i.test(id)) throw new Error("invalid_imdb_id");
      const streams = await fetchApiProvider(provider, type, id, db);
      json(res, 200, { success: true, provider: provider.id, streams: rankStreams(streams) });
    } catch (error) {
      json(res, 400, { error: error?.message || "test_failed" });
    }
    return true;
  }
  const deleteMatch = path.match(/^\/providers\/([a-z0-9._-]+)$/i);
  if (req.method === "DELETE" && deleteMatch) {
    const result = await db.collection("omni_api_providers").deleteOne({ id: deleteMatch[1] });
    json(res, result.deletedCount ? 200 : 404, { success: Boolean(result.deletedCount), deleted: result.deletedCount });
    return true;
  }
  json(res, 404, { error: "not_found" });
  return true;
}

async function providerInfo() {
  let dynamicCount = 0;
  try {
    const db = await getMongoDb();
    if (db) dynamicCount = await db.collection("omni_api_providers").countDocuments({ enabled: { $ne: false } });
  } catch {}
  return {
    configured: mongoEnabled || providerUrls.length > 0 || dynamicCount > 0,
    remoteCount: providerUrls.length,
    dynamicApiCount: dynamicCount,
    localMongo: {
      enabled: mongoEnabled,
      connected: Boolean(mongoDb),
      database: dbName,
      collections: ["omni_stream_sources", "stream_sources", "omni_api_providers"],
    },
    prefer4k,
    timeoutMs: providerTimeoutMs,
    maxProviders,
  };
}

async function streamResponse(path) {
  const match = path.match(/^\/stream\/(movie|series)\/([^/]+)\.json$/);
  if (!match) return null;
  const [, type, id] = match;
  if (test4kEnabled && type === "movie" && id === test4kId && test4kUrl) {
    return { streams: [{ name: "FlixIT 4K Test", title: "PBS public 4K multicodec HLS test pattern", url: test4kUrl, detectedQuality: "2160p" }] };
  }
  return fetchProviderStreams(type, id);
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?", 1)[0];
  try {
    if (await handleProviderAdmin(req, res, path)) return;
    if (req.method === "GET" && path === "/manifest.json") return json(res, 200, manifest);
    if (req.method === "GET" && path === "/health") {
      return json(res, 200, {
        ok: true,
        service: manifest.id,
        version: manifest.version,
        qualityOrder: prefer4k ? ["2160p", "1440p", "1080p", "720p", "SD"] : "provider-order",
        languageOrder: ["ITA", "MULTI", "UNKNOWN", "ENG"],
        test4k: { enabled: test4kEnabled, id: test4kId, url: test4kEnabled ? test4kUrl : null },
        provider: await providerInfo(),
      });
    }
    if (req.method === "GET") {
      const payload = await streamResponse(path);
      if (payload) return json(res, 200, payload);
    }
    return json(res, 404, { error: "not_found" });
  } catch (error) {
    console.error(`[flixit-runtime] request failed: ${error?.stack || error}`);
    return json(res, 500, { error: "internal_error" });
  }
});

server.listen(port, host, () => {
  console.log(`[flixit-runtime] listening on http://${host}:${port}`);
  console.log(`[flixit-runtime] version ${manifest.version}`);
  console.log(`[flixit-runtime] dynamic API providers collection: omni_api_providers`);
  console.log(`[flixit-runtime] prefer 4K ${prefer4k ? "enabled" : "disabled"}`);
  if (mongoEnabled) getMongoDb().catch(() => {});
});

async function closeMongo() {
  if (!mongoClient) return;
  try { await mongoClient.close(); } catch {}
  mongoClient = null;
  mongoDb = null;
  mongoConnectPromise = null;
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
