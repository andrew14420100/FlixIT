"""FlixIT 'In Arrivo' (coming soon) curated by admin: movies, seasons, episodes, TBA, custom labels.
Lifecycle: upcoming -> released (auto on date, shown in 'Novità' / 'Nuove stagioni' rows) -> archived (after N days)."""
import uuid
import asyncio
import logging
from datetime import datetime, timezone, timedelta, date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

KINDS = ("movie_release", "series_premiere", "season", "episode", "tba", "custom")
MONTHS_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]
DEFAULT_AFTER_DAYS = 30
SETTINGS_KEY = "coming_soon"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today() -> date:
    return datetime.now(timezone.utc).date()


def fmt_day(d: Optional[str]) -> str:
    if not d:
        return ""
    try:
        dt = date.fromisoformat(d[:10])
    except ValueError:
        return d
    return f"{dt.day} {MONTHS_IT[dt.month - 1]}"


def badge_for(item: dict) -> str:
    kind, d = item.get("kind", "movie_release"), item.get("release_date")
    day = fmt_day(d)
    if kind == "tba" or not d:
        return item.get("label") or "Prossimamente"
    if kind == "season":
        return f"Stagione {item.get('season_number')} · {day}"
    if kind == "episode":
        return f"Ep. {item.get('episode_number')} · S{item.get('season_number')} · {day}"
    if kind == "custom" and item.get("label"):
        return f"{item['label']} · {day}"
    if kind == "series_premiere":
        return f"Nuova serie · {day}"
    return f"Dal {day}"


def released_badge(item: dict) -> str:
    kind = item.get("kind")
    if kind == "season":
        return f"Nuova stagione {item.get('season_number')}"
    if kind == "episode":
        return f"Nuovo episodio · S{item.get('season_number')} E{item.get('episode_number')}"
    if kind == "series_premiere":
        return "Nuova serie"
    return item.get("label") if kind == "custom" and item.get("label") else "Novità"


def public_item(it: dict) -> dict:
    d = {k: v for k, v in it.items() if k != "_id"}
    d["badge"] = badge_for(it) if it.get("status", "upcoming") == "upcoming" else released_badge(it)
    d["upcoming"] = it.get("status", "upcoming") == "upcoming"
    d["new_release"] = it.get("status") == "released"
    return d


def sort_key(it: dict):
    d = it.get("release_date")
    return (0, d) if d else (1, "9999")


class ComingSoonIn(BaseModel):
    tmdbId: int
    type: str = "movie"
    kind: str = "movie_release"
    release_date: Optional[str] = None
    season_number: Optional[int] = None
    episode_number: Optional[int] = None
    label: str = ""
    note: str = ""
    after_release_days: Optional[int] = None
    order: Optional[int] = None


class ComingSoonPatch(BaseModel):
    kind: Optional[str] = None
    release_date: Optional[str] = None
    clear_date: bool = False
    season_number: Optional[int] = None
    episode_number: Optional[int] = None
    label: Optional[str] = None
    note: Optional[str] = None
    after_release_days: Optional[int] = None
    order: Optional[int] = None
    status: Optional[str] = None  # upcoming | released | archived
    keep_until: Optional[str] = None


class SettingsIn(BaseModel):
    default_after_release_days: int = DEFAULT_AFTER_DAYS


