"""
tts_generator.py — Text-to-Speech Audio Generation
====================================================
Generates an MP3 audio narration of the AI summary.

Tries TTS engines in priority order:
  1. gTTS  (Google Text-to-Speech, requires internet) — primary
  2. pyttsx3 (offline system TTS)                     — fallback

No ffmpeg required: MP3 chunks from gTTS are concatenated at the
binary level (valid because gTTS produces standard MPEG frames).
pyttsx3 saves directly to WAV which is served as-is (browsers play WAV).

Course: Advanced Topics in Machine Learning (HTML)
"""

import logging
from pathlib import Path

log = logging.getLogger(__name__)

CHUNK_SIZE     = 500   # characters per gTTS request
MIN_AUDIO_BYTES = 500


def _is_real_audio(path: str) -> bool:
    p = Path(path)
    return p.exists() and p.stat().st_size > MIN_AUDIO_BYTES


def _split_text(text: str, chunk_size: int = CHUNK_SIZE) -> list:
    """Split text into sentence-aware chunks."""
    try:
        import nltk
        sentences = nltk.sent_tokenize(text)
    except Exception:
        sentences = text.split(". ")

    chunks, current = [], ""
    for sent in sentences:
        if len(current) + len(sent) < chunk_size:
            current += " " + sent
        else:
            if current.strip():
                chunks.append(current.strip())
            current = sent
    if current.strip():
        chunks.append(current.strip())
    return chunks or [text[:chunk_size]]


def _merge_mp3_binary(file_list: list, output_path: str):
    """
    Concatenate MP3 files by raw binary append — no ffmpeg needed.
    Works correctly for gTTS output (standard MPEG Layer 3 frames).
    """
    with open(output_path, "wb") as out:
        for f in file_list:
            p = Path(f)
            if p.exists() and p.stat().st_size > 0:
                out.write(p.read_bytes())
    log.info(f"Merged {len(file_list)} chunks → {output_path} "
             f"({Path(output_path).stat().st_size} bytes)")


def _cleanup(paths: list):
    for p in paths:
        try:
            Path(p).unlink(missing_ok=True)
        except Exception:
            pass


# ─── ENGINE 1: gTTS ──────────────────────────────────────────────
def _try_gtts(text: str, output_path: str) -> bool:
    try:
        from gtts import gTTS
        log.info("Generating audio with gTTS…")
        chunks = _split_text(text)

        if len(chunks) == 1:
            gTTS(text=chunks[0], lang="en", slow=False).save(output_path)
        else:
            tmp_files = []
            for i, chunk in enumerate(chunks):
                tmp = output_path.replace(".mp3", f"_chunk{i}.mp3")
                gTTS(text=chunk, lang="en", slow=False).save(tmp)
                tmp_files.append(tmp)
            _merge_mp3_binary(tmp_files, output_path)
            _cleanup(tmp_files)

        if _is_real_audio(output_path):
            log.info(f"gTTS OK → {output_path} ({Path(output_path).stat().st_size} B)")
            return True

        log.warning("gTTS produced a file that is too small.")
        return False

    except ImportError:
        log.info("gTTS not installed. Trying pyttsx3…")
        return False
    except Exception as e:
        log.warning(f"gTTS failed: {e}")
        return False


# ─── ENGINE 2: pyttsx3 (Windows only fallback) ───────────────────
def _try_pyttsx3(text: str, output_path: str) -> bool:
    """
    pyttsx3 only works on Windows (SAPI5). Skipped on Linux/HF Spaces.
    """
    import platform
    if platform.system() != "Windows":
        log.info("pyttsx3 skipped — only available on Windows.")
        return False
    try:
        import pyttsx3
        log.info("Generating audio with pyttsx3…")
        wav_path = output_path.replace(".mp3", ".wav")
        engine = pyttsx3.init()
        engine.setProperty("rate", 160)
        engine.setProperty("volume", 0.95)
        engine.save_to_file(text[:4000], wav_path)
        engine.runAndWait()

        if _is_real_audio(wav_path):
            import shutil
            shutil.copy(wav_path, output_path)
            Path(wav_path).unlink(missing_ok=True)
            log.info(f"pyttsx3 OK → {output_path} ({Path(output_path).stat().st_size} B)")
            return True

        log.warning("pyttsx3 produced no usable audio.")
        return False
    except Exception as e:
        log.warning(f"pyttsx3 failed: {e}")
        return False


# ─── MAIN API ────────────────────────────────────────────────────
def generate_audio(text: str, output_path: str) -> bool:
    """
    Generate audio from text. Returns True if a real file was written.
    No ffmpeg required.
    """
    if not text or not text.strip():
        text = "No content available for audio generation."

    full_text = f"Here is a summary of your document. {text}"

    for engine_fn in [_try_gtts, _try_pyttsx3]:
        if engine_fn(full_text, output_path):
            return True

    # Clean up any tiny artifact
    p = Path(output_path)
    if p.exists() and p.stat().st_size <= MIN_AUDIO_BYTES:
        try:
            p.unlink()
        except Exception:
            pass

    log.error("All TTS engines failed.")
    return False
