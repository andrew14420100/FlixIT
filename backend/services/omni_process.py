"""Lifecycle manager for a localhost Node/Stremio-compatible runtime.

Infrastructure only: starts/stops a Node process, waits for its manifest, and
reports health. No provider or scraping logic lives here.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("flixit.omni_process")
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_URL = "http://127.0.0.1:7001"


class OmniProcessManager:
    def __init__(self) -> None:
        self.process: Optional[subprocess.Popen] = None
        self.stdout_handle = None
        self.stderr_handle = None
        self.started_by_flixit = False

    @staticmethod
    def _env_bool(name: str, default: bool = False) -> bool:
        raw = os.environ.get(name)
        if raw is None or not str(raw).strip():
            return default
        return str(raw).strip().lower() in {"1", "true", "yes", "on"}

    @property
    def enabled(self) -> bool:
        return self._env_bool("OMNI_ENABLED", False)

    @property
    def addon_url(self) -> str:
        return (os.environ.get("OMNI_ADDON_URL") or _DEFAULT_URL).strip().rstrip("/")

    @property
    def runtime_dir(self) -> Path:
        configured = os.environ.get("OMNI_RUNTIME_DIR")
        return Path(configured).expanduser().resolve() if configured else (_PROJECT_ROOT / "omni-runtime")

    @property
    def start_timeout(self) -> float:
        try:
            return max(2.0, float(os.environ.get("OMNI_START_TIMEOUT", "20")))
        except ValueError:
            return 20.0

    def _parsed_url(self):
        return urlparse(self.addon_url)

    def is_local(self) -> bool:
        return (self._parsed_url().hostname or "").lower() in {"127.0.0.1", "localhost", "::1"}

    async def ready(self) -> bool:
        if not self.enabled:
            return False
        try:
            async with httpx.AsyncClient(timeout=1.5, follow_redirects=True) as client:
                response = await client.get(f"{self.addon_url}/manifest.json")
            if response.status_code != 200:
                return False
            data = response.json()
            return isinstance(data, dict) and bool(data.get("id"))
        except (httpx.HTTPError, ValueError):
            return False

    async def _wait_until_ready(self) -> None:
        deadline = asyncio.get_running_loop().time() + self.start_timeout
        while asyncio.get_running_loop().time() < deadline:
            if self.process is not None and self.process.poll() is not None:
                raise RuntimeError(
                    "Omni runtime terminato durante l'avvio "
                    f"(exit code {self.process.returncode})"
                )
            if await self.ready():
                return
            await asyncio.sleep(0.4)
        raise RuntimeError(
            f"Omni runtime non disponibile su {self.addon_url} entro {self.start_timeout:.0f}s"
        )

    def _open_logs(self) -> None:
        log_dir = _PROJECT_ROOT / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        self.stdout_handle = open(log_dir / "omni.out.log", "ab", buffering=0)
        self.stderr_handle = open(log_dir / "omni.err.log", "ab", buffering=0)

    def _close_logs(self) -> None:
        for handle_name in ("stdout_handle", "stderr_handle"):
            handle = getattr(self, handle_name)
            if handle is not None:
                try:
                    handle.close()
                finally:
                    setattr(self, handle_name, None)

    async def start(self) -> None:
        if not self.enabled:
            logger.info("Omni localhost runtime disabled (OMNI_ENABLED is not true)")
            return

        os.environ.setdefault("OMNI_ADDON_URL", _DEFAULT_URL)

        if not self.is_local():
            logger.info("Remote Omni URL configured; no local Node process will be spawned: %s", self.addon_url)
            return

        if await self.ready():
            logger.info("Omni runtime already active on %s", self.addon_url)
            return

        package_json = self.runtime_dir / "package.json"
        if not package_json.is_file():
            raise RuntimeError(
                "OMNI_ENABLED=true ma il runtime Node non è installato: "
                f"manca {package_json}"
            )

        parsed = self._parsed_url()
        port = parsed.port or 7001
        host = "127.0.0.1" if (parsed.hostname or "").lower() in {"localhost", "127.0.0.1"} else (parsed.hostname or "127.0.0.1")
        env = os.environ.copy()
        env["PORT"] = str(port)
        env["HOST"] = host
        npm = "npm.cmd" if os.name == "nt" else "npm"

        self._open_logs()
        logger.info("Starting Node runtime in %s on %s:%s", self.runtime_dir, host, port)
        try:
            self.process = subprocess.Popen(
                [npm, "start"],
                cwd=str(self.runtime_dir),
                env=env,
                stdout=self.stdout_handle,
                stderr=self.stderr_handle,
                start_new_session=(os.name != "nt"),
            )
            self.started_by_flixit = True
            await self._wait_until_ready()
            logger.info("Omni runtime ready on %s", self.addon_url)
        except Exception:
            await self.stop()
            raise

    async def stop(self) -> None:
        process = self.process
        if process is None or not self.started_by_flixit:
            self._close_logs()
            return

        if process.poll() is None:
            logger.info("Stopping Omni runtime pid=%s", process.pid)
            try:
                if os.name != "nt":
                    os.killpg(process.pid, signal.SIGTERM)
                else:
                    process.terminate()
                await asyncio.to_thread(process.wait, timeout=8)
            except subprocess.TimeoutExpired:
                logger.warning("Omni runtime did not stop gracefully; killing it")
                try:
                    if os.name != "nt":
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        process.kill()
                except ProcessLookupError:
                    pass
                await asyncio.to_thread(process.wait)
            except ProcessLookupError:
                pass

        self.process = None
        self.started_by_flixit = False
        self._close_logs()

    async def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "url": self.addon_url,
            "local": self.is_local(),
            "ready": await self.ready(),
            "managed_by_flixit": self.started_by_flixit,
            "pid": self.process.pid if self.process is not None and self.process.poll() is None else None,
            "runtime_dir": str(self.runtime_dir),
        }


@asynccontextmanager
async def omni_lifespan(app):
    manager = OmniProcessManager()
    app.state.omni_manager = manager
    await manager.start()
    try:
        yield
    finally:
        await manager.stop()


async def omni_status(app) -> dict:
    manager = getattr(app.state, "omni_manager", None)
    if manager is None:
        manager = OmniProcessManager()
    return await manager.status()