def register(app, db, get_current_admin, log_admin_action, fetch_tmdb_data, enrich_items, notify):
    coming, settings = db["coming_soon"], db["app_settings"]
    coming.create_index([("status", 1), ("release_date", 1)])
    r = APIRouter()

    def get_settings() -> dict:
        s = settings.find_one({"key": SETTINGS_KEY}, {"_id": 0}) or {}
        return {"default_after_release_days": int(s.get("default_after_release_days", DEFAULT_AFTER_DAYS))}

    def validate_date(d: Optional[str]) -> Optional[str]:
        if not d:
            return None
        try:
            return date.fromisoformat(d[:10]).isoformat()
        except ValueError:
            raise HTTPException(status_code=400, detail="Data non valida (usa AAAA-MM-GG)")

    async def tmdb_base(mt: str, tmdb_id: int) -> dict:
        d = await fetch_tmdb_data(f"/{mt}/{tmdb_id}")
        if not d or d.get("success") is False:
            raise HTTPException(status_code=404, detail="Titolo non trovato su TMDB")
        return {"title": d.get("title") or d.get("name"), "overview": d.get("overview"), "poster_path": d.get("poster_path"),
                "backdrop_path": d.get("backdrop_path"), "vote_average": d.get("vote_average", 0), "popularity": d.get("popularity", 0),
                "genre_ids": [g["id"] for g in d.get("genres") or []], "tmdb_release_date": d.get("release_date") or d.get("first_air_date"),
                "number_of_seasons": d.get("number_of_seasons")}

    def lifecycle():
        """upcoming -> released once the date is reached; released -> archived after N days (unless keep_until)."""
        t = today().isoformat()
        moved = 0
        for it in coming.find({"status": "upcoming", "release_date": {"$ne": None, "$lte": t}}):
            coming.update_one({"id": it["id"]}, {"$set": {"status": "released", "released_at": now_iso(), "updatedAt": now_iso()}})
            moved += 1
        now = datetime.now(timezone.utc)
        for it in coming.find({"status": "released"}):
            keep = it.get("keep_until")
            if keep:
                if datetime.fromisoformat(keep) > now:
                    continue
            else:
                days = it.get("after_release_days")
                if days is None:
                    continue
                rel = it.get("released_at") or it.get("release_date")
                rel_dt = datetime.fromisoformat(rel) if "T" in rel else datetime.combine(date.fromisoformat(rel), datetime.min.time(), timezone.utc)
                if rel_dt + timedelta(days=int(days)) > now:
                    continue
            coming.update_one({"id": it["id"]}, {"$set": {"status": "archived", "archived_at": now_iso(), "updatedAt": now_iso()}})
            moved += 1
        if moved:
            logger.info(f"coming soon lifecycle: {moved} items moved")
        return moved

    # ---- public ----
    @r.get("/api/public/coming-soon")
    async def public_coming_soon():
        lifecycle()
        items = sorted((public_item(i) for i in coming.find({"status": "upcoming"})), key=lambda i: (sort_key(i), i.get("order", 0)))
        return {"items": await enrich_items(items), "total": len(items), "curated": True}

    @r.get("/api/public/new-releases/{media}")
    async def public_new_releases(media: str):
        lifecycle()
        flt = {"status": "released", "type": "tv" if media == "tv" else "movie"}
        items = [public_item(i) for i in coming.find(flt).sort("released_at", -1)]
        return {"items": await enrich_items(items), "total": len(items)}

    # ---- admin: TMDB search without catalog-availability filter (future titles included) ----
    @r.get("/api/admin/tmdb/search")
    async def admin_tmdb_search(q: str, admin=Depends(get_current_admin)):
        if len(q.strip()) < 2:
            return {"items": []}
        data = await fetch_tmdb_data("/search/multi", {"query": q.strip(), "page": 1, "include_adult": "false"})
        out = []
        for it in (data or {}).get("results", []):
            if it.get("media_type") not in ("movie", "tv"):
                continue
            out.append({"tmdbId": it["id"], "type": it["media_type"], "title": it.get("title") or it.get("name"), "poster_path": it.get("poster_path"),
                        "backdrop_path": it.get("backdrop_path"), "release_date": it.get("release_date") or it.get("first_air_date"), "overview": it.get("overview"),
                        "vote_average": it.get("vote_average", 0)})
        return {"items": out[:15]}

    @r.get("/api/admin/tmdb/tv/{tmdb_id}/seasons")
    async def admin_tv_seasons(tmdb_id: int, admin=Depends(get_current_admin)):
        d = await fetch_tmdb_data(f"/tv/{tmdb_id}")
        if not d:
            raise HTTPException(status_code=404, detail="Serie non trovata")
        seasons = [{"season_number": s.get("season_number"), "name": s.get("name"), "air_date": s.get("air_date"), "episode_count": s.get("episode_count"), "poster_path": s.get("poster_path")}
                   for s in d.get("seasons", []) if s.get("season_number", 0) > 0]
        return {"title": d.get("name"), "seasons": seasons, "next_episode": d.get("next_episode_to_air"), "status": d.get("status")}

    @r.get("/api/admin/tmdb/tv/{tmdb_id}/season/{n}")
    async def admin_tv_season(tmdb_id: int, n: int, admin=Depends(get_current_admin)):
        d = await fetch_tmdb_data(f"/tv/{tmdb_id}/season/{n}")
        if not d:
            raise HTTPException(status_code=404, detail="Stagione non trovata")
        return {"season_number": n, "air_date": d.get("air_date"), "episodes": [{"episode_number": e.get("episode_number"), "name": e.get("name"), "air_date": e.get("air_date")} for e in d.get("episodes", [])]}

    # ---- admin CRUD ----
    @r.get("/api/admin/coming-soon")
    def admin_list(status: Optional[str] = None, admin=Depends(get_current_admin)):
        lifecycle()
        flt = {"status": status} if status else {}
        items = sorted((public_item(i) for i in coming.find(flt)), key=lambda i: ({"upcoming": 0, "released": 1, "archived": 2}.get(i.get("status"), 3), sort_key(i), i.get("order", 0)))
        return {"items": items, "settings": get_settings(), "counts": {s: coming.count_documents({"status": s}) for s in ("upcoming", "released", "archived")}}

    @r.get("/api/admin/coming-soon/settings")
    def admin_settings(admin=Depends(get_current_admin)):
        return get_settings()

    @r.put("/api/admin/coming-soon/settings")
    def admin_update_settings(data: SettingsIn, admin=Depends(get_current_admin)):
        if data.default_after_release_days < 1 or data.default_after_release_days > 365:
            raise HTTPException(status_code=400, detail="Durata tra 1 e 365 giorni")
        settings.update_one({"key": SETTINGS_KEY}, {"$set": {"default_after_release_days": data.default_after_release_days, "updatedAt": now_iso()}}, upsert=True)
        log_admin_action("coming_soon_settings", metadata={"days": data.default_after_release_days})
        return get_settings()

    @r.post("/api/admin/coming-soon")
    async def admin_add(data: ComingSoonIn, admin=Depends(get_current_admin)):
        if data.kind not in KINDS:
            raise HTTPException(status_code=400, detail="Tipo non valido")
        mt = "tv" if data.type == "tv" else "movie"
        if data.kind in ("season", "episode") and mt != "tv":
            raise HTTPException(status_code=400, detail="Stagioni ed episodi valgono solo per le serie")
        if data.kind == "season" and not data.season_number:
            raise HTTPException(status_code=400, detail="Indica il numero di stagione")
        if data.kind == "episode" and (not data.season_number or not data.episode_number):
            raise HTTPException(status_code=400, detail="Indica stagione ed episodio")
        rel = None if data.kind == "tba" else validate_date(data.release_date)
        if data.kind != "tba" and not rel:
            raise HTTPException(status_code=400, detail="Indica la data di uscita (oppure scegli 'Prossimamente')")
        dup = {"tmdbId": data.tmdbId, "type": mt, "status": {"$ne": "archived"}, "kind": data.kind}
        if data.kind in ("season", "episode"):
            dup["season_number"] = data.season_number
            if data.kind == "episode":
                dup["episode_number"] = data.episode_number
        if coming.find_one(dup):
            raise HTTPException(status_code=400, detail="Voce già presente in In Arrivo")
        base = await tmdb_base(mt, data.tmdbId)
        if data.kind == "season" and data.season_number:
            s = await fetch_tmdb_data(f"/tv/{data.tmdbId}/season/{data.season_number}")
            if s and s.get("poster_path"):
                base["season_poster_path"] = s["poster_path"]
        doc = {"id": str(uuid.uuid4())[:8], "tmdbId": data.tmdbId, "type": mt, "kind": data.kind, "release_date": rel,
               "season_number": data.season_number, "episode_number": data.episode_number, "label": data.label.strip()[:60], "note": data.note.strip()[:200],
               "after_release_days": data.after_release_days if data.after_release_days is not None else get_settings()["default_after_release_days"],
               "status": "upcoming", "order": data.order if data.order is not None else coming.count_documents({}) + 1, **base,
               "createdAt": now_iso(), "updatedAt": now_iso(), "created_by": admin.get("email")}
        coming.insert_one(doc)
        lifecycle()
        log_admin_action("coming_soon_add", str(data.tmdbId), {"kind": data.kind, "type": mt})
        return public_item(coming.find_one({"id": doc["id"]}))

    @r.patch("/api/admin/coming-soon/{item_id}")
    def admin_patch(item_id: str, data: ComingSoonPatch, admin=Depends(get_current_admin)):
        it = coming.find_one({"id": item_id})
        if not it:
            raise HTTPException(status_code=404, detail="Elemento non trovato")
        upd = {"updatedAt": now_iso()}
        if data.kind is not None:
            if data.kind not in KINDS:
                raise HTTPException(status_code=400, detail="Tipo non valido")
            upd["kind"] = data.kind
            if data.kind == "tba":
                upd["release_date"] = None
        if data.clear_date:
            upd["release_date"] = None
        elif data.release_date is not None:
            upd["release_date"] = validate_date(data.release_date)
        for k in ("season_number", "episode_number", "after_release_days", "order"):
            v = getattr(data, k)
            if v is not None:
                upd[k] = v
        if data.label is not None:
            upd["label"] = data.label.strip()[:60]
        if data.note is not None:
            upd["note"] = data.note.strip()[:200]
        if data.keep_until is not None:
            upd["keep_until"] = validate_date(data.keep_until) + "T23:59:59+00:00" if data.keep_until else None
        if data.status is not None:
            if data.status not in ("upcoming", "released", "archived"):
                raise HTTPException(status_code=400, detail="Stato non valido")
            upd["status"] = data.status
            if data.status == "released":
                upd["released_at"] = now_iso()
            if data.status == "upcoming":
                upd["released_at"] = None
                upd["keep_until"] = None
        coming.update_one({"id": item_id}, {"$set": upd})
        log_admin_action("coming_soon_update", item_id, {k: v for k, v in upd.items() if k != "updatedAt"})
        return public_item(coming.find_one({"id": item_id}))

    @r.delete("/api/admin/coming-soon/{item_id}")
    def admin_remove(item_id: str, admin=Depends(get_current_admin)):
        if not coming.delete_one({"id": item_id}).deleted_count:
            raise HTTPException(status_code=404, detail="Elemento non trovato")
        log_admin_action("coming_soon_remove", item_id)
        return {"ok": True}

    app.include_router(r)

    @app.on_event("startup")
    async def _coming_soon_loop():
        async def loop():
            while True:
                try:
                    await asyncio.to_thread(lifecycle)
                except Exception as e:
                    logger.warning(f"coming soon lifecycle error: {e}")
                await asyncio.sleep(600)
        asyncio.create_task(loop())

    return lifecycle
