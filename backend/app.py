"""
ScholarAI — Backend API
========================
FastAPI application that orchestrates the full ML pipeline.

Endpoints:
  POST /upload               → Upload & encrypt PDF/PPTX
  POST /generate/summary     → Run summarization pipeline
  POST /generate/quiz        → Run quiz generation
  POST /generate/audio       → Run text-to-speech
  POST /generate/video       → Run video generation
  GET  /media/{filename}     → Served automatically via StaticFiles mount
  GET  /media-check/{filename} → Debug: verify file exists + size
  DELETE /cleanup/{file_id}  → Manual cleanup

Author : ScholarAI Project
Course : Advanced Topics in Machine Learning (HTML)
"""

import os, uuid, time, logging, threading
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .utils import encrypt_file, decrypt_file, cleanup_old_files
from .summarizer import generate_summary
from .quiz_generator import generate_quiz
from .tts_generator import generate_audio
from .video_generator import generate_video

# ─── LOGGING ─────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s"
)
log = logging.getLogger(__name__)

# ─── DIRECTORIES ─────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"

# Always create dirs before anything else — StaticFiles mount will fail
# silently if OUTPUT_DIR doesn't exist at startup
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

log.info(f"Upload directory : {UPLOAD_DIR} (exists={UPLOAD_DIR.exists()})")
log.info(f"Output directory : {OUTPUT_DIR} (exists={OUTPUT_DIR.exists()})")

# In-memory store: file_id → { path, created_at, extracted_text }
FILE_STORE: dict[str, dict] = {}
AUTO_DELETE_SECONDS = 3600  # 1 hour

