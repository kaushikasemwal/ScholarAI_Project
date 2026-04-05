"""
tts_generator.py — Text-to-Speech Audio Generation
====================================================
Generates an MP3 audio narration of the AI summary.

Tries TTS engines in priority order:
  1. Coqui TTS (high quality, offline, local neural TTS)
  2. gTTS (Google Text-to-Speech, requires internet)
  3. pyttsx3 (offline system TTS, lower quality)

KEY CHANGE: generate_audio() now returns True/False instead of a path,
so the API can reliably tell whether a real audio file was produced.
A fake placeholder is never written — the caller handles the failure case.

Course: Advanced Topics in Machine Learning (HTML)
"""

import logging
from pathlib import Path

log = logging.getLogger(__name__)

CHUNK_SIZE = 500
MIN_AUDIO_BYTES = 500  # anything smaller is not a real audio file


def _split_text(text: str, chunk_size: int = CHUNK_SIZE) -> list:
    """Split long text into chunks that fit TTS engine limits."""
    import nltk
    try:
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


def _is_real_audio(path: str) -> bool:
    """Return True only if the file exists and is large enough to be real audio."""
    p = Path(path)
    return p.exists() and p.stat().st_size > MIN_AUDIO_BYTES


def _try_coqui(text: str, output_path: str) -> bool:
    """
    Attempt audio generation with Coqui TTS.
    Best quality offline TTS. Requires: pip install TTS
    """
    try:
        from TTS.api import TTS as CoquiTTS

        log.info("Generating audio with Coqui TTS…")
        tts = CoquiTTS(
            model_name="tts_models/en/ljspeech/tacotron2-DDC",
            progress_bar=False,
            gpu=False,
        )

        wav_path = output_path.replace(".mp3", ".wav")
        tts.tts_to_file(text=text[:3000], file_path=wav_path)
        _wav_to_mp3(wav_path, output_path)
        Path(wav_path).unlink(missing_ok=True)

        if _is_real_audio(output_path):
            log.info(f"Coqui TTS OK → {output_path} ({Path(output_path).stat().st_size} B)")
            return True

        log.warning("Coqui TTS ran but output file is too small.")
        return False

    except ImportError:
        log.info("Coqui TTS not installed. Trying gTTS…")
        return False
    except Exception as e:
        log.warning(f"Coqui TTS failed: {e}")
        return False


def _try_gtts(text: str, output_path: str) -> bool:
    """
    Attempt audio generation with Google TTS (gTTS).
    Requires internet connection. pip install gtts
    """
    try:
        from gtts import gTTS

        log.info("Generating audio with gTTS…")
        chunks = _split_text(text)

        if len(chunks) == 1:
            gTTS(text=chunks[0], lang="en", slow=False).save(output_path)
        else:
            tmp_files = []
            for i, chunk in enumerate(chunks):
                tmp_path = output_path.replace(".mp3", f"_chunk{i}.mp3")
                gTTS(text=chunk, lang="en", slow=False).save(tmp_path)
                tmp_files.append(tmp_path)
            _merge_mp3(tmp_files, output_path)
            for f in tmp_files:
                Path(f).unlink(missing_ok=True)

        if _is_real_audio(output_path):
            log.info(f"gTTS OK → {output_path} ({Path(output_path).stat().st_size} B)")
            return True

        log.warning("gTTS ran but output file is too small.")
        return False

    except ImportError:
        log.info("gTTS not installed. Trying pyttsx3…")
        return False
    except Exception as e:
        log.warning(f"gTTS failed: {e}")
        return False


def _try_pyttsx3(text: str, output_path: str) -> bool:
    """
    Attempt audio generation with pyttsx3 (offline, system TTS).
    pip install pyttsx3
    """
    try:
        import pyttsx3

        log.info("Generating audio with pyttsx3…")
        engine = pyttsx3.init()
        engine.setProperty("rate", 165)
        engine.setProperty("volume", 0.9)

        wav_path = output_path.replace(".mp3", ".wav")
        engine.save_to_file(text[:3000], wav_path)
        engine.runAndWait()

        _wav_to_mp3(wav_path, output_path)
        Path(wav_path).unlink(missing_ok=True)

        if _is_real_audio(output_path):
            log.info(f"pyttsx3 OK → {output_path} ({Path(output_path).stat().st_size} B)")
            return True

        log.warning("pyttsx3 ran but output file is too small.")
        return False

    except ImportError:
        log.warning("pyttsx3 not installed. All TTS engines exhausted.")
        return False
    except Exception as e:
        log.warning(f"pyttsx3 failed: {e}")
        return False


def _wav_to_mp3(wav_path: str, mp3_path: str):
    """Convert WAV to MP3 using pydub or copy as fallback."""
    try:
        from pydub import AudioSegment
        sound = AudioSegment.from_wav(wav_path)
        sound.export(mp3_path, format="mp3", bitrate="128k")
    except ImportError:
        import shutil
        shutil.copy(wav_path, mp3_path)


def _merge_mp3(file_list: list, output_path: str):
    """Concatenate multiple MP3 files into one."""
    try:
        from pydub import AudioSegment
        combined = AudioSegment.empty()
        for f in file_list:
            combined += AudioSegment.from_mp3(f)
        combined.export(output_path, format="mp3", bitrate="128k")
    except ImportError:
        import shutil
        if file_list:
            shutil.copy(file_list[0], output_path)


# ─── MAIN API ───────────────────────────────────────────────────
def generate_audio(text: str, output_path: str) -> bool:
    """
    Generate MP3 audio from text using the best available TTS engine.

    Args:
        text:        The text to convert to speech (typically the AI summary).
        output_path: Full path where the MP3 file should be saved.

    Returns:
        True  → a real MP3 file was written to output_path (size > 500 B).
        False → no TTS engine succeeded; nothing useful was written to disk.

    NOTE: This function deliberately does NOT write a placeholder file on
    failure. The API endpoint handles the failure case and returns a clear
    error message to the frontend instead of serving a broken file.
    """
    if not text or not text.strip():
        text = "No content available for audio generation."

    full_text = f"Here is a summary of your document. {text}"

    for engine_fn in [_try_coqui, _try_gtts, _try_pyttsx3]:
        if engine_fn(full_text, output_path):
            return True

    # Clean up any zero-byte or tiny file that may have been created
    p = Path(output_path)
    if p.exists() and p.stat().st_size <= MIN_AUDIO_BYTES:
        try:
            p.unlink()
            log.info(f"Removed empty/tiny audio artifact: {output_path}")
        except Exception:
            pass

    log.error(
        "All TTS engines failed. "
        "Install gTTS (pip install gtts) for online TTS or "
        "pyttsx3 (pip install pyttsx3) for offline TTS."
    )
    return False