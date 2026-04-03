/**
 * ScholarAI — Frontend Script (Updated)
 * Handles: file upload, drag-and-drop, API calls, result rendering
 */
console.log("Current file ID:", sessionStorage.getItem('fileId'))
const API_BASE = "http://localhost:8000";

// ─── STATE ────────────────────────────────────────────────────────
let uploadedFileId = sessionStorage.getItem('fileId') || null;
let currentFile   = null;

// ─── DOM REFS ─────────────────────────────────────────────────────
const dropZone  = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileInfo  = document.getElementById("fileInfo");
const fileName  = document.getElementById("fileName");
const fileSize  = document.getElementById("fileSize");

// ─── DRAG-AND-DROP ────────────────────────────────────────────────
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const files = e.dataTransfer.files;
  if (files.length > 0) handleFile(files[0]);
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
  const allowed = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint"
  ];
  const allowedExt = [".pdf", ".pptx", ".ppt"];
  const ext = "." + file.name.split(".").pop().toLowerCase();

  if (!allowed.includes(file.type) && !allowedExt.includes(ext)) {
    showToast("⚠ Only PDF and PPTX files are supported.", "error");
    return;
  }

  currentFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileInfo.style.display = "flex";
  uploadFile(file);
}

function clearFile() {
  currentFile    = null;
  uploadedFileId = null;
  sessionStorage.removeItem('fileId');
  fileInfo.style.display = "none";
  fileInput.value = "";
  document.getElementById("results-section").style.display = "none";
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// ─── UPLOAD ──────────────────────────────────────────────────────
async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  try {
    showToast("⬆ Uploading and encrypting…");
    const resp = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      body: formData
    });

    if (!resp.ok) throw new Error("Upload failed: " + resp.status);
    const data = await resp.json();
    uploadedFileId = data.file_id;
    sessionStorage.setItem('fileId', data.file_id);
    showToast("✓ File uploaded securely.", "success");
  } catch (err) {
    showToast("✗ Upload failed. Is the backend running?", "error");
    console.error(err);
  }
}

