"""Administrative chunk uploads and authenticated local-video catalogue."""
import asyncio
import json
import os
import re
import shutil
import uuid
from pathlib import Path

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parents[1] / "local-video"
INBOX, MEDIA, JOBS = BASE / "inbox", BASE / "media", BASE / "studio-jobs"
CHUNK = 4 * 1024**2
MAX_SIZE = 20 * 1024**3
RESERVE = 1024**3
NUMBER = r"[1-9][0-9]{0,11}"
KEY = re.compile(rf"(movie/{NUMBER}|tv/{NUMBER}/{NUMBER}/{NUMBER})")
JOB_ID = re.compile(r"[a-f0-9]{32}")
LOCK = asyncio.Lock()


class UploadStart(BaseModel):
    filename: str = Field(min_length=1, max_length=180)
    size: int = Field(gt=0, le=MAX_SIZE)
    authorized: bool = False


def fail(status, message):
    raise HTTPException(status_code=status, detail=message)


def read_job(job_id):
    if not JOB_ID.fullmatch(job_id):
        fail(404, "Caricamento non trovato")
    try:
        return json.loads((JOBS / f"{job_id}.json").read_text())
    except (OSError, ValueError):
        fail(404, "Caricamento non trovato")


def store_job(job):
    file = JOBS / (job["id"] + ".json")
    temp = file.with_suffix(".tmp")
    temp.write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
    temp.replace(file)


def jobs():
    for file in JOBS.glob("*.json"):
        try:
            yield json.loads(file.read_text())
        except (OSError, ValueError):
            continue


def library_file(key):
    if not KEY.fullmatch(key):
        return None
    file = MEDIA / (key + ".mp4")
    if not file.is_file() or not file.resolve().is_relative_to(MEDIA.resolve()):
        return None
    return file


def metadata(key):
    file = library_file(key)
    if not file:
        return None
    meta = file.with_suffix(".json")
    try:
        if meta.stat().st_mtime_ns < file.stat().st_mtime_ns:
            return None
        data = json.loads(meta.read_text())
        if int(data.get("width", 0)) <= 0 or int(data.get("height", 0)) <= 0:
            return None
        return data
    except (OSError, ValueError, TypeError):
        return None


def offset(job):
    part = JOBS / (job["id"] + ".part")
    return part.stat().st_size if part.exists() else 0


def job_status(job):
    if job["state"] == "queued":
        status = "ready" if metadata(job["key"]) else "processing"
        count = job["size"]
    else:
        status, count = "uploading", offset(job)
    return {**job, "state": status, "offset": count}


def norm(text):
    return " ".join(re.findall(r"\w+", str(text or "").casefold()))


async def identify(core, name):
    if Path(name).name != name or "/" in name or "\\" in name or name.startswith(".") or not name.lower().endswith(".mp4"):
        fail(400, "Sono ammessi solo file MP4 con nome valido")
    stem = Path(name).stem
    episode = re.search(r"S(\d+)E(\d+)", stem, re.I)
    kind = "tv" if episode else "movie"
    season, ep = map(int, episode.groups()) if episode else (0, 0)
    if episode and (season < 1 or ep < 1):
        fail(400, "Stagione o episodio non valido")
    explicit = re.search(r"\[tmdb-(" + NUMBER + r")\]", stem, re.I)
    if explicit:
        media_id = int(explicit.group(1))
    else:
        year = re.search(r"\((\d{4})\)", stem)
        title = re.split(r"\(\d{4}\)|S\d+E\d+", stem, maxsplit=1, flags=re.I)[0].strip(" ._-")
        if not title:
            fail(422, "Titolo non riconosciuto: aggiungere [tmdb-ID]")
        q = {"query": title, "include_adult": "false"}
        if year:
            q["first_air_date_year" if episode else "primary_release_year"] = year.group(1)
        data = await core.fetch_tmdb_data(f"/search/{kind}", q) or {}
        found = [x for x in data.get("results", []) if norm(title) in {
            norm(x.get(f)) for f in ("title", "original_title", "name", "original_name")
        }]
        if len(found) != 1 or data.get("total_pages", 0) > 1:
            fail(422, "Corrispondenza TMDB ambigua o assente: aggiungere [tmdb-ID] al nome")
        media_id = int(found[0]["id"])
    details = await core.fetch_tmdb_data(f"/{kind}/{media_id}")
    if not details or int(details.get("id", 0)) != media_id:
        fail(422, "Identificativo TMDB non verificato")
    if episode:
        detail_ep = await core.fetch_tmdb_data(f"/tv/{media_id}/season/{season}/episode/{ep}")
        if not detail_ep or detail_ep.get("episode_number") != ep:
            fail(422, "Episodio TMDB non trovato")
    key = f"tv/{media_id}/{season}/{ep}" if episode else f"movie/{media_id}"
    if not KEY.fullmatch(key):
        fail(400, "Identificativo non valido")
    canonical = f"Serie S{season:02d}E{ep:02d} [tmdb-{media_id}].mp4" if episode else f"Film [tmdb-{media_id}].mp4"
    return key, canonical, details.get("title") or details.get("name") or str(media_id)


