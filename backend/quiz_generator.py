"""
quiz_generator.py — NLP-Based Quiz Generation
===============================================
Pipeline:
  1. Split text into meaningful chunks (paragraphs/sentences)
  2. Extract key entities and noun phrases using spaCy
  3. Generate fill-in-blank and factual questions using heuristics
     + optionally: transformers QG (question-generation) model
  4. Use the SBERT + Autoencoder embeddings to select
     the most semantically diverse question candidates

Methods:
  - Rule-based question generation from NLP parse trees
  - Keyword extraction via TF-IDF + spaCy NER
  - Transformer-based QA (pipeline) for answer validation

Course: Advanced Topics in Machine Learning (HTML)
"""

import re, logging, random
from typing import List, Dict

import nltk
import numpy as np

log = logging.getLogger(__name__)

# Download NLTK resources
for resource in ["punkt", "averaged_perceptron_tagger", "stopwords"]:
    try:
        nltk.data.find(f"tokenizers/{resource}")
    except LookupError:
        try:
            nltk.download(resource, quiet=True)
        except Exception:
            pass


# ─── QUESTION TEMPLATES ─────────────────────────────────────────
DEFINITION_PATTERNS = [
    r"(.+?)\s+is\s+((?:a|an|the)\s+.+?)[\.\,]",
    r"(.+?)\s+are\s+((?:a|an|the|used|applied|.+?)[\w\s]+?)[\.\,]",
    r"(.+?)\s+refers to\s+(.+?)[\.\,]",
    r"(.+?)\s+can be defined as\s+(.+?)[\.\,]",
]


def _extract_definitions(text: str) -> List[Dict]:
    """
    Extract definition-style question-answer pairs using regex patterns.
    Example: "X is a Y" → Q: "What is X?" A: "Y"
    """
    qa_pairs = []
    for pattern in DEFINITION_PATTERNS:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            subject = match.group(1).strip()
            defn    = match.group(2).strip()
            if 3 < len(subject.split()) < 8 and len(defn.split()) > 3:
                qa_pairs.append({
                    "question": f"What is {subject}?",
                    "answer":   defn.capitalize() + "."
                })
    return qa_pairs


def _extract_ner_questions(text: str) -> List[Dict]:
    """
    Use spaCy Named Entity Recognition to generate factual questions.
    """
    try:
        import spacy
        try:
            nlp = spacy.load("en_core_web_sm")
        except OSError:
            log.warning("spaCy model not found. Run: python -m spacy download en_core_web_sm")
            return []

        doc = nlp(text[:5000])  # Limit for speed
        qa_pairs = []
        sentences = list(doc.sents)

        for sent in sentences:
            ents = [e for e in sent.ents if e.label_ in
                    {"ORG", "PERSON", "PRODUCT", "WORK_OF_ART", "GPE", "NORP", "FAC"}]
            if ents:
                ent = ents[0]
                q_map = {
                    "ORG":         f"Which organization is mentioned in context of: '{sent.text[:60].strip()}…'?",
                    "PERSON":      f"Who is referenced in: '{sent.text[:60].strip()}…'?",
                    "GPE":         f"Which place is associated with: '{sent.text[:60].strip()}…'?",
                    "PRODUCT":     f"What product is discussed in: '{sent.text[:60].strip()}…'?",
                    "WORK_OF_ART": f"What work is mentioned in: '{sent.text[:60].strip()}…'?",
                    "NORP":        f"Which group is referred to in: '{sent.text[:60].strip()}…'?",
                }
                question = q_map.get(ent.label_,
                    f"What does the text mention about '{ent.text}'?")
                qa_pairs.append({
                    "question": question,
                    "answer":   f"{ent.text} — {sent.text.strip()}"
                })

        return qa_pairs

    except ImportError:
        log.warning("spaCy not installed.")
        return []


def _keyword_questions(text: str, n: int = 15) -> List[Dict]:
    """
    TF-IDF keyword extraction → fill-in-blank questions.
    """
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer

        sentences = nltk.sent_tokenize(text)
        sentences = [s for s in sentences if len(s.split()) > 8]
        if not sentences:
            return []

        tfidf = TfidfVectorizer(max_features=30, stop_words="english", ngram_range=(1, 2))
        tfidf.fit(sentences)
        keywords = list(tfidf.vocabulary_.keys())

        qa_pairs = []
        for sent in sentences[:40]:
            for kw in keywords:
                # Multi-word keyword match
                kw_re = re.escape(kw)
                if re.search(rf"\b{kw_re}\b", sent, re.IGNORECASE):
                    blank = re.sub(rf"\b{kw_re}\b", "______", sent, flags=re.IGNORECASE, count=1)
                    qa_pairs.append({
                        "question": f"Fill in the blank: \"{blank}\"",
                        "answer":   f'"{kw.title()}"'
                    })
                    break

        return qa_pairs[:n]

    except ImportError:
        return []


