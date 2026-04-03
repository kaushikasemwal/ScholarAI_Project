"""
summarizer.py — Summarization Pipeline
========================================
Pipeline:
  1. Split text into sentences (NLTK)
  2. Encode with Sentence-BERT (all-MiniLM-L6-v2) → 384-dim embeddings
  3. Pass through trained Autoencoder → 128-dim compressed embeddings
  4. Select top-k representative sentences via cosine similarity to centroid
  5. Feed compressed context into BART (facebook/bart-large-cnn) for abstractive summary

Why the Autoencoder?
  Sentence-BERT embeddings are 384-dim (or 768-dim for larger models).
  The autoencoder learns a compressed, denoised latent representation.
  This removes redundant dimensions, surfaces core semantic signals,
  and provides a cleaner input for the downstream summarizer.

Course: Advanced Topics in Machine Learning (HTML)
"""

import logging
import textwrap
from typing import List, Optional

import nltk
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

log = logging.getLogger(__name__)

# Download NLTK data on first run
try:
    nltk.data.find("tokenizers/punkt")
except LookupError:
    nltk.download("punkt", quiet=True)

# ─── LAZY MODEL LOADING ─────────────────────────────────────────
_sbert_model = None
_bart_model   = None
_bart_tok     = None
_autoencoder  = None


def _load_sbert():
    global _sbert_model
    if _sbert_model is None:
        from sentence_transformers import SentenceTransformer
        log.info("Loading Sentence-BERT model…")
        _sbert_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _sbert_model


def _load_bart():
    global _bart_model, _bart_tok
    if _bart_model is None:
        from transformers import BartTokenizer, BartForConditionalGeneration
        log.info("Loading BART model (facebook/bart-large-cnn)…")
        _bart_tok   = BartTokenizer.from_pretrained("facebook/bart-large-cnn")
        _bart_model = BartForConditionalGeneration.from_pretrained("facebook/bart-large-cnn")
    return _bart_model, _bart_tok


def _load_autoencoder(input_dim: int = 384):
    """Load or initialize the autoencoder. Tries saved weights first."""
    global _autoencoder
    if _autoencoder is None:
        from autoencoder import SemanticAutoencoder
        ae = SemanticAutoencoder(input_dim=input_dim, latent_dim=128)
        ae.try_load_weights()
        _autoencoder = ae
    return _autoencoder


# ─── CORE PIPELINE ──────────────────────────────────────────────

def preprocess_text(text: str, max_sentences: int = 80) -> List[str]:
    """
    Step 1 — Preprocessing with NLTK.
    Tokenize into sentences, clean whitespace, filter short noise.
    """
    sentences = nltk.sent_tokenize(text)
    sentences = [s.strip() for s in sentences if len(s.split()) > 6]
    if len(sentences) > max_sentences:
        # Keep evenly-spaced sample to preserve document structure
        idx = np.linspace(0, len(sentences) - 1, max_sentences, dtype=int)
        sentences = [sentences[i] for i in idx]
    return sentences


def embed_sentences(sentences: List[str]) -> np.ndarray:
    """
    Step 2 — Sentence-BERT embeddings.
    Returns shape (n_sentences, embedding_dim).
    """
    model = _load_sbert()
    embeddings = model.encode(sentences, batch_size=32,
                               show_progress_bar=False, convert_to_numpy=True)
    log.info(f"SBERT: encoded {len(sentences)} sentences → {embeddings.shape}")
    return embeddings


def compress_embeddings(embeddings: np.ndarray) -> np.ndarray:
    """
    Step 3 — Autoencoder compression.
    768-dim (or 384-dim) → 128-dim latent space.
    Removes redundancy; improves semantic focus.
    """
    ae = _load_autoencoder(input_dim=embeddings.shape[1])
    compressed = ae.encode(embeddings)  # returns (n, 128) np.ndarray
    log.info(f"Autoencoder: compressed to {compressed.shape}")
    return compressed


def select_key_sentences(sentences: List[str],
                          compressed: np.ndarray,
                          top_k: int = 8) -> str:
    """
    Step 4 — Sentence selection via centroid similarity.
    Compute centroid of latent embeddings; pick top-k closest.
    Maintains original document order for coherent BART input.
    """
    centroid  = compressed.mean(axis=0, keepdims=True)          # (1, 128)
    sims      = cosine_similarity(compressed, centroid).flatten()  # (n,)
    top_idx   = np.argsort(sims)[::-1][:top_k]
    top_idx   = sorted(top_idx.tolist())   # restore order
    selected  = [sentences[i] for i in top_idx]
    return " ".join(selected)


def abstractive_summary(context: str,
                         max_length: int = 512,
                         min_length: int = 160) -> str:
    """
    Step 5 — BART abstractive summarization.
    Generates a fluent, coherent summary from the selected context.
    """
    model, tok = _load_bart()

    # Truncate context to BART's 1024-token limit
    inputs = tok(context, return_tensors="pt",
                  max_length=1024, truncation=True)

    summary_ids = model.generate(
        inputs["input_ids"],
        max_length=max_length,
        min_length=min_length,
        num_beams=4,
        length_penalty=2.0,
        early_stopping=True
    )
    summary = tok.decode(summary_ids[0], skip_special_tokens=True)
    return summary


def generate_summary(text: str) -> str:
    """
    Master function — full summarization pipeline.
    Called by the API endpoint.
    """
    if not text or len(text.strip()) < 50:
        return "Insufficient text content found in document."

    try:
        # Step 1: Preprocess
        sentences = preprocess_text(text, max_sentences=80)
        if not sentences:
            return "Could not extract readable sentences from document."

        # Step 2: SBERT embeddings
        embeddings = embed_sentences(sentences)

        # Step 3: Autoencoder compression
        compressed = compress_embeddings(embeddings)

        # Step 4: Key sentence selection
        context = select_key_sentences(sentences, compressed, top_k=15)

        # Step 5: BART summary
        summary = abstractive_summary(context)
        log.info(f"Summary generated: {len(summary)} chars")
        return summary

    except ImportError as e:
        log.warning(f"ML libraries not installed, using extractive fallback: {e}")
        return extractive_fallback(text)

    except Exception as e:
        log.error(f"Summary pipeline error: {e}", exc_info=True)
        return extractive_fallback(text)


def extractive_fallback(text: str, n_sentences: int = 5) -> str:
    """
    Fallback: simple extractive summary using sentence frequency.
    Used when transformer models are unavailable.
    """
    try:
        sentences = nltk.sent_tokenize(text)
        if not sentences:
            return text[:500]

        # Word frequency scoring
        words = nltk.word_tokenize(text.lower())
        stop_words = set(nltk.corpus.stopwords.words("english")) if hasattr(nltk.corpus, "stopwords") else set()
        freq: dict = {}
        for w in words:
            if w.isalpha() and w not in stop_words:
                freq[w] = freq.get(w, 0) + 1

        # Score sentences
        scores = {}
        for i, sent in enumerate(sentences):
            s = 0
            for w in nltk.word_tokenize(sent.lower()):
                s += freq.get(w, 0)
            scores[i] = s

        top_idx = sorted(sorted(scores, key=scores.get, reverse=True)[:n_sentences])
        return " ".join(sentences[i] for i in top_idx)
    except Exception:
        return text[:800]
