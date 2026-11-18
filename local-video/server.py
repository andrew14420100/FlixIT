"""Loopback-only MP4 server for an authorized personal FlixIT library."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

PORT = 8010
BASE = f"http://127.0.0.1:{PORT}"
ROOT = Path(os.environ.get("FLIXIT_MEDIA_DIR", str(Path(__file__).parent / "media"))).expanduser().resolve()
SECRET = secrets.token_bytes(32)
TTL = 12 * 3600
ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000"}
ID = r"[1-9][0-9]{0,11}"
KEY = rf"(?:movie/{ID}|tv/{ID}/{ID}/{ID})"


def locate(key):
    if not re.fullmatch(KEY, key):
        return None
    file = (ROOT / (key + ".mp4")).resolve()
    if not file.is_relative_to(ROOT) or not file.is_file():
        return None
    return file


def signature(key, expires):
    return hmac.new(SECRET, f"v1:{key}:{expires}".encode(), hashlib.sha256).hexdigest()


def stream_url(key):
    expires = int(time.time()) + TTL
    return f"{BASE}/media/{key}.mp4?" + urlencode(
        {"expires": expires, "token": signature(key, expires)}
    )


def parse_range(value, size):
    if not value:
        return 0, size - 1, False
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value.strip())
    if not match or size <= 0:
        raise ValueError("invalid range")
    first, last = match.groups()
    if not first:
        suffix = int(last)
        if suffix <= 0:
            raise ValueError("invalid suffix")
        return max(0, size - suffix), size - 1, True
    start = int(first)
    end = min(int(last), size - 1) if last else size - 1
    if start >= size or end < start:
        raise ValueError("invalid range")
    return start, end, True


class Handler(BaseHTTPRequestHandler):
    def allowed(self):
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        return host in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"} and (
            origin is None or origin in ORIGINS
        )

    def cors(self):
        origin = self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")
        self.send_header("X-Content-Type-Options", "nosniff")

    def json_reply(self, status, payload, head=False):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head:
            self.wfile.write(data)

    def do_OPTIONS(self):
        if not self.allowed():
            self.json_reply(403, {"detail": "Origine non autorizzata"})
            return
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Range, Authorization, ngrok-skip-browser-warning, Content-Type")
        self.send_header("Access-Control-Max-Age", "300")
        self.end_headers()

    def do_GET(self):
        self.route(False)

    def do_HEAD(self):
        self.route(True)

    def route(self, head):
        if not self.allowed():
            self.json_reply(403, {"detail": "Origine non autorizzata"}, head)
            return
        parts = urlsplit(self.path)
        if parts.path == "/health":
            self.json_reply(200, {"status": "ok", "source": "local-library"}, head)
            return
        resolver = re.fullmatch(rf"/api/player/({KEY})", parts.path)
        if resolver:
            key = resolver.group(1)
            file = locate(key)
            if not file:
                self.json_reply(404, {"success": False, "detail": "Video assente nell'archivio locale"}, head)
                return
            url = stream_url(key)
            self.json_reply(200, {"success": True, "stream": url, "streamUrl": url,
                                  "type": "video", "source": "local-library"}, head)
            return
        media = re.fullmatch(rf"/media/({KEY})\.mp4", parts.path)
        if not media:
            self.json_reply(404, {"detail": "Percorso non trovato"}, head)
            return
        key = media.group(1)
        params = parse_qs(parts.query)
        try:
            expires = int(params["expires"][0])
            token = params["token"][0]
            if not int(time.time()) < expires <= int(time.time()) + TTL:
                raise ValueError("expired")
            if not hmac.compare_digest(signature(key, expires), token):
                raise ValueError("signature")
        except (KeyError, ValueError, IndexError, TypeError):
            self.json_reply(403, {"detail": "Collegamento non valido o scaduto"}, head)
            return
        file = locate(key)
        if not file:
            self.json_reply(404, {"detail": "Video non trovato"}, head)
            return
        try:
            handle = file.open("rb")
        except OSError:
            self.json_reply(404, {"detail": "Video non disponibile"}, head)
            return
        with handle:
            size = os.fstat(handle.fileno()).st_size
            try:
                start, end, partial = parse_range(self.headers.get("Range"), size)
            except ValueError:
                self.send_response(416)
                self.cors()
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            count = end - start + 1
            self.send_response(206 if partial else 200)
            self.cors()
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "private, no-store")
            self.send_header("Content-Length", str(count))
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if head:
                return
            handle.seek(start)
            try:
                while count > 0:
                    chunk = handle.read(min(count, 256 * 1024))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    count -= len(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

    def log_message(self, format, *args):
        # Never log temporary tokens or full URL query strings.
        print(f"[local-video] {self.command} {urlsplit(self.path).path}")


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    print(f"Archivio autorizzato: {ROOT}")
    print(f"Server locale: {BASE}/health")
    print("Solo loopback. Non esporre su Internet. Ctrl+C per arrestare.")
    with ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
