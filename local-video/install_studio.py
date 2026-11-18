#!/usr/bin/env python3
"""Register Studio without overwriting local Emergent changes."""
from pathlib import Path
import py_compile
import shutil

root = Path(__file__).resolve().parents[1]
server = root / "backend/server.py"
watch = root / "frontend/src/pages/WatchPage.tsx"
if not (root / "backend/local_video_bridge.py").exists() or "/api/local-video/resolve/" not in watch.read_text():
    raise SystemExit("Manca il bridge/player locale dei passaggi precedenti. Nessun file modificato.")
if not all((root / "local-video" / f).exists() for f in ("importer.py", "media_probe.py", "audio_selector.py")):
    raise SystemExit("Mancano moduli dell'importatore locale. Nessun file modificato.")
py_compile.compile(str(root / "backend/studio_dashboard.py"), doraise=True)
s = server.read_text()
registration = "\nfrom studio_dashboard import install_studio_dashboard\ninstall_studio_dashboard(app, _core)\n"
if "install_studio_dashboard(app, _core)" not in s:
    shutil.copy2(server, "/tmp/flixit-server-before-studio.py")
    # Register before the __main__ guard, preserving previously appended integrations.
    anchor = '\nif __name__ == "__main__":'
    if anchor in s:
        s = s.replace(anchor, registration + anchor, 1)
    else:
        s += registration
    compile(s, str(server), "exec")
    server.write_text(s)
print("FlixIT Studio registrato. Riavviare backend e frontend con supervisorctl.")
