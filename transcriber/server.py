"""Whisper transcription sidecar for the mind-map app.

One job: audio in, transcript out. faster-whisper loads
mobiuslabsgmbh/faster-whisper-large-v3-turbo from the shared `whisper-cache`
Docker volume (mounted at HF_HOME) and auto-detects Catalan/Spanish/English.
The Node backend proxies /api/transcribe here; nothing else talks to this.
Derived from the (now retired) audio-transcriber project.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import FastAPI, File, HTTPException, UploadFile
from faster_whisper import WhisperModel

# Exact cached repo id — passing it directly (not the "turbo" alias) guarantees
# zero re-download regardless of the installed faster-whisper version.
MODEL_ID = os.environ.get("WHISPER_MODEL", "mobiuslabsgmbh/faster-whisper-large-v3-turbo")

STATE: dict = {"model": None}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load once at startup and keep warm. Cache-only first (instant, offline);
    # download only if the shared cache is empty (brand-new machine).
    try:
        STATE["model"] = WhisperModel(MODEL_ID, device="cpu", compute_type="int8", local_files_only=True)
        print(f"[transcriber] Loaded {MODEL_ID} from cache (offline).", flush=True)
    except Exception as exc:  # noqa: BLE001 — cache miss is the only expected cause
        print(f"[transcriber] Not in cache ({exc}); downloading {MODEL_ID} once...", flush=True)
        STATE["model"] = WhisperModel(MODEL_ID, device="cpu", compute_type="int8", local_files_only=False)
        print(f"[transcriber] Downloaded and loaded {MODEL_ID}.", flush=True)
    yield


app = FastAPI(title="mind-map transcriber", lifespan=lifespan)


@app.get("/health")
async def health():
    # uvicorn only serves once lifespan completes, so 200 implies model loaded.
    return {"ok": True, "model": MODEL_ID}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """Transcribe an uploaded clip. Language is auto-detected."""
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio upload.")

    suffix = Path(audio.filename or "audio").suffix or ".bin"
    tmp_path = None
    try:
        with NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        segments, info = STATE["model"].transcribe(tmp_path, language=None, vad_filter=True)
        # The generator is lazy and single-pass — materialize before deriving text.
        segs = [
            {"text": seg.text.strip(), "start": round(float(seg.start), 2), "end": round(float(seg.end), 2)}
            for seg in segments
        ]
        return {
            "text": " ".join(s["text"] for s in segs).strip(),
            "language": info.language,
            "language_probability": round(float(info.language_probability), 3),
            "duration": round(float(info.duration), 1),
            "segments": segs,
        }
    finally:
        if tmp_path:
            os.unlink(tmp_path)