def install_studio_dashboard(app, core):
    for folder in (INBOX, MEDIA, JOBS):
        folder.mkdir(parents=True, exist_ok=True)

    def admin_only(admin=Depends(core.get_current_admin)):
        # Require the highest existing role; frontend checks are not security boundaries.
        if admin.get("role") != "superadmin":
            fail(403, "FlixIT Studio richiede un account superadmin")
        return admin

    @app.get("/api/admin/studio/v1/jobs")
    async def list_jobs(admin=Depends(admin_only)):
        rows = sorted(jobs(), key=lambda j: j.get("created", 0), reverse=True)[:200]
        return {"items": [job_status(j) for j in rows],
                "free": shutil.disk_usage(BASE).free, "chunk": CHUNK}

    @app.post("/api/admin/studio/v1/start")
    async def start(data: UploadStart, admin=Depends(admin_only)):
        if not data.authorized:
            fail(400, "Confermare i diritti di distribuzione del contenuto")
        key, name, title = await identify(core, data.filename)
        async with LOCK:
            if library_file(key) or (INBOX / name).exists():
                fail(409, "Questo contenuto è già presente o in importazione")
            existing = list(jobs())
            if any(j["key"] == key for j in existing):
                fail(409, "Caricamento già registrato: riprendere o annullare quello esistente")
            remaining = sum(max(0, j["size"] - offset(j)) + j["size"]
                            for j in existing if j["state"] == "uploading")
            remaining += sum(j["size"] for j in existing
                             if j["state"] == "queued" and not library_file(j["key"]))
            if shutil.disk_usage(BASE).free < remaining + data.size * 2 + RESERVE:
                fail(507, "Spazio insufficiente per originale e copia elaborata")
            import time
            job = {"id": uuid.uuid4().hex, "name": data.filename, "canonical": name, "title": title,
                   "key": key, "size": data.size, "state": "uploading", "created": time.time()}
            store_job(job)
            return {**job_status(job), "chunk": CHUNK}

    @app.get("/api/admin/studio/v1/jobs/{job_id}")
    async def status(job_id: str, admin=Depends(admin_only)):
        return job_status(read_job(job_id))

    @app.put("/api/admin/studio/v1/jobs/{job_id}/chunk")
    async def chunk(job_id: str, request: Request, at: int, admin=Depends(admin_only)):
        try:
            length = int(request.headers.get("content-length", "0"))
        except ValueError:
            fail(400, "Dimensione blocco non valida")
        if not 0 < length <= CHUNK:
            fail(413, "Blocco troppo grande")
        body = bytearray()
        async for part in request.stream():
            if len(body) + len(part) > length:
                fail(413, "Blocco troppo grande")
            body.extend(part)
        if len(body) != length:
            fail(400, "Blocco incompleto")
        async with LOCK:
            job = read_job(job_id)
            if job["state"] != "uploading":
                fail(409, "Caricamento già concluso")
            if at != offset(job) or at + length > job["size"]:
                fail(409, "Offset non valido: riprendere dall'offset del server")
            if shutil.disk_usage(BASE).free < length + RESERVE:
                fail(507, "Spazio insufficiente")
            with (JOBS / (job_id + ".part")).open("ab") as file:
                try:
                    file.write(body)
                    file.flush()
                except OSError:
                    file.truncate(at)
                    raise
            return {"offset": at + length}

    @app.post("/api/admin/studio/v1/jobs/{job_id}/finish")
    async def finish(job_id: str, admin=Depends(admin_only)):
        async with LOCK:
            job = read_job(job_id)
            if job["state"] == "queued":
                return job_status(job)
            part = JOBS / (job_id + ".part")
            if offset(job) != job["size"]:
                fail(409, "Caricamento incompleto")
            target = INBOX / job["canonical"]
            try:
                os.link(part, target)
            except FileExistsError:
                # Recover if interrupted after linking but before persisting state.
                if not os.path.samefile(part, target):
                    fail(409, "File già presente")
            job["state"] = "queued"
            store_job(job)
            part.unlink(missing_ok=True)
            return job_status(job)

    @app.delete("/api/admin/studio/v1/jobs/{job_id}")
    async def discard(job_id: str, admin=Depends(admin_only)):
        async with LOCK:
            job = read_job(job_id)
            if job["state"] != "uploading":
                fail(409, "Non è possibile annullare un contenuto già acquisito")
            part = JOBS / (job_id + ".part")
            target = INBOX / job["canonical"]
            if part.exists() and target.exists() and os.path.samefile(part, target):
                fail(409, "Importazione già avviata")
            part.unlink(missing_ok=True)
            (JOBS / (job_id + ".json")).unlink(missing_ok=True)
            return {"success": True}

    @app.get("/api/local-video/library")
    async def library(page: int = 1, user=Depends(core.get_current_user)):
        page = max(1, page)
        valid = []
        for file in MEDIA.rglob("*.mp4"):
            key = file.relative_to(MEDIA).with_suffix("").as_posix()
            if KEY.fullmatch(key):
                meta = metadata(key)
                if meta:
                    valid.append((key, meta, file.stat().st_mtime))
        valid.sort(key=lambda x: (-x[2], x[0]))
        batch = valid[(page - 1) * 24:page * 24]
        limit = asyncio.Semaphore(4)

        async def describe(key, meta):
            kind, raw_id, *parts = key.split("/")
            media_id = int(raw_id)
            async with limit:
                info = await core.fetch_tmdb_data(f"/{kind}/{media_id}") or {}
            return {"key": key, "type": kind, "id": media_id,
                    "title": info.get("title") or info.get("name") or f"TMDB {media_id}",
                    "poster": info.get("poster_path"),
                    "season": int(parts[0]) if parts else None,
                    "episode": int(parts[1]) if parts else None,
                    "quality": meta.get("quality"), "hdr": meta.get("hdr", False),
                    "italian": meta.get("italian", False)}

        return {"items": await asyncio.gather(*(describe(k, m) for k, m, _ in batch)),
                "total": len(valid), "page": page}