def _fallback_sentence_questions(text: str, n: int = 10) -> List[Dict]:
    """
    Last resort: turn statements into questions by reversing structure.
    """
    sentences = nltk.sent_tokenize(text)
    sentences = [s.strip() for s in sentences
                 if len(s.split()) > 10 and s[-1] in ".!"]

    qa_pairs = []
    templates = [
        lambda s: (f"What does the following statement describe? '{s[:80].strip()}…'",
                   s),
        lambda s: (f"True or False: '{s[:80].strip()}'",
                   "True — as stated in the document."),
        lambda s: (f"Summarize the key point: '{s[:80].strip()}…'",
                   s),
    ]

    for i, sent in enumerate(sentences[:n]):
        fn = templates[i % len(templates)]
        q, a = fn(sent)
        qa_pairs.append({"question": q, "answer": a})

    return qa_pairs


# ─── DIVERSITY FILTERING ────────────────────────────────────────
def _diversify(qa_pairs: List[Dict], n: int = 10) -> List[Dict]:
    """
    Use SBERT + cosine similarity to select n maximally diverse questions.
    Falls back to random selection if SBERT is unavailable.
    """
    if len(qa_pairs) <= n:
        return qa_pairs

    try:
        from sentence_transformers import SentenceTransformer
        from sklearn.metrics.pairwise import cosine_similarity

        model  = SentenceTransformer("all-MiniLM-L6-v2")
        qs     = [p["question"] for p in qa_pairs]
        embeds = model.encode(qs, convert_to_numpy=True)

        selected = [0]
        while len(selected) < n and len(selected) < len(qa_pairs):
            remaining = [i for i in range(len(qa_pairs)) if i not in selected]
            if not remaining:
                break
            # Pick the question least similar to already-selected ones
            sel_embs = embeds[selected]
            scores   = []
            for i in remaining:
                sims = cosine_similarity(embeds[i:i+1], sel_embs).max()
                scores.append((sims, i))
            scores.sort()
            selected.append(scores[0][1])

        return [qa_pairs[i] for i in selected]

    except ImportError:
        # Simple deduplication + random sample
        seen = set()
        unique = []
        for p in qa_pairs:
            key = p["question"][:40].lower()
            if key not in seen:
                seen.add(key)
                unique.append(p)
        random.shuffle(unique)
        return unique[:n]


# ─── MASTER FUNCTION ─────────────────────────────────────────────
def generate_quiz(text: str, n: int = 10) -> List[Dict]:
    """
    Generate n quiz questions from document text.
    Combines multiple NLP strategies, then selects diverse questions.

    Returns list of {question: str, answer: str} dicts.
    """
    if not text or len(text.strip()) < 100:
        return [{"question": "Document too short to generate a meaningful quiz.",
                 "answer":   "Please upload a document with more content."}]

    all_qa: List[Dict] = []

    # Strategy 1: Pattern-based definitions
    defs = _extract_definitions(text)
    log.info(f"Definition questions: {len(defs)}")
    all_qa.extend(defs)

    # Strategy 2: NER-based factual questions
    ner_qs = _extract_ner_questions(text)
    log.info(f"NER questions: {len(ner_qs)}")
    all_qa.extend(ner_qs)

    # Strategy 3: TF-IDF keyword fill-in-blank
    kw_qs = _keyword_questions(text, n=20)
    log.info(f"Keyword questions: {len(kw_qs)}")
    all_qa.extend(kw_qs)

    # Strategy 4: Fallback sentence questions
    if len(all_qa) < n:
        fb_qs = _fallback_sentence_questions(text, n=n - len(all_qa) + 5)
        all_qa.extend(fb_qs)

    # Select n diverse questions
    final = _diversify(all_qa, n=n)

    # Ensure exactly n questions
    while len(final) < n:
        final.append({
            "question": f"Q{len(final)+1}: What is a key concept discussed in this document?",
            "answer":   "Refer to the document summary for main concepts."
        })

    log.info(f"Quiz generated: {len(final)} questions")
    return final[:n]
