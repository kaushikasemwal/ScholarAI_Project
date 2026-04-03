# ScholarAI — AI-Powered Study Assistant
### Advanced Topics in Machine Learning · HTML Course Project

---

## 📋 Project Overview

ScholarAI is a full-stack, end-to-end AI study assistant that accepts PDF or PowerPoint documents and produces:

| Output | Technology |
|--------|-----------|
| AI Summary | Sentence-BERT → Autoencoder → BART |
| 10-Question Quiz | spaCy NER + TF-IDF + NLP heuristics |
| Audio Narration | gTTS / Coqui TTS |
| Explainer Video | MoviePy + PIL |
| Encrypted Upload | AES-256 (Fernet) |

---

## 🗂️ Project Structure

```
project/
├── frontend/
│   ├── index.html          ← Main UI (dark academic design)
│   ├── styles.css          ← CSS variables, responsive layout
│   └── script.js           ← File upload, API calls, result rendering
│
├── backend/
│   ├── app.py              ← FastAPI application, REST endpoints
│   ├── summarizer.py       ← SBERT → Autoencoder → BART pipeline
│   ├── quiz_generator.py   ← NLP quiz generation (NER + TF-IDF)
│   ├── autoencoder.py      ← PyTorch semantic autoencoder (ADVANCED ML)
│   ├── video_generator.py  ← MoviePy slide-style video builder
│   ├── tts_generator.py    ← Text-to-speech (Coqui / gTTS / pyttsx3)
│   └── utils.py            ← AES encryption, PDF/PPTX parsing, cleanup
│
├── models/                 ← Saved autoencoder weights (.pt)
├── uploads/                ← Encrypted uploaded files (auto-deleted)
├── outputs/                ← Generated audio/video files
├── requirements.txt
└── README.md
```

---

## 🚀 Quick Start

### 1. Clone and Set Up

```bash
git clone https://github.com/your-username/scholarai.git
cd scholarai
```

### 2. Create Virtual Environment (recommended)

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS / Linux
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Download NLP Models

```bash
# spaCy English model
python -m spacy download en_core_web_sm

# NLTK data
python -c "import nltk; nltk.download('punkt'); nltk.download('stopwords')"
```

### 5. (Optional) Pre-train the Autoencoder

```bash
python backend/autoencoder.py
# Trains on a sample corpus and saves weights to models/autoencoder_weights.pt
```

### 6. Start the Backend API

```bash
cd backend
uvicorn app:app --reload --port 8000
# API docs at: http://localhost:8000/docs
```

### 7. Open the Frontend

Open `frontend/index.html` in your browser, **or** serve it:

```bash
# Simple Python HTTP server
cd frontend
python -m http.server 3000
# Visit: http://localhost:3000
```

---

## 🖥️ Google Colab Setup

```python
# Cell 1: Install dependencies
!pip install -q fastapi uvicorn python-multipart transformers \
    sentence-transformers torch scikit-learn nltk spacy \
    pymupdf python-pptx gTTS moviepy Pillow cryptography \
    pydub pyttsx3

# Cell 2: Download models
!python -m spacy download en_core_web_sm
import nltk
nltk.download('punkt')
nltk.download('stopwords')

# Cell 3: Start backend with ngrok tunnel
!pip install -q pyngrok
from pyngrok import ngrok
import subprocess, time

proc = subprocess.Popen(
    ["uvicorn", "backend.app:app", "--port", "8000"],
    cwd="/content/scholarai"
)
time.sleep(3)
public_url = ngrok.connect(8000)
print(f"API URL: {public_url}")
# Update API_BASE in frontend/script.js to this URL

# Cell 4: Upload and test
# Use the Colab Files panel to upload a PDF, then call the API
```

---

## 🧠 ML Pipeline Explained

### Full Pipeline

```
PDF/PPTX Upload
    ↓ (AES-256 Encryption)
Text Extraction  ─── PyMuPDF / python-pptx
    ↓
Preprocessing  ─── NLTK: tokenize, clean, filter
    ↓
Sentence-BERT  ─── all-MiniLM-L6-v2 → 384-dim embeddings
    ↓
AUTOENCODER  ──── 384 → 256 → 128 (latent) → 256 → 384
    ↓                ↑ ADVANCED ML COMPONENT
Key Sentence Selection (cosine similarity to centroid)
    ↓
BART Summarizer ── facebook/bart-large-cnn → abstractive summary
    ↓
┌─────────────────────────────────────────────┐
│  Quiz (spaCy NER + TF-IDF + heuristics)     │
│  Audio (gTTS / Coqui TTS → MP3)             │
│  Video (MoviePy + PIL → MP4)                │
└─────────────────────────────────────────────┘
```

### Autoencoder Architecture

```
Encoder:
  Input(384) → Linear(512) → BN → ReLU → Dropout(0.1)
             → Linear(256) → BN → ReLU → Dropout(0.1)
             → Linear(128) → Tanh → Latent(128)

Decoder:
  Latent(128) → Linear(256) → BN → ReLU
              → Linear(512) → BN → ReLU
              → Linear(384) → Output(384)

Loss:     MSE(input, reconstructed)
Optimizer: Adam (lr=1e-3, weight_decay=1e-5)
Scheduler: StepLR (step=20, gamma=0.5)
```

**Why use an Autoencoder?**
- Sentence-BERT produces 384-dim vectors with many correlated dimensions
- The AE compresses this to 128-dim, forcing it to retain only the most informative features
- Result: cleaner sentence selection → more coherent BART summaries
- Compression ratio: 3× (384 → 128)

### Evaluation Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| Reconstruction MSE | How well AE reconstructs embeddings | < 0.01 |
| Cosine Similarity | Semantic preservation | > 0.95 |
| ROUGE-1 | Summary word overlap | > 0.40 |
| ROUGE-2 | Bigram overlap | > 0.20 |
| ROUGE-L | Longest common subsequence | > 0.35 |

---

## 🔐 Security

- Files encrypted with **AES-256** (Fernet) before disk storage
- Each file assigned a UUID, not the original filename
- Auto-deleted after **1 hour** (configurable via `AUTO_DELETE_SECONDS`)
- API endpoints validate file types (PDF/PPTX only)
- CORS configured (restrict in production deployment)

To set a persistent encryption key:
```bash
export AES_KEY=$(python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())")
```

---

## 🔌 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | / | Health check |
| POST | /upload | Upload & encrypt file |
| POST | /generate/summary | Generate AI summary |
| POST | /generate/quiz | Generate quiz |
| POST | /generate/audio | Generate audio MP3 |
| POST | /generate/video | Generate video MP4 |
| GET | /media/{filename} | Download generated file |
| DELETE | /cleanup/{file_id} | Delete file immediately |

Full interactive docs: **http://localhost:8000/docs**

---

## 📦 Windows-Specific Notes

- MoviePy requires **FFmpeg**: Download from https://ffmpeg.org and add to PATH
- For pyttsx3 on Windows, SAPI5 voices are used automatically
- If `torch` install fails: `pip install torch --index-url https://download.pytorch.org/whl/cpu`

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| `ModuleNotFoundError: fitz` | `pip install pymupdf` |
| `No module named 'TTS'` | `pip install TTS` (or gTTS will be used) |
| `spacy model not found` | `python -m spacy download en_core_web_sm` |
| `moviepy ffmpeg error` | Install FFmpeg and add to PATH |
| Video generation slow | Reduce `SLIDE_DURATION` in `video_generator.py` |
| BART OOM error | Reduce `max_sentences` in `summarizer.py` |

---

## 👨‍💻 Author

ScholarAI · Built for HTML Course — Advanced Topics in Machine Learning  
Technologies: FastAPI · PyTorch · HuggingFace · Sentence-BERT · spaCy · MoviePy
