/**
 * ScholarAI — Frontend Script
 * Handles: file upload, drag-and-drop, API calls, result rendering
 *
 * KEY FIXES vs previous version:
 *  1. Audio/video: use player.src = url directly instead of innerHTML trick
 *  2. HEAD-check the media URL before showing the player — avoids showing a
 *     broken player when the file is missing or is a tiny placeholder
 *  3. Null audio_url / video_url now shows a clear install-hint message
 *  4. Removed the progress bar that was covering result cards
 */

console.log("ScholarAI frontend loaded. Saved file ID:", sessionStorage.getItem("fileId"));

const API_BASE = "https://scholarai-backend.salmonforest-301059c3.centralindia.azurecontainerapps.io";

// ─── STATE ────────────────────────────────────────────────────────
let uploadedFileId = sessionStorage.getItem("fileId") || null;
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
  const allowedExt = [".pdf", ".pptx", ".ppt"];
  const ext = "." + file.name.split(".").pop().toLowerCase();
  if (!allowedExt.includes(ext)) {
    showToast("Only PDF and PPTX files are supported.", "error");
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
  sessionStorage.removeItem("fileId");
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
    showToast("Uploading and encrypting…");
    const resp = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
    if (!resp.ok) throw new Error("Upload failed: " + resp.status);
    const data = await resp.json();
    uploadedFileId = data.file_id;
    sessionStorage.setItem("fileId", data.file_id);
    showToast("File uploaded securely.", "success");
  } catch (err) {
    showToast("Upload failed. Is the backend running on port 8000?", "error");
    console.error(err);
  }
}

// ─── GENERATE ────────────────────────────────────────────────────
async function generateOutput(type) {
  if (!uploadedFileId) {
    showToast("Please upload a document first.", "error");
    return;
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
    console.log(`[ScholarAI] ${type} response:`, data);
    renderResult(type, data);
    showToast(`${capitalize(type)} generated.`, "success");
  } catch (err) {
    showToast(`${capitalize(type)} failed. Check the backend logs.`, "error");
    console.error(err);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function generateAll() {
  if (!uploadedFileId) {
    showToast("Please upload a document first.", "error");
    return;
  }
  const btn = document.getElementById("btn-all");
  btn.disabled = true;
  btn.textContent = "Generating…";
  showResultsSection();

  for (const type of ["summary", "quiz", "audio", "video"]) {
    await generateOutput(type);
    await delay(300);
  }

  btn.disabled = false;
  btn.textContent = "Generate All Outputs";
}

// ─── RESULT RENDERING ────────────────────────────────────────────
function renderResult(type, data) {
  const card = document.getElementById(`result-${type}`);
  if (!card) { console.error(`Card not found: result-${type}`); return; }
  card.style.display = "block";

  // ── Summary ────────────────────────────────────────────────────
  if (type === "summary") {
    document.getElementById("summaryContent").innerHTML =
      `<p>${escapeHtml(data.summary || "No summary returned.")}</p>`;
  }

  // ── Quiz ───────────────────────────────────────────────────────
  if (type === "quiz" && data.questions) {
    const body = document.getElementById("quizContent");
    body.innerHTML = data.questions.map((q, i) => `
      <div class="quiz-item">
        <div class="quiz-q"><span class="q-num">Q${i + 1}.</span>${escapeHtml(q.question)}</div>
        <div class="quiz-a"><span>→</span>${escapeHtml(q.answer)}</div>
      </div>`).join("");
  }

  // ── Audio ──────────────────────────────────────────────────────
  if (type === "audio") {
    if (data.audio_url) {
      const audioUrl = `${API_BASE}${data.audio_url}`;
      _mountMediaPlayer("audio", audioUrl, card);
    } else {
      _showMediaError(card, "audio", data.message);
    }
  }

  // ── Video ──────────────────────────────────────────────────────
  if (type === "video") {
    if (data.video_url) {
      const videoUrl = `${API_BASE}${data.video_url}`;
      _mountMediaPlayer("video", videoUrl, card);
    } else if (data.slides_url) {
      const zipUrl = `${API_BASE}${data.slides_url}`;
      card.querySelector(".result-body").innerHTML = `
        <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:0.75rem;">
          Video generation requires MoviePy + ffmpeg. Download the slide images instead:
        </p>
        <a class="btn-download" href="${zipUrl}" download="slides.zip">Download Slides ZIP</a>`;
    } else {
      _showMediaError(card, "video", data.message);
    }
  }

  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * Mount an audio or video player after verifying the file actually exists
 * and is large enough to be real media (not a tiny placeholder).
 *
 * Uses a HEAD request to check Content-Length before setting player.src.
 * This prevents the browser from showing a broken/empty player.
 */
function _mountMediaPlayer(mediaType, url, card) {
  const playerId  = mediaType === "audio" ? "audioPlayer"   : "videoPlayer";
  const downloadId = mediaType === "audio" ? "audioDownload" : "videoDownload";
  const mimeType  = mediaType === "audio" ? "audio/mpeg"    : "video/mp4";
  const filename  = mediaType === "audio" ? "summary_audio.mp3" : "summary_video.mp4";
  const body      = card.querySelector(".result-body");

  // HEAD-check the URL first so we never show a broken player
  fetch(url, { method: "HEAD" })
    .then((r) => {
      const size = parseInt(r.headers.get("content-length") || "0", 10);
      const contentType = r.headers.get("content-type") || "";

      // A real MP3/MP4 is always > 500 bytes; a placeholder text file is tiny
      // Also guard against text/plain being returned instead of audio/video
      const looksReal = r.ok && size > 500 && !contentType.startsWith("text/plain");

      if (looksReal) {
        const player = document.getElementById(playerId);
        const dlBtn  = document.getElementById(downloadId);

        // Set src directly — more reliable than clearing innerHTML and using <source>
        player.src = url;
        player.load();

        player.onerror = () => {
          body.innerHTML = `
            <p style="color:var(--text-secondary);font-size:0.9rem;">
              Browser could not play the file. Try the download button instead.
            </p>
            <a class="btn-download" href="${url}" download="${filename}">Download ${mediaType === "audio" ? "MP3" : "MP4"}</a>`;
        };

        dlBtn.href = url;
        dlBtn.download = filename;
        dlBtn.style.display = "inline-block";

      } else {
        // File exists but looks like a placeholder or is wrong type
        const hint = size <= 500
          ? `File is only ${size} bytes — TTS likely wrote a placeholder instead of real audio.`
          : `Unexpected content type: ${contentType}`;
        body.innerHTML = `
          <p style="color:#EF4444;font-size:0.9rem;">Media file invalid. ${hint}</p>
          <p style="color:var(--text-secondary);font-size:0.8rem;margin-top:0.5rem;">
            Check the backend: <code>GET ${url.replace(API_BASE, "")}</code> at
            <a href="${API_BASE}/docs" target="_blank">/docs</a>
          </p>`;
      }
    })
    .catch((err) => {
      body.innerHTML = `
        <p style="color:#EF4444;font-size:0.9rem;">
          Could not reach media file. Is the backend running?
        </p>
        <p style="color:var(--text-secondary);font-size:0.8rem;margin-top:0.4rem;">URL: ${url}</p>`;
      console.error(`HEAD check failed for ${url}:`, err);
    });
}

/** Show a clear install-hint error when audio_url / video_url is null. */
function _showMediaError(card, mediaType, message) {
  const body = card.querySelector(".result-body");
  const installHint = mediaType === "audio"
    ? "pip install gtts &nbsp;(needs internet) &nbsp;or&nbsp; pip install pyttsx3 &nbsp;(offline)"
    : "pip install moviepy &nbsp;and install ffmpeg from ffmpeg.org";

  body.innerHTML = `
    <p style="color:#EF4444;font-size:0.9rem;margin-bottom:0.6rem;">
      ${escapeHtml(message || `${capitalize(mediaType)} generation failed.`)}
    </p>
    <p style="color:var(--text-secondary);font-size:0.82rem;">
      To fix, run: <code>${installHint}</code>
    </p>`;
}

// ─── SHOW RESULTS SECTION ─────────────────────────────────────────
function showResultsSection() {
  const section = document.getElementById("results-section");
  section.style.display = "block";

  // Hide the progress bar — it was covering result cards in the original
  const progressWrap = document.getElementById("progressWrap");
  if (progressWrap) progressWrap.style.display = "none";

  setTimeout(() => section.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
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
  document.querySelectorAll(".toast").forEach((t) => t.remove());
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
    .then(() => showToast("Copied!", "success"));
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}