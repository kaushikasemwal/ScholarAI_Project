"""
tts_generator.py — Text-to-Speech Audio Generation
====================================================
Generates an MP3 audio narration of the AI summary.

Tries TTS engines in priority order:
  1. Coqui TTS (high quality, offline, local neural TTS)
  2. gTTS (Google Text-to-Speech, requires internet)
  3. pyttsx3 (offline system TTS, lower quality)

The generated audio is saved as MP3 and served by the API.

Course: Advanced Topics in Machine Learning (HTML)
"""

import logging
import textwrap
from pathlib import Path

log = logging.getLogger(__name__)

# Maximum characters per TTS call (gTTS has a 100-word-per-call limit)
CHUNK_SIZE = 500


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


def _try_coqui(text: str, output_path: str) -> bool:
    """
    Attempt audio generation with Coqui TTS.
    Best quality offline TTS. Requires: pip install TTS
    """
    try:
        from TTS.api import TTS as CoquiTTS

        log.info("Generating audio with Coqui TTS…")
        tts = CoquiTTS(model_name="tts_models/en/ljspeech/tacotron2-DDC",
                       progress_bar=False, gpu=False)

        # Coqui TTS handles long text natively
        wav_path = output_path.replace(".mp3", ".wav")
        tts.tts_to_file(text=text[:3000], file_path=wav_path)

        # Convert WAV → MP3
        _wav_to_mp3(wav_path, output_path)
        Path(wav_path).unlink(missing_ok=True)
        log.info(f"Coqui TTS → {output_path}")
        return True

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
        import io

        log.info("Generating audio with gTTS…")
        chunks = _split_text(text)

        # For single chunk, direct approach
        if len(chunks) == 1:
            tts = gTTS(text=chunks[0], lang="en", slow=False)
            tts.save(output_path)
        else:
            # Merge multiple chunks
            import os
            tmp_files = []
            for i, chunk in enumerate(chunks):
                tmp_path = output_path.replace(".mp3", f"_chunk{i}.mp3")
                gTTS(text=chunk, lang="en", slow=False).save(tmp_path)
                tmp_files.append(tmp_path)

            _merge_mp3(tmp_files, output_path)
            for f in tmp_files:
                Path(f).unlink(missing_ok=True)

        log.info(f"gTTS → {output_path}")
        return True

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
        engine.setProperty("rate", 165)     # words per minute
        engine.setProperty("volume", 0.9)

        # Save to wav, then convert
        wav_path = output_path.replace(".mp3", ".wav")
        engine.save_to_file(text[:3000], wav_path)
        engine.runAndWait()

        _wav_to_mp3(wav_path, output_path)
        Path(wav_path).unlink(missing_ok=True)
        log.info(f"pyttsx3 → {output_path}")
        return True

    except ImportError:
        log.warning("pyttsx3 not installed.")
        return False
    except Exception as e:
        log.warning(f"pyttsx3 failed: {e}")
        return False


def _wav_to_mp3(wav_path: str, mp3_path: str):
    """Convert WAV to MP3 using pydub or ffmpeg."""
    try:
        from pydub import AudioSegment
        sound = AudioSegment.from_wav(wav_path)
        sound.export(mp3_path, format="mp3", bitrate="128k")
    except ImportError:
        # Fallback: rename (will be WAV served as MP3 — works for demo)
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
        # If pydub not available, just use the first chunk
        import shutil
        if file_list:
            shutil.copy(file_list[0], output_path)


def _write_placeholder(output_path: str, text: str):
    """
    Write a tiny valid-ish placeholder MP3 when all TTS engines fail.
    For demo purposes only — indicates no TTS engine is installed.
    """
    # Write a minimal text file as fallback (not a real MP3)
    Path(output_path).write_text(
        f"[PLACEHOLDER - Install gTTS or Coqui TTS to generate audio]\n\nScript:\n{text[:500]}"
    )
    log.warning(f"No TTS engine available. Wrote placeholder: {output_path}")


# ─── MAIN API ───────────────────────────────────────────────────
def generate_audio(text: str, output_path: str) -> str:
    """
    Generate MP3 audio from text using best available TTS engine.

    Args:
        text:        The text to convert to speech (typically the summary)
        output_path: Full path where the MP3 file should be saved

    Returns:
        output_path on success
    """
    if not text or not text.strip():
        text = "No content available for audio generation."

    # Add intro sentence for better audio UX
    full_text = f"Here is a summary of your document. {text}"

    # Try engines in order of quality
    for engine_fn in [_try_coqui, _try_gtts, _try_pyttsx3]:
        if engine_fn(full_text, output_path):
            return output_path

    # All failed — write placeholder
    _write_placeholder(output_path, text)
    return output_path
