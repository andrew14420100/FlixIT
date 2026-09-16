"""Minimal Stremio-protocol mock addon for local tests: python3 tests/mock_stremio_addon.py [port]."""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import unquote

BBB_HLS = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
MANIFEST = {
    "id": "org.flixit.mock", "version": "1.0.0", "name": "FlixIT Mock Addon",
    "resources": ["stream"], "types": ["movie", "series"], "idPrefixes": ["tt"],
}
# Big Buck Bunny (tt1254207) -> HLS + torrent (torrent must be ignored); series id -> mp4 with proxy headers
STREAMS = {
    "movie/tt1254207": [
        {"name": "Torrent", "title": "BBB 1080p", "infoHash": "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c"},
        {"name": "Mock HLS", "title": "Big Buck Bunny 720p", "url": BBB_HLS},
        {"name": "Mock MP4", "title": "Big Buck Bunny mp4", "url": "https://example.com/bbb.mp4",
         "behaviorHints": {"notWebReady": True, "proxyHeaders": {"request": {"Referer": "https://example.com/"}}}},
    ],
    "series/tt0944947:1:1": [
        {"name": "Mock EP", "title": "S1E1", "url": "https://example.com/ep.mp4",
         "behaviorHints": {"proxyHeaders": {"request": {"User-Agent": "MockUA"}}}},
    ],
}


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = unquote(self.path)
        if path == "/manifest.json":
            return self._json(200, MANIFEST)
        if path.startswith("/stream/") and path.endswith(".json"):
            key = path[len("/stream/"):-len(".json")]
            return self._json(200, {"streams": STREAMS.get(key, [])})
        return self._json(404, {"error": "not found"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9876
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
