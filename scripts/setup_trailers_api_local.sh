#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/app}"
TRAILERS_API_DIR="${THERYSTON_TRAILERS_API_DIR:-$APP_ROOT/trailers-api}"
DATA_FOLDER="${THERYSTON_TRAILERS_DATA_DIR:-$APP_ROOT/trailers-data}"
BUN_BIN="${BUN_BIN:-/root/.bun/bin/bun}"
THERYSTON_PORT="${THERYSTON_PORT:-3011}"

if [ ! -x "$BUN_BIN" ]; then
  echo "Bun non trovato in $BUN_BIN" >&2
  exit 1
fi

if [ ! -d "$TRAILERS_API_DIR/.git" ]; then
  git clone https://github.com/Theryston/trailers-api.git "$TRAILERS_API_DIR"
fi

cd "$TRAILERS_API_DIR"
"$BUN_BIN" install

mkdir -p "$DATA_FOLDER/files"

# Theryston upstream uploads completed trailers to S3. FLIX-IT keeps them on
# the same server instead: one extraction, then refreshes read the persistent
# local file through FastAPI /api/public/theryston-file/....
cat > "$TRAILERS_API_DIR/src/upload-file.js" <<'EOF'
import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";

export async function uploadFile(filePath) {
  const dataFolder = process.env.DATA_FOLDER;
  if (!dataFolder) throw new Error("DATA_FOLDER is required");

  const filesDir = path.join(dataFolder, "files");
  fs.mkdirSync(filesDir, { recursive: true });

  const rawName = path.basename(filePath).replace(/[^A-Za-z0-9._-]+/g, "-");
  const key = `${uuid()}-${rawName}`;
  const destination = path.join(filesDir, key);
  await fs.promises.copyFile(filePath, destination);

  const base = (process.env.BASE_FILES_URL || "http://127.0.0.1:3011/files").replace(/\/$/, "");
  return `${base}/${encodeURIComponent(key)}`;
}
EOF

# IMDb playback files do not always contain an ISO language tag. Upstream
# discards an otherwise valid trailer when every file lacks that metadata.
# FLIX-IT verifies resolution/codec itself afterwards, so keep valid trailers
# even when the audio language tag is absent.
TRAILERS_API_DIR="$TRAILERS_API_DIR" python3 - <<'PY'
import os
from pathlib import Path
p = Path(os.environ["TRAILERS_API_DIR"]) / "src" / "worker.js"
s = p.read_text()
old = '''    const servicesResultsWithTrailers = servicesResults.filter(\n      (serviceResult) =>\n        serviceResult.trailerPage &&\n        serviceResult.serviceResult.length &&\n        serviceResult.serviceResult.every((t) => t.langs.length)\n    );'''
new = '''    const servicesResultsWithTrailers = servicesResults.filter(\n      (serviceResult) =>\n        serviceResult.trailerPage &&\n        serviceResult.serviceResult.length\n    );'''
if old in s:
    s = s.replace(old, new)
p.write_text(s)
PY

cat > "$TRAILERS_API_DIR/.env" <<EOF
PORT=$THERYSTON_PORT
DATA_FOLDER=$DATA_FOLDER
BASE_FILES_URL=http://127.0.0.1:$THERYSTON_PORT/files
EOF

FFMPEG_BIN="$TRAILERS_API_DIR/node_modules/ffmpeg-static/ffmpeg"
FFPROBE_BIN="$TRAILERS_API_DIR/node_modules/ffprobe-static/bin/linux/x64/ffprobe"

if [ -x "$FFMPEG_BIN" ]; then
  ln -sf "$FFMPEG_BIN" /usr/local/bin/ffmpeg
fi
if [ -x "$FFPROBE_BIN" ]; then
  ln -sf "$FFPROBE_BIN" /usr/local/bin/ffprobe
fi

mkdir -p /var/log/supervisor
cat > /etc/supervisor/conf.d/trailers-api.conf <<EOF
[program:trailers-api]
directory=$TRAILERS_API_DIR
command=$BUN_BIN run start
autostart=true
autorestart=true
startsecs=2
stopasgroup=true
killasgroup=true
environment=HOME="/root",BUN_INSTALL="/root/.bun",PATH="/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",PORT="$THERYSTON_PORT",DATA_FOLDER="$DATA_FOLDER",BASE_FILES_URL="http://127.0.0.1:$THERYSTON_PORT/files"
stdout_logfile=/var/log/supervisor/trailers-api.out.log
stderr_logfile=/var/log/supervisor/trailers-api.err.log
stdout_logfile_maxbytes=10MB
stderr_logfile_maxbytes=10MB
stdout_logfile_backups=2
stderr_logfile_backups=2
EOF

supervisorctl reread
supervisorctl update
supervisorctl restart trailers-api || true

sleep 2

echo "--- trailers-api ---"
supervisorctl status trailers-api || true
printf "docs HTTP: "
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$THERYSTON_PORT/docs" || true
printf "ffmpeg: "
ffmpeg -version 2>/dev/null | head -1 || true
printf "ffprobe: "
ffprobe -version 2>/dev/null | head -1 || true
printf "data folder: "
ls -ld "$DATA_FOLDER" "$DATA_FOLDER/files"
