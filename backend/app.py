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
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

log.info(f"Output directory: {OUTPUT_DIR}")

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
        # Realistically the python-pptx library does not support old .ppt format
        raise HTTPException(400, "Old PowerPoint .ppt format is not supported. Convert to .pptx and retry.")

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
    """Convert summary to speech using gTTS / Coqui TTS."""
    text = _get_text(req.file_id)
    log.info(f"Generating audio for {req.file_id}")

    summary  = generate_summary(text)
    out_path = OUTPUT_DIR / f"{req.file_id}_audio.mp3"
    generate_audio(summary, str(out_path))

    # Verify file was actually created and has content
    if out_path.exists() and out_path.stat().st_size > 500:
        log.info(f"Audio file ready: {out_path} ({out_path.stat().st_size} bytes)")
        return {
            "file_id":   req.file_id,
            "audio_url": f"/media/{req.file_id}_audio.mp3",
            "status":    "ok"
        }

    if out_path.exists():
        # A placeholder MP3 may be created even if TTS engines are not installed
        log.warning(f"Audio file created but below size threshold: {out_path} ({out_path.stat().st_size} bytes)")
        return {
            "file_id":   req.file_id,
            "audio_url": f"/media/{req.file_id}_audio.mp3",
            "status":    "fallback"
        }

    log.warning(f"Audio file missing or not created: {out_path}")
    return {
        "file_id":   req.file_id,
        "audio_url": None,
        "status":    "failed"
    }


@app.post("/generate/video")
async def api_video(req: GenerateRequest):
    """Generate slide-style explainer video using MoviePy + PIL."""
    text = _get_text(req.file_id)
    log.info(f"Generating video for {req.file_id}")

    summary  = generate_summary(text)
    out_path = OUTPUT_DIR / f"{req.file_id}_video.mp4"
    generate_video(summary, str(out_path))

    # Check if an MP4 file was created
    if out_path.exists() and out_path.stat().st_size > 10000:
        log.info(f"Video file ready: {out_path} ({out_path.stat().st_size} bytes)")
        return {
            "file_id":   req.file_id,
            "video_url": f"/media/{req.file_id}_video.mp4",
            "status":    "ok"
        }

    if out_path.exists():
        # The output may be a placeholder MP4 or text fallback file.
        log.warning(f"Video file created but below expected size: {out_path} ({out_path.stat().st_size} bytes)")
        return {
            "file_id":   req.file_id,
            "video_url": f"/media/{req.file_id}_video.mp4",
            "status":    "fallback"
        }

    # MoviePy not available — slides ZIP was created instead
    log.warning(f"Video not generated. Slides ZIP available.")
    return {
        "file_id":   req.file_id,
        "video_url": None,
        "status":    "slides_only",
        "slides_url": f"/media/{req.file_id}_video_slides.zip"
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
# This serves /media/xxx_audio.mp3 and /media/xxx_video.mp4
# IMPORTANT: mount AFTER all route definitions
app.mount("/media", StaticFiles(directory=str(OUTPUT_DIR)), name="media")