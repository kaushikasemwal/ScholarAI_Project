/**
 * notes.js — Session Notes Page
 * Loads a single Firestore session by ID from the URL query param
 * and renders summary, quiz, audio, video in a tabbed layout.
 */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── AUTH GUARD ───────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  showUserInfo(user);
  await loadSession();
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

// ─── LOAD SESSION ────────────────────────────────────────────────
async function loadSession() {
  const params    = new URLSearchParams(window.location.search);
  const sessionId = params.get("id");

  if (!sessionId) {
    showError("No session ID provided.");
    return;
  }

  try {
    const snap = await getDoc(doc(db, "sessions", sessionId));
    if (!snap.exists()) {
      showError("Session not found. It may have been deleted.");
      return;
    }
    renderSession({ id: snap.id, ...snap.data() });
  } catch (err) {
    showError("Failed to load session: " + err.message);
  }
}

function showError(msg) {
  document.getElementById("notesLoading").innerHTML = `
    <p style="color:var(--red-accent);font-size:1rem;">${msg}</p>
    <a href="index.html" style="color:var(--amber);margin-top:1rem;display:inline-block;">← Back to Upload</a>`;
}

// ─── RENDER SESSION ──────────────────────────────────────────────
function renderSession(session) {
  document.getElementById("notesLoading").style.display = "none";
  document.getElementById("notesPage").style.display    = "block";

  // File header
  document.title = `ScholarAI — ${session.fileName || "Notes"}`;
  document.getElementById("notesFileName").textContent = session.fileName || "Untitled";

  const date = session.createdAt?.toDate
    ? session.createdAt.toDate().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "";
  document.getElementById("notesFileDate").textContent = date;
  document.getElementById("notesFileSize").textContent = session.fileSize ? formatBytes(session.fileSize) : "";

  // Badges
  const badges = document.getElementById("notesBadges");
  if (session.summary)  badges.innerHTML += '<span class="badge badge-green">Summary</span>';
  if (session.quiz)     badges.innerHTML += '<span class="badge badge-blue">Quiz</span>';
  if (session.audioB64) badges.innerHTML += '<span class="badge badge-amber">Audio</span>';
  if (session.videoUrl) badges.innerHTML += '<span class="badge badge-teal">Video</span>';

  // Hide tabs for missing content
  if (!session.summary)  hideTab("summary");
  if (!session.quiz)     hideTab("quiz");
  if (!session.audioB64) hideTab("audio");
  if (!session.videoUrl) hideTab("video");

  // Activate first available tab
  const available = ["summary", "quiz", "audio", "video"]
    .find(t => session[t === "audio" ? "audioB64" : t === "video" ? "videoUrl" : t]);
  if (available) switchTab(available);

  // ── Summary ──────────────────────────────────────────────────
  if (session.summary) {
    document.getElementById("summaryText").innerHTML =
      `<p>${escapeHtml(session.summary)}</p>`;
  }

  // ── Quiz ─────────────────────────────────────────────────────
  if (session.quiz?.length) {
    window._quizData = session.quiz;
    document.getElementById("quizContent").innerHTML =
      session.quiz.map((q, i) => `
        <div class="quiz-preview-item">
          <span class="q-num">Q${i + 1}.</span>
          <span>${escapeHtml(q.question)}</span>
        </div>`).join("");
    document.getElementById("btnStartQuiz").style.display = "inline-flex";
  }

  // ── Audio ─────────────────────────────────────────────────────
  if (session.audioB64) {
    const player = document.getElementById("audioPlayer");
    const dlBtn  = document.getElementById("audioDownload");
    player.src = session.audioB64;
    player.load();
    dlBtn.href     = session.audioB64;
    dlBtn.download = "summary_audio.mp3";
    dlBtn.style.display = "inline-block";
  }

  // ── Video ─────────────────────────────────────────────────────
  if (session.videoUrl) {
    const player = document.getElementById("videoPlayer");
    const dlBtn  = document.getElementById("videoDownload");
    player.src = session.videoUrl;
    player.load();
    dlBtn.href     = session.videoUrl;
    dlBtn.download = "summary_video.mp4";
    dlBtn.style.display = "inline-block";

    player.onerror = () => {
      document.getElementById("videoBody").innerHTML = `
        <p style="color:#EF4444;font-size:0.9rem;">
          Video link may have expired. Re-upload the file and regenerate.
        </p>
        <a class="btn-download" href="${session.videoUrl}" download>Try Download</a>`;
    };
  }
}

// ─── TABS ────────────────────────────────────────────────────────
window.switchTab = function (tab) {
  document.querySelectorAll(".notes-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === tab);
  });
  document.querySelectorAll(".notes-panel").forEach(p => {
    p.style.display = p.id === `panel-${tab}` ? "block" : "none";
  });
};

function hideTab(tab) {
  const btn = document.querySelector(`.notes-tab[data-tab="${tab}"]`);
  if (btn) btn.style.display = "none";
}

// ─── INTERACTIVE QUIZ ENGINE (same as index) ─────────────────────
let _quizIndex = 0, _quizScore = 0, _quizAnswered = false;

window.startQuiz = function () {
  if (!window._quizData?.length) return;
  _quizIndex = 0; _quizScore = 0; _quizAnswered = false;
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
  const q = questions[_quizIndex];
  _quizAnswered = false;

  const pct = (_quizIndex / questions.length) * 100;
  document.getElementById("quizProgressBar").style.width = pct + "%";
  document.getElementById("quizCounter").textContent = `${_quizIndex + 1} / ${questions.length}`;
  document.getElementById("quizQuestion").textContent = q.question;

  const labels = ["A", "B", "C", "D"];
  document.getElementById("quizOptions").innerHTML = q.options.map((opt, i) => `
    <button class="quiz-option" data-index="${i}" onclick="selectOption(${i})">
      <span class="quiz-option-label">${labels[i]}</span>
      <span class="quiz-option-text">${escapeHtml(opt)}</span>
    </button>`).join("");

  document.getElementById("quizFeedback").style.display = "none";
  document.getElementById("quizFeedbackInner").innerHTML = "";
}

window.selectOption = function (selectedIdx) {
  if (_quizAnswered) return;
  _quizAnswered = true;

  const q          = window._quizData[_quizIndex];
  const correctIdx = q.correct;
  const isCorrect  = selectedIdx === correctIdx;
  const labels     = ["A", "B", "C", "D"];

  if (isCorrect) _quizScore++;

  document.querySelectorAll(".quiz-option").forEach((btn, i) => {
    btn.disabled = true;
    if (i === correctIdx)              btn.classList.add("correct");
    else if (i === selectedIdx)        btn.classList.add("incorrect");
  });

  const fb      = document.getElementById("quizFeedback");
  const fbInner = document.getElementById("quizFeedbackInner");
  const btnNext = document.getElementById("btnNext");
  fb.style.display = "block";

  if (isCorrect) {
    fbInner.innerHTML = `<div class="feedback-correct">✅ Correct!</div>`;
    btnNext.style.display = "none";
    setTimeout(() => { if (_quizAnswered) nextQuestion(); }, 1500);
  } else {
    fbInner.innerHTML = `
      <div class="feedback-incorrect">
        ❌ Incorrect. The correct answer is <strong>${labels[correctIdx]}. ${escapeHtml(q.answer)}</strong>
      </div>
      <div class="feedback-reasoning">💡 ${escapeHtml(q.reasoning)}</div>`;
    btnNext.style.display = "inline-block";
  }
};

window.nextQuestion = function () {
  _quizIndex++;
  if (_quizIndex >= window._quizData.length) showFinalScore();
  else renderQuestion();
};

function showFinalScore() {
  const total = window._quizData.length;
  const pct   = Math.round((_quizScore / total) * 100);
  let grade   = "🔴 Keep studying!";
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
    <button class="btn-generate-all" style="margin-top:1rem" onclick="startQuiz()">🔄 Retake Quiz</button>`;
  document.getElementById("quizFeedback").style.display = "none";
}

// ─── HELPERS ─────────────────────────────────────────────────────
window.copyText = function (id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).then(() => showToast("Copied!", "success"));
};

function showToast(msg, type = "") {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = `toast ${type}`; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
