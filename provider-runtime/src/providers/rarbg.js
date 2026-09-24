"use strict";

// Uses the original serenader2014/rarbg-api package directly.
const rarbgApi = require("rarbg-api");

const name = "RARBG API";

function parseStreamId(id) {
  const parts = String(id || "").split(":");
  return {
    imdbId: parts[0] || "",
    season: parts[1] ? Number.parseInt(parts[1], 10) : null,
    episode: parts[2] ? Number.parseInt(parts[2], 10) : null,
  };
}

function episodePattern(season, episode) {
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return null;
  return new RegExp(`S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`, "i");
}

async function getStreams(type, id) {
  const { imdbId, season, episode } = parseStreamId(id);
  if (!/^tt\d+$/i.test(imdbId)) return [];

  const results = await rarbgApi.search(
    imdbId,
    {
      limit: 50,
      sort: "seeders",
      format: "json_extended",
    },
    "imdb"
  );

  if (!Array.isArray(results)) return [];

  const pattern = type === "series" ? episodePattern(season, episode) : null;
  const filtered = pattern
    ? results.filter((item) => pattern.test(String(item.title || item.filename || "")))
    : results;

  return filtered
    .filter((item) => /^magnet:\?/i.test(String(item.download || "")))
    .map((item) => ({
      name,
      title: String(item.title || item.filename || "RARBG result"),
      magnet: String(item.download),
      seeders: Number(item.seeders || 0),
      leechers: Number(item.leechers || 0),
      size: Number(item.size || 0),
      category: item.category || null,
      pubdate: item.pubdate || null,
      source: "serenader2014/rarbg-api",
    }))
    .sort((a, b) => b.seeders - a.seeders);
}

module.exports = {
  name,
  getStreams,
};
