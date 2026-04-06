/**
 * ScholarAI — Main App Script
 * Free-tier Firebase: Auth + Firestore only (no Storage).
 * Audio is persisted as base64 in Firestore.
 * Video URL is stored as a string; re-generate button shown if expired.
 */

import { auth, db, provider } from "./firebase-config.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, addDoc, getDocs, updateDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Switch to your deployed URL when running in production
const API_BASE = "http://localhost:8000";

// ─── STATE ────────────────────────────────────────────────────────
let currentUser    = null;
let uploadedFileId = null;
let currentDocRef  = null;
let currentFile    = null;

// ─── AUTH GUARD ───────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;
  showUserInfo(user);
  await loadHistory();
});

function showUserInfo(user) {
  const pill   = document.getElementById("userPill");
  const avatar = document.getElementById("userAvatar");
  const name   = document.getElementById("userName");

  if (user.photoURL) avatar.src = user.photoURL;
  else avatar.style.display = "none";

  name.textContent = user.displayName || user.email.split("@")[0];
  pill.style.display = "flex";
  document.getElementById("signOutBtn").style.display = "inline-block";
}

window.handleSignOut = async function () {
  await signOut(auth);
  window.location.href = "login.html";
};

// ─── DOM REFS ─────────────────────────────────────────────────────
const dropZone  = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileInfo  = document.getElementById("fileInfo");
const fileName  = document.getElementById("fileName");
const fileSize  = document.getElementById("fileSize");

// ─── DRAG-AND-DROP ────────────────────────────────────────────────
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault(); dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault(); dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});
dropZone.addEventListener("click", (e) => {
  if (e.target.classList.contains("btn-browse")) return;
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
});

// ─── FILE HANDLING ────────────────────────────────────────────────
function handleFile(file) {
  const ext = "." + file.name.split(".").pop().toLowerCase();
  if (![".pdf", ".pptx", ".ppt"].includes(ext)) {
    showToast("Only PDF and PPTX files are supported.", "error"); return;
  }
  currentFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileInfo.style.display = "flex";
  uploadFile(file);
}

window.clearFile = function () {
  currentFile = null; uploadedFileId = null; currentDocRef = null;
  fileInfo.style.display = "none";
  fileInput.value = "";
  document.getElementById("results-section").style.display = "none";
};

function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

// ─── UPLOAD ──────────────────────────────────────────────────────
async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  try {
    showToast("Uploading and encrypting…");
    const resp = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
    if (!resp.ok) throw new Error("Upload failed: " + resp.status);
    const data = await resp.json();
    uploadedFileId = data.file_id;

    // Create Firestore session document
    currentDocRef = await addDoc(collection(db, "sessions"), {
      uid:       currentUser.uid,
      fileId:    data.file_id,
      fileName:  file.name,
      fileSize:  file.size,
      createdAt: serverTimestamp(),
      summary:   null,
      quiz:      null,
      audioB64:  null,   // base64-encoded MP3
      videoUrl:  null,   // backend URL (best-effort persistence)
    });

    showToast("File uploaded securely.", "success");
  } catch (err) {
    showToast("Upload failed. Is the backend running?", "error");
    console.error(err);
  }
}

// ─── GENERATE ────────────────────────────────────────────────────
window.generateOutput = async function (type) {
  if (!uploadedFileId) {
    showToast("Please upload a document first.", "error"); return;
  }
  const btn = document.getElementById(`btn-${type}`);
  setButtonLoading(btn, true);
  showResultsSection();

  try {
    const resp = await fetch(`${API_BASE}/generate/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: uploadedFileId }),
    });
    if (!resp.ok) throw new Error(`${type} generation failed: ${resp.status}`);
    const data = await resp.json();
    await renderResult(type, data);
    showToast(`${capitalize(type)} generated.`, "success");
    // Show a "View Notes" button after any generation
    if (currentDocRef) showViewNotesBtn();
  } catch (err) {
    showToast(`${capitalize(type)} failed. Check the backend logs.`, "error");
    console.error(err);
  } finally {
    setButtonLoading(btn, false);
  }
};

window.generateAll = async function () {
  if (!uploadedFileId) {
    showToast("Please upload a document first.", "error"); return;
  }
  const btn = document.getElementById("btn-all");
  btn.disabled = true; btn.textContent = "Generating…";
  showResultsSection();
  for (const type of ["summary", "quiz", "audio", "video"]) {
    await window.generateOutput(type);
    await delay(300);
  }
  btn.disabled = false; btn.textContent = "⚡ Generate All Outputs";
  // Redirect to notes page after generating all
  if (currentDocRef) {
    showToast("All done! Opening your notes…", "success");
    await delay(1000);
    window.location.href = `notes.html?id=${currentDocRef.id}`;
  }
};

// ─── RESULT RENDERING ────────────────────────────────────────────
async function renderResult(type, data) {
  const card = document.getElementById(`result-${type}`);
  if (!card) return;
  card.style.display = "block";

  if (type === "summary") {
    document.getElementById("summaryContent").innerHTML =
      `<p>${escapeHtml(data.summary || "No summary returned.")}</p>`;
    await saveToFirestore({ summary: data.summary || "" });
  }

  if (type === "quiz" && data.questions) {
    // Store questions for interactive mode
    window._quizData = data.questions;
    // Show preview list (read-only) + Start Quiz button
    document.getElementById("quizContent").innerHTML =
      data.questions.map((q, i) => `
        <div class="quiz-preview-item">
          <span class="q-num">Q${i + 1}.</span>
          <span>${escapeHtml(q.question)}</span>
        </div>`).join("");
    document.getElementById("btnStartQuiz").style.display = "inline-flex";
    await saveToFirestore({ quiz: data.questions });
  }

  if (type === "audio") {
    if (data.audio_url) {
      const backendUrl = `${API_BASE}${data.audio_url}`;
      mountPlayer("audio", backendUrl, card);

      // Fetch and store as base64 in Firestore for persistence
      saveAudioAsBase64(backendUrl);
    } else {
      showMediaError(card, "audio", data.message);
    }
  }

  if (type === "video") {
    if (data.video_url) {
      const backendUrl = `${API_BASE}${data.video_url}`;
      mountPlayer("video", backendUrl, card);
      await saveToFirestore({ videoUrl: backendUrl });
    } else if (data.slides_url) {
      card.querySelector(".result-body").innerHTML = `
        <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:0.75rem;">
          MoviePy + ffmpeg not available. Download slide images instead:
        </p>
        <a class="btn-download" href="${API_BASE}${data.slides_url}" download="slides.zip">
          Download Slides ZIP
        </a>`;
    } else {
      showMediaError(card, "video", data.message);
    }
  }

  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ─── AUDIO → BASE64 → FIRESTORE ──────────────────────────────────
async function saveAudioAsBase64(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
    const blob = await resp.blob();
    if (blob.size < 500) return; // placeholder, skip

    // Firestore document limit is 1MB per field.
    // Typical gTTS summary audio is 50–200KB — well within limit.
    if (blob.size > 900_000) {
      console.warn("Audio too large for Firestore, storing URL only.");
      await saveToFirestore({ videoUrl: url });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result; // "data:audio/mpeg;base64,..."
      await saveToFirestore({ audioB64: base64 });
    };
    reader.readAsDataURL(blob);
  } catch (err) {
    console.warn("Could not save audio to Firestore:", err.message);
  }
}

// ─── MEDIA PLAYER ────────────────────────────────────────────────
function mountPlayer(type, url, card) {
  const isAudio  = type === "audio";
  const playerId = isAudio ? "audioPlayer"   : "videoPlayer";
  const dlId     = isAudio ? "audioDownload" : "videoDownload";
  const player   = document.getElementById(playerId);
  const dlBtn    = document.getElementById(dlId);

  player.src = url;
  player.load();
  player.style.display = "block";

  player.onerror = () => {
    card.querySelector(".result-body").innerHTML = `
      <p style="color:#EF4444;font-size:0.9rem;">
        Could not play the file. Try downloading it directly.
      </p>
      <a class="btn-download" href="${url}" download>
        Download ${isAudio ? "MP3" : "MP4"}
      </a>`;
  };

  dlBtn.href = url;
  dlBtn.download = isAudio ? "summary_audio.mp3" : "summary_video.mp4";
  dlBtn.style.display = "inline-block";
}

function showMediaError(card, type, message) {
  const hint = type === "audio"
    ? "pip install gtts (needs internet) or pip install pyttsx3 (offline)"
    : "pip install moviepy and install ffmpeg from ffmpeg.org";
  card.querySelector(".result-body").innerHTML = `
    <p style="color:#EF4444;font-size:0.9rem;margin-bottom:0.6rem;">
      ${escapeHtml(message || `${capitalize(type)} generation failed.`)}
    </p>
    <p style="color:var(--text-secondary);font-size:0.82rem;">
      To fix: <code>${hint}</code>
    </p>`;
}

// ─── FIRESTORE SAVE ──────────────────────────────────────────────
async function saveToFirestore(fields) {
  if (!currentDocRef) return;
  try { await updateDoc(currentDocRef, fields); }
  catch (err) { console.warn("Firestore save failed:", err); }
}

// ─── HISTORY ─────────────────────────────────────────────────────
async function loadHistory() {
  if (!currentUser) return;
  try {
    const q = query(
      collection(db, "sessions"),
      where("uid", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    );
    const snapshot = await getDocs(q);
    const sessions = [];
    snapshot.forEach((d) => sessions.push({ id: d.id, ...d.data() }));
    if (sessions.length === 0) return;

    document.getElementById("history-section").style.display = "block";
    document.getElementById("historyGrid").innerHTML = sessions.map((s, idx) => {
      const date = s.createdAt?.toDate
        ? s.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "Unknown date";
      window._sessionCache = window._sessionCache || {};
      window._sessionCache[idx] = s;
      return `
        <a class="history-card" href="notes.html?id=${s.id}">
          <div class="history-card-icon">📄</div>
          <div class="history-card-info">
            <div class="history-card-name">${escapeHtml(s.fileName || "Untitled")}</div>
            <div class="history-card-date">${date}</div>
            <div class="history-card-badges">
              ${s.summary  ? '<span class="badge badge-green">Summary</span>' : ""}
              ${s.quiz     ? '<span class="badge badge-blue">Quiz</span>'    : ""}
              ${s.audioB64 ? '<span class="badge badge-amber">Audio</span>'  : ""}
              ${s.videoUrl ? '<span class="badge badge-teal">Video</span>'   : ""}
            </div>
          </div>
          <div class="history-card-arrow">→</div>
        </a>`;
    }).join("");
  } catch (err) {
    // If index isn't created yet, Firestore throws with a link to create it
    if (err.message?.includes("index")) {
      console.warn("Firestore index needed. Check the console link to create it:", err);
    } else {
      console.warn("Could not load history:", err);
    }
  }
}

window.restoreSession = function (session) {
  showResultsSection();

  if (session.summary) {
    document.getElementById("result-summary").style.display = "block";
    document.getElementById("summaryContent").innerHTML =
      `<p>${escapeHtml(session.summary)}</p>`;
  }

  if (session.quiz?.length) {
    document.getElementById("result-quiz").style.display = "block";
    window._quizData = session.quiz;
    document.getElementById("quizContent").innerHTML =
      session.quiz.map((q, i) => `
        <div class="quiz-preview-item">
          <span class="q-num">Q${i + 1}.</span>
          <span>${escapeHtml(q.question)}</span>
        </div>`).join("");
    document.getElementById("btnStartQuiz").style.display = "inline-flex";
  }

  if (session.audioB64) {
    const card = document.getElementById("result-audio");
    card.style.display = "block";
    // Play directly from base64 — no server needed
    mountPlayer("audio", session.audioB64, card);
  }

  if (session.videoUrl) {
    const card = document.getElementById("result-video");
    card.style.display = "block";
    const body = card.querySelector(".result-body");
    // Video URL may have expired — show player but with a re-generate hint
    body.innerHTML = `
      <video controls class="video-player" id="videoPlayer" preload="metadata">
        Your browser does not support HTML5 video.
      </video>
      <a class="btn-download" id="videoDownload" href="${session.videoUrl}" download style="display:inline-block">
        ⬇ Download MP4
      </a>
      <p class="video-expire-note">
        ⚠ Video links may expire. If it doesn't play, re-upload the file and regenerate.
      </p>`;
    const player = body.querySelector("#videoPlayer");
    player.src = session.videoUrl;
    player.load();
  }

  showToast(`Restored: ${session.fileName}`, "success");
  document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });
};

// ─── HELPERS ─────────────────────────────────────────────────────
function showResultsSection() {
  document.getElementById("results-section").style.display = "block";
}

function showViewNotesBtn() {
  let btn = document.getElementById("viewNotesBtn");
  if (btn) return; // already shown
  btn = document.createElement("div");
  btn.id = "viewNotesBtn";
  btn.className = "view-notes-banner";
  btn.innerHTML = `
    <span>✅ Content saved to your account.</span>
    <a href="notes.html?id=${currentDocRef.id}" class="btn-view-notes">View Full Notes →</a>`;
  document.getElementById("results-section").prepend(btn);
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  const text    = btn.querySelector(".btn-text");
  const spinner = btn.querySelector(".btn-spinner");
  if (text)    text.style.display    = loading ? "none"   : "inline";
  if (spinner) spinner.style.display = loading ? "inline" : "none";
}

function showToast(msg, type = "") {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

window.copyText = function (id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).then(() => showToast("Copied!", "success"));
};

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ─── INTERACTIVE QUIZ ENGINE ─────────────────────────────────────

let _quizIndex  = 0;
let _quizScore  = 0;
let _quizAnswered = false;

window.startQuiz = function () {
  if (!window._quizData || !window._quizData.length) {
    showToast("No quiz data available.", "error"); return;
  }
  _quizIndex    = 0;
  _quizScore    = 0;
  _quizAnswered = false;
  document.getElementById("quizModal").style.display = "flex";
  document.body.style.overflow = "hidden";
  renderQuestion();
};

window.closeQuiz = function () {
  document.getElementById("quizModal").style.display = "none";
  document.body.style.overflow = "";
};

function renderQuestion() {
  const questions = window._quizData;
  const q         = questions[_quizIndex];
  const total     = questions.length;
  _quizAnswered   = false;

  // Progress
  const pct = (_quizIndex / total) * 100;
  document.getElementById("quizProgressBar").style.width = pct + "%";
  document.getElementById("quizCounter").textContent = `${_quizIndex + 1} / ${total}`;

  // Question text
  document.getElementById("quizQuestion").textContent = q.question;

  // Options
  const optionsEl = document.getElementById("quizOptions");
  const labels    = ["A", "B", "C", "D"];
  optionsEl.innerHTML = q.options.map((opt, i) => `
    <button class="quiz-option" data-index="${i}" onclick="selectOption(${i})">
      <span class="quiz-option-label">${labels[i]}</span>
      <span class="quiz-option-text">${escapeHtml(opt)}</span>
    </button>`).join("");

  // Hide feedback
  const fb = document.getElementById("quizFeedback");
  fb.style.display = "none";
  document.getElementById("quizFeedbackInner").innerHTML = "";
}

window.selectOption = function (selectedIdx) {
  if (_quizAnswered) return;
  _quizAnswered = true;

  const q           = window._quizData[_quizIndex];
  const correctIdx  = q.correct;
  const isCorrect   = selectedIdx === correctIdx;
  const labels      = ["A", "B", "C", "D"];

  if (isCorrect) _quizScore++;

  // Style the option buttons
  document.querySelectorAll(".quiz-option").forEach((btn, i) => {
    btn.disabled = true;
    if (i === correctIdx) {
      btn.classList.add("correct");
    } else if (i === selectedIdx && !isCorrect) {
      btn.classList.add("incorrect");
    }
  });

  // Show feedback
  const fb      = document.getElementById("quizFeedback");
  const fbInner = document.getElementById("quizFeedbackInner");
  const btnNext = document.getElementById("btnNext");
  fb.style.display = "block";

  if (isCorrect) {
    fbInner.innerHTML = `
      <div class="feedback-correct">
        ✅ Correct!
      </div>`;
    // Auto-advance after 1.5s on correct answer
    setTimeout(() => {
      if (_quizAnswered) nextQuestion();
    }, 1500);
    btnNext.style.display = "none";
  } else {
    fbInner.innerHTML = `
      <div class="feedback-incorrect">
        ❌ Incorrect. The correct answer is <strong>${labels[correctIdx]}. ${escapeHtml(q.answer)}</strong>
      </div>
      <div class="feedback-reasoning">
        💡 ${escapeHtml(q.reasoning)}
      </div>`;
    btnNext.style.display = "inline-block";
  }
};

window.nextQuestion = function () {
  _quizIndex++;
  const total = window._quizData.length;

  if (_quizIndex >= total) {
    showFinalScore(total);
  } else {
    renderQuestion();
  }
};

function showFinalScore(total) {
  const pct = Math.round((_quizScore / total) * 100);
  let grade = "🔴 Keep studying!";
  if (pct >= 90) grade = "🏆 Excellent!";
  else if (pct >= 70) grade = "✅ Good job!";
  else if (pct >= 50) grade = "📚 Not bad, review the summary.";

  document.getElementById("quizProgressBar").style.width = "100%";
  document.getElementById("quizCounter").textContent = `${total} / ${total}`;
  document.getElementById("quizQuestion").innerHTML = `
    <div class="quiz-final-score">
      <div class="quiz-score-number">${_quizScore} / ${total}</div>
      <div class="quiz-score-pct">${pct}%</div>
      <div class="quiz-score-grade">${grade}</div>
    </div>`;
  document.getElementById("quizOptions").innerHTML = `
    <button class="btn-generate-all" style="margin-top:1rem" onclick="startQuiz()">
      🔄 Retake Quiz
    </button>`;
  document.getElementById("quizFeedback").style.display = "none";
}