# ─── APP ─────────────────────────────────────────────────────────
app = FastAPI(
    title="ScholarAI API",
    description="AI-powered Study Assistant — ML Pipeline Backend",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── MODELS ──────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    file_id: str

# ─── STARTUP CHECK ───────────────────────────────────────────────
@app.on_event("startup")
async def startup_check():
    """Verify directories exist and log their state at startup."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    log.info(f"[startup] uploads dir OK  : {UPLOAD_DIR}")
    log.info(f"[startup] outputs dir OK  : {OUTPUT_DIR}")
    log.info("[startup] StaticFiles mount for /media will serve from outputs/")

# ─── BACKGROUND AUTO-CLEANUP ─────────────────────────────────────
def auto_cleanup_daemon():
    """Background thread that periodically deletes old uploaded files."""
    while True:
        time.sleep(300)
        expired = [
            fid for fid, meta in list(FILE_STORE.items())
            if time.time() - meta["created_at"] > AUTO_DELETE_SECONDS
        ]
        for fid in expired:
            try:
                p = FILE_STORE[fid].get("path")
                if p and Path(p).exists():
                    Path(p).unlink()
                    log.info(f"Auto-deleted file {fid}")
                del FILE_STORE[fid]
            except Exception as e:
                log.warning(f"Cleanup error for {fid}: {e}")

threading.Thread(target=auto_cleanup_daemon, daemon=True).start()

# ─── ENDPOINTS ───────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"message": "ScholarAI API is running. See /docs for endpoints."}


@app.get("/media-check/{filename}")
async def media_check(filename: str):
    """
    Debug endpoint — verify a media file exists on disk and return its size.
    Use this from the browser to diagnose 'audio won't play' issues.

    Example: GET /media-check/abc123_audio.mp3
    """
    p = OUTPUT_DIR / filename
    if p.exists():
        size = p.stat().st_size
        # A real MP3 from gTTS is always > 1 KB; our placeholder is < 200 bytes
        is_likely_real = size > 500
        return {
            "exists": True,
            "size_bytes": size,
            "is_likely_real_audio": is_likely_real,
            "path": str(p),
        }
    return {"exists": False, "filename": filename}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Accept PDF or PPTX, AES-encrypt it, store temporarily."""
    allowed_types = {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint"
    }
    allowed_exts = {".pdf", ".pptx", ".ppt"}

    ext = Path(file.filename).suffix.lower()
    if file.content_type not in allowed_types and ext not in allowed_exts:
        raise HTTPException(400, "Only PDF and PPTX files are accepted.")

    file_id       = str(uuid.uuid4())
    raw_bytes     = await file.read()
    encrypted     = encrypt_file(raw_bytes)
    save_path     = UPLOAD_DIR / f"{file_id}{ext}.enc"
    save_path.write_bytes(encrypted)

    FILE_STORE[file_id] = {
        "path":       str(save_path),
        "ext":        ext,
        "filename":   file.filename,
        "created_at": time.time(),
        "text":       None
    }

    log.info(f"Uploaded & encrypted: {file.filename} → {file_id}")
    return {"file_id": file_id, "filename": file.filename, "status": "uploaded"}


def _get_text(file_id: str) -> str:
    """Decrypt file and extract text (cached after first call)."""
    if file_id not in FILE_STORE:
        raise HTTPException(404, "File not found. Please re-upload.")

    meta = FILE_STORE[file_id]
    if meta["text"]:
        return meta["text"]

    enc_path = Path(meta["path"])
    if not enc_path.exists():
        raise HTTPException(404, "Encrypted file missing from disk.")

    raw_bytes = decrypt_file(enc_path.read_bytes())
    ext = meta["ext"]

    from .utils import extract_text_pdf, extract_text_pptx

    if ext == ".pdf":
        text = extract_text_pdf(raw_bytes)
    elif ext == ".pptx":
        text = extract_text_pptx(raw_bytes)
    else:
        raise HTTPException(
            400,
            "Old PowerPoint .ppt format is not supported. Convert to .pptx and retry."
        )

    meta["text"] = text
    log.info(f"Extracted {len(text)} chars from {file_id}")
    return text


@app.post("/generate/summary")
async def api_summary(req: GenerateRequest):
    """Run SBERT → Autoencoder → BART summarization pipeline."""
    text = _get_text(req.file_id)
    log.info(f"Generating summary for {req.file_id}")
    summary = generate_summary(text)
    return {"file_id": req.file_id, "summary": summary, "status": "ok"}


@app.post("/generate/quiz")
async def api_quiz(req: GenerateRequest):
    """Generate 10-question quiz using NLP pipeline."""
    text = _get_text(req.file_id)
    log.info(f"Generating quiz for {req.file_id}")
    questions = generate_quiz(text, n=10)
    return {"file_id": req.file_id, "questions": questions, "status": "ok"}


@app.post("/generate/audio")
async def api_audio(req: GenerateRequest):
    """
    Convert summary to speech using gTTS / Coqui TTS / pyttsx3.

    Returns:
      status "ok"       → real audio file created, audio_url is playable
      status "failed"   → no TTS engine produced a valid file
    """
    text = _get_text(req.file_id)
    log.info(f"Generating audio for {req.file_id}")

    summary  = generate_summary(text)
    out_path = OUTPUT_DIR / f"{req.file_id}_audio.mp3"

    # generate_audio now returns True only when a real audio file (>500 B) exists
    success = generate_audio(summary, str(out_path))

    if success:
        size = out_path.stat().st_size
        log.info(f"Audio ready: {out_path} ({size} bytes)")
        return {
            "file_id":   req.file_id,
            "audio_url": f"/media/{req.file_id}_audio.mp3",
            "status":    "ok",
        }

    # Nothing worked — tell the frontend exactly why
    log.warning(f"Audio generation failed for {req.file_id}")
    return {
        "file_id":   req.file_id,
        "audio_url": None,
        "status":    "failed",
        "message":   (
            "No TTS engine produced a valid audio file. "
            "Make sure gTTS is installed (pip install gtts) "
            "and that you have an active internet connection, "
            "or install pyttsx3 for offline TTS."
        ),
    }


@app.post("/generate/video")
async def api_video(req: GenerateRequest):
    """Generate slide-style explainer video using MoviePy + PIL."""
    text = _get_text(req.file_id)
    log.info(f"Generating video for {req.file_id}")

    summary  = generate_summary(text)
    out_path = OUTPUT_DIR / f"{req.file_id}_video.mp4"
    generate_video(summary, str(out_path))

    # A real MP4 is always several KB; a placeholder text file is tiny
    if out_path.exists() and out_path.stat().st_size > 10_000:
        size = out_path.stat().st_size
        log.info(f"Video ready: {out_path} ({size} bytes)")
        return {
            "file_id":   req.file_id,
            "video_url": f"/media/{req.file_id}_video.mp4",
            "status":    "ok",
        }

    # MoviePy not available — check for slides ZIP fallback
    zip_path = OUTPUT_DIR / f"{req.file_id}_video_slides.zip"
    if zip_path.exists():
        log.info(f"Video not generated; slides ZIP available: {zip_path}")
        return {
            "file_id":    req.file_id,
            "video_url":  None,
            "status":     "slides_only",
            "slides_url": f"/media/{req.file_id}_video_slides.zip",
            "message":    "MoviePy/ffmpeg not available. Download slide images instead.",
        }

    log.warning(f"Video generation produced no usable output for {req.file_id}")
    return {
        "file_id":   req.file_id,
        "video_url": None,
        "status":    "failed",
        "message":   (
            "Video generation failed. "
            "Install MoviePy and ffmpeg: pip install moviepy && "
            "download ffmpeg from https://ffmpeg.org and add to PATH."
        ),
    }


@app.delete("/cleanup/{file_id}")
async def manual_cleanup(file_id: str):
    """Manually delete a file and its outputs."""
    if file_id not in FILE_STORE:
        raise HTTPException(404, "File ID not found.")
    meta = FILE_STORE.pop(file_id)
    p = Path(meta["path"])
    if p.exists():
        p.unlink()
    for suffix in ["_audio.mp3", "_video.mp4", "_video_slides.zip"]:
        out = OUTPUT_DIR / f"{file_id}{suffix}"
        if out.exists():
            out.unlink()
    return {"status": "deleted", "file_id": file_id}


# ─── STATIC FILES (must be LAST) ─────────────────────────────────
# Serves /media/xxx_audio.mp3 and /media/xxx_video.mp4
# IMPORTANT: mount AFTER all route definitions so /media-check route
# is registered first and is not shadowed by the static mount.
app.mount("/media", StaticFiles(directory=str(OUTPUT_DIR)), name="media")