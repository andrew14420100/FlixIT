"""Prefer Italian audio when importing authorized local MP4 files.

The original remains in the inbox. Video is copied without re-encoding.
"""
import shutil
import subprocess
from pathlib import Path

from media_probe import analyze


def prepare_video(source, target):
    source, target = Path(source), Path(target)
    if source.resolve() == target.resolve():
        raise OSError("Origine e destinazione devono essere diverse")
    try:
        metadata = analyze(source)
        italian = next(
            (track for track in metadata.get("audio", [])
             if str(track.get("language") or "").lower() in ("ita", "it", "it-it")),
            None,
        )
        if italian is None:
            shutil.copy2(source, target)
            print("Audio italiano non rilevato: originale conservato", flush=True)
            return

        codec = "copy" if italian.get("codec") == "aac" else "aac"
        command = [
            "ffmpeg", "-nostdin", "-y", "-v", "error",
            "-i", str(source), "-map", "0:V:0",
            "-map", f"0:{int(italian['index'])}",
            "-c:v", "copy", "-c:a", codec,
            "-disposition:a:0", "default",
            "-metadata:s:a:0", "language=ita",
            "-movflags", "+faststart", "-f", "mp4", str(target),
        ]
        subprocess.run(command, check=True)
        print("Audio italiano selezionato", flush=True)
    except Exception as error:
        target.unlink(missing_ok=True)
        raise OSError(f"Preparazione video non riuscita: {error}") from error
