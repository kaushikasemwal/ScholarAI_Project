/**
 * ScholarAI — index.html Script
 * Handles: auth guard, file upload, generate triggers, Firestore saves.
 * Results are NOT rendered here — they live on notes.html.
 */

import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, addDoc, getDocs, updateDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const API_BASE = "https://kaushikasemwal-scholarai-backend.hf.space";

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
  const banner = document.getElementById("viewNotesBtn");
  if (banner) banner.remove();
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

    currentDocRef = await addDoc(collection(db, "sessions"), {
      uid:       currentUser.uid,
      fileId:    data.file_id,
      fileName:  file.name,
      fileSize:  file.size,
      createdAt: serverTimestamp(),
      summary:   null,
      quiz:      null,
      audioB64:  null,
      videoUrl:  null,
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

  try {
    const resp = await fetch(`${API_BASE}/generate/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: uploadedFileId }),
    });
    if (!resp.ok) throw new Error(`${type} generation failed: ${resp.status}`);
    const data = await resp.json();

    // Save to Firestore — no inline rendering
    await persistResult(type, data);
    showToast(`${capitalize(type)} generated.`, "success");
    showViewNotesBtn();
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

  for (const type of ["summary", "quiz", "audio", "video"]) {
    await window.generateOutput(type);
    await delay(300);
  }

  btn.disabled = false; btn.textContent = "⚡ Generate All & Open Notes";

  if (currentDocRef) {
    showToast("All done! Opening your notes…", "success");
    await delay(800);
    window.location.href = `notes.html?id=${currentDocRef.id}`;
  }
};

// ─── PERSIST TO FIRESTORE ────────────────────────────────────────
async function persistResult(type, data) {
  if (type === "summary") {
    await saveToFirestore({ summary: data.summary || "" });
  }

  if (type === "quiz" && data.questions) {
    await saveToFirestore({ quiz: data.questions });
  }

  if (type === "audio" && data.audio_url) {
    const backendUrl = `${API_BASE}${data.audio_url}`;
    await saveAudioAsBase64(backendUrl);
  }

  if (type === "video" && data.video_url) {
    await saveVideoAsBase64(`${API_BASE}${data.video_url}`);
  }
}

// ─── AUDIO → BASE64 → FIRESTORE ──────────────────────────────────
async function saveAudioAsBase64(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
    const blob = await resp.blob();
    if (blob.size < 500) return;
    if (blob.size > 900_000) {
      await saveToFirestore({ audioB64: url });
      return;
    }
    const b64 = await blobToBase64(blob);
    await saveToFirestore({ audioB64: b64 });
  } catch (err) {
    console.warn("Could not save audio:", err.message);
  }
}

// ─── VIDEO → BASE64 → FIRESTORE ──────────────────────────────────
async function saveVideoAsBase64(url) {
  try {
    showToast("Saving video…");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Could not fetch video from backend");
    const blob = await resp.blob();
    if (blob.size < 10_000) throw new Error("Video too small, likely failed");
    if (blob.size > 900_000) {
      await saveToFirestore({ videoUrl: url });
      showToast("Video saved (temporary link).", "success");
      return;
    }
    const b64 = await blobToBase64(blob);
    await saveToFirestore({ videoUrl: b64 });
    showToast("Video saved.", "success");
  } catch (err) {
    console.warn("Could not save video:", err.message);
    showToast("Video generated but could not be saved.", "error");
  }
}

// ─── BLOB → BASE64 HELPER ────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror  = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── FIRESTORE SAVE ──────────────────────────────────────────────
async function saveToFirestore(fields) {
  if (!currentDocRef) return;
  try { await updateDoc(currentDocRef, fields); }
  catch (err) { console.warn("Firestore save failed:", err); }
}

// ─── HISTORY (updates My Notes badge count) ──────────────────────
async function loadHistory() {
  if (!currentUser) return;
  try {
    const q = query(
      collection(db, "sessions"),
      where("uid", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    if (snap.size > 0) {
      const btn = document.querySelector(".btn-my-notes");
      if (btn) btn.textContent = `📚 My Notes (${snap.size})`;
    }
  } catch (err) {
    if (err.message?.includes("index")) {
      console.warn("Firestore index needed:", err);
    }
  }
}

// ─── VIEW NOTES BANNER ───────────────────────────────────────────
function showViewNotesBtn() {
  if (!currentDocRef || document.getElementById("viewNotesBtn")) return;
  const container = document.getElementById("viewNotesContainer");
  if (!container) return;
  const div = document.createElement("div");
  div.id = "viewNotesBtn";
  div.className = "view-notes-banner";
  div.innerHTML = `
    <span>✅ Content saved to your account.</span>
    <a href="notes.html?id=${currentDocRef.id}" class="btn-view-notes">View Full Notes →</a>`;
  container.appendChild(div);
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
  t.className = `toast ${type}`; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

window.copyText = function (id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).then(() => showToast("Copied!", "success"));
};

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
