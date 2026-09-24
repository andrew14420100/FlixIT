# FlixIT Omni — configurable API providers

Omni 1.7 can read stream providers from the MongoDB collection `omni_api_providers`.
The management endpoints are exposed only on the local Omni runtime (`127.0.0.1:7001`).

Use providers only for media you are authorized to stream.

## Add or update a provider

```bash
curl -s -X POST http://127.0.0.1:7001/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-provider",
    "name": "My Provider",
    "enabled": true,
    "priority": 100,
    "endpoint": "https://api.example.com/v1/streams",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer YOUR_API_KEY"
    },
    "query": {
      "imdb": "{imdb_id}",
      "tmdb": "{tmdb_id}",
      "type": "{media_type}",
      "season": "{season}",
      "episode": "{episode}"
    },
    "response_path": "streams",
    "url_field": "url",
    "title_field": "title",
    "quality_field": "quality",
    "language_field": "language",
    "supports": ["movie", "tv"]
  }' | python -m json.tool
```

Available placeholders: `{imdb_id}`, `{tmdb_id}`, `{media_type}`, `{type}`, `{season}`, `{episode}`.
They can be used in the endpoint, headers, query parameters and JSON request body.

If `response_path` or field names are omitted, Omni also tries common shapes automatically (`streams`, `sources`, `results`, `items`, `data`) and common URL fields (`url`, `stream_url`, `stream`, `src`, `file`, `link`).

## List configured providers

```bash
curl -s http://127.0.0.1:7001/providers | python -m json.tool
```

Sensitive request-header values such as Authorization/API keys are masked in the listing.

## Test a provider

Movie:

```bash
curl -s -X POST http://127.0.0.1:7001/providers/my-provider/test \
  -H 'Content-Type: application/json' \
  -d '{"type":"movie","id":"tt1234567"}' | python -m json.tool
```

TV episode:

```bash
curl -s -X POST http://127.0.0.1:7001/providers/my-provider/test \
  -H 'Content-Type: application/json' \
  -d '{"type":"series","id":"tt1234567:1:2"}' | python -m json.tool
```

## Delete a provider

```bash
curl -s -X DELETE http://127.0.0.1:7001/providers/my-provider | python -m json.tool
```

## Automatic playback

The normal FlixIT player endpoint does not change. When the user presses **Guarda**, the backend calls Omni. Omni queries local Mongo sources, configured API providers and optional Stremio-compatible HTTP providers in parallel, keeps only playable HTTP/HTTPS streams, deduplicates them, and ranks them in this order:

1. 2160p / 4K / UHD
2. 1440p
3. 1080p
4. 720p
5. SD

Within the same quality it prefers Italian, then multi-audio, then unknown language, then explicit English, with HLS preferred as a further tie-breaker.

Torrent/magnet results are not converted into player streams by this provider layer.