// ─── GENERATE ────────────────────────────────────────────────────
async function generateOutput(type) {
  if (!uploadedFileId) {
    showToast("⚠ Please upload a document first.", "error");
    return;
  }

  const btn = document.getElementById(`btn-${type}`);
  setButtonLoading(btn, true);
  showResults();

  try {
    const resp = await fetch(`${API_BASE}/generate/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: uploadedFileId })
    });

    if (!resp.ok) throw new Error(`${type} generation failed`);
    const data = await resp.json();
    console.log(`[ScholarAI] ${type} response:`, data);
    renderResult(type, data);
    showToast(`✓ ${capitalize(type)} generated.`, "success");
  } catch (err) {
    showToast(`✗ ${capitalize(type)} failed. Check backend.`, "error");
    console.error(err);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function generateAll() {
  if (!uploadedFileId && !currentFile) {
    showToast("⚠ Please upload a document first.", "error");
    return;
  }

  const types = ["summary", "quiz", "audio", "video"];
  const btn   = document.getElementById("btn-all");
  btn.disabled = true;
  btn.textContent = "⟳ Generating…";
  showResults();

  for (const type of types) {
    await generateOutput(type);
    await delay(300);
  }

  btn.disabled = false;
  btn.textContent = "⚡ Generate All Outputs";
}

// ─── RESULT RENDERING ────────────────────────────────────────────
function renderResult(type, data) {
  console.log(`[ScholarAI] renderResult called for type: ${type}`);
  
  // Always show the results section
  const resultsSection = document.getElementById("results-section");
  resultsSection.style.display = "block";
  resultsSection.style.visibility = "visible";
  console.log(`[ScholarAI] results-section visible`);

  const card = document.getElementById(`result-${type}`);
  if (!card) {
    console.error(`[ScholarAI] Card not found: result-${type}`);
    return;
  }
  
  card.style.display = "block";
  card.style.visibility = "visible";
  card.style.opacity = "1";
  console.log(`[ScholarAI] Card result-${type} now visible`);

  // ── Summary ──────────────────────────────────────────────────
  if (type === "summary" && data.summary) {
    console.log(`[ScholarAI] Rendering summary content`);
    document.getElementById("summaryContent").innerHTML =
      `<p>${escapeHtml(data.summary)}</p>`;
    // Force card visible after content added
    setTimeout(() => {
      card.removeAttribute("style");
      card.setAttribute("style", "display: block !important;");
    }, 50);
  }

  // ── Quiz ─────────────────────────────────────────────────────
  if (type === "quiz" && data.questions) {
    console.log(`[ScholarAI] Rendering ${data.questions.length} quiz questions`);
    const body = document.getElementById("quizContent");
    let html = "";
    data.questions.forEach((q, i) => {
      html += `
        <div class="quiz-item">
          <div class="quiz-q"><span class="q-num">Q${i+1}.</span>${escapeHtml(q.question)}</div>
          <div class="quiz-a"><span>→</span>${escapeHtml(q.answer)}</div>
        </div>`;
    });
    body.innerHTML = html;
    // Force card visible after content added
    setTimeout(() => {
      card.removeAttribute("style");
      card.style.display = "block";
    }, 50);
  }

  // ── Audio ─────────────────────────────────────────────────────
  if (type === "audio") {
    if (data.audio_url) {
      const audioUrl = `${API_BASE}${data.audio_url}`;
      console.log("[ScholarAI] Audio URL:", audioUrl);

      const player = document.getElementById("audioPlayer");
      const source = player.querySelector("source");
      const dl     = document.getElementById("audioDownload");

      // Reset and reload with new source URL
      player.pause();
      player.innerHTML = "";
      const newSource = document.createElement("source");
      newSource.src  = audioUrl;
      newSource.type = "audio/mpeg";
      player.appendChild(newSource);
      player.load();

      player.onerror = () => {
        showToast("⚠ Unable to play generated audio. Please download and inspect the file.", "error");
      };

      dl.href     = audioUrl;
      dl.download = "summary_audio.mp3";
      dl.style.display = "inline-block";

      // Show URL in UI for troubleshooting
      const audioUrlInfo = document.querySelector("#result-audio .result-meta span.audio-url");
      if (audioUrlInfo) {
        audioUrlInfo.textContent = `URL: ${audioUrl}`;
      }

      setTimeout(() => {
        card.removeAttribute("style");
        card.style.display = "block";
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);

    } else {
      card.removeAttribute("style");
      card.style.display = "block";
      card.querySelector(".result-body").innerHTML =
        `<p style="color:#94A3B8;font-size:0.9rem;">⚠ Audio file not returned by backend. Check server logs.</p>`;
    }
  }

  // ── Video ─────────────────────────────────────────────────────
  if (type === "video") {
    if (data.video_url) {
      const videoUrl = `${API_BASE}${data.video_url}`;
      console.log("[ScholarAI] Video URL:", videoUrl);

      const player = document.getElementById("videoPlayer");
      const source = player.querySelector("source");
      const dl     = document.getElementById("videoDownload");

      // Reset and reload with new source URL
      player.pause();
      player.innerHTML = "";
      const newSource = document.createElement("source");
      newSource.src  = videoUrl;
      newSource.type = "video/mp4";
      player.appendChild(newSource);
      player.load();

      player.onerror = () => {
        showToast("⚠ Unable to play generated video. Please download and inspect the file.", "error");
      };

      dl.href     = videoUrl;
      dl.download = "summary_video.mp4";
      dl.style.display = "inline-block";

      const videoUrlInfo = document.querySelector("#result-video .result-meta span.video-url");
      if (videoUrlInfo) {
        videoUrlInfo.textContent = `URL: ${videoUrl}`;
      }

      setTimeout(() => {
        card.removeAttribute("style");
        card.style.display = "block";
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);

    } else {
      // Fallback: offer the slides ZIP download
      card.removeAttribute("style");
      card.style.display = "block";
      const zipUrl = data.slides_url ? `${API_BASE}${data.slides_url}` : `${API_BASE}/media/${uploadedFileId}_video_slides.zip`;
      card.querySelector(".result-body").innerHTML = `
        <p style="color:#94A3B8;font-size:0.9rem;margin-bottom:0.75rem;">
          🎬 Video generation may not be available unless MoviePy + ffmpeg are installed. Download the slide images instead:
        </p>
        <a class="btn-download" href="${zipUrl}" download="slides.zip">⬇ Download Slides ZIP</a>
      `;
    }
  }
}

// ─── PROGRESS ────────────────────────────────────────────────────
function showResults() {
  const section = document.getElementById("results-section");
  section.style.display = "block";
  
  // Remove or hide the progress bar so it doesn't block content
  const progressWrap = document.getElementById("progressWrap");
  if (progressWrap) {
    progressWrap.style.display = "none";
  }
  
  // Scroll to results after a short delay to let DOM settle
  setTimeout(() => {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);
}

// ─── HELPERS ─────────────────────────────────────────────────────
function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  const text    = btn.querySelector(".btn-text");
  const spinner = btn.querySelector(".btn-spinner");
  if (text)    text.style.display    = loading ? "none"   : "inline";
  if (spinner) spinner.style.display = loading ? "inline" : "none";
}

function showToast(msg, type = "") {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function copyText(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText)
    .then(() => showToast("✓ Copied!", "success"));
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}