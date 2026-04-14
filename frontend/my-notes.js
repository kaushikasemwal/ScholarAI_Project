/**
 * my-notes.js — Notes Library Page
 * Shows all sessions for the logged-in user with search + filter.
 */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, getDocs, deleteDoc, doc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let allSessions  = [];
let activeFilter = "all";

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  showUserInfo(user);
  await loadNotes();
});

function showUserInfo(user) {
  const pill = document.getElementById("userPill");
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

async function loadNotes() {
  const user = auth.currentUser;
  try {
    const q = query(
      collection(db, "sessions"),
      where("uid", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    snap.forEach(d => allSessions.push({ id: d.id, ...d.data() }));

    document.getElementById("notesLoading").style.display = "none";

    if (allSessions.length === 0) {
      document.getElementById("notesEmpty").style.display = "block";
    } else {
      document.getElementById("notesGrid").style.display = "grid";
      renderGrid(allSessions);
    }
  } catch (err) {
    document.getElementById("notesLoading").innerHTML =
      `<p style="color:var(--red-accent)">Failed to load notes: ${err.message}</p>`;
  }
}

function renderGrid(sessions) {
  const grid = document.getElementById("notesGrid");
  if (sessions.length === 0) {
    grid.innerHTML = `<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;padding:2rem">
      No notes match your search.</p>`;
    return;
  }
  grid.innerHTML = sessions.map(s => {
    const date = s.createdAt?.toDate
      ? s.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "Unknown date";
    const size = s.fileSize ? formatBytes(s.fileSize) : "";
    return `
      <div class="history-card-wrapper">
        <a class="history-card" href="notes.html?id=${s.id}">
          <div class="history-card-icon">📄</div>
          <div class="history-card-info">
            <div class="history-card-name">${escapeHtml(s.fileName || "Untitled")}</div>
            <div class="history-card-date">${date}${size ? " · " + size : ""}</div>
            <div class="history-card-badges">
              ${s.summary  ? '<span class="badge badge-green">Summary</span>' : ""}
              ${s.quiz     ? '<span class="badge badge-blue">Quiz</span>'    : ""}
              ${s.audioB64 ? '<span class="badge badge-amber">Audio</span>'  : ""}
              ${s.videoUrl ? '<span class="badge badge-teal">Video</span>'   : ""}
            </div>
          </div>
          <div class="history-card-arrow">→</div>
        </a>
        <button class="btn-delete-note" title="Delete note" onclick="deleteNote('${s.id}', this)">🗑</button>
      </div>`;
  }).join("");
}

window.filterNotes = function () {
  applyFilters();
};

window.setFilter = function (filter) {
  activeFilter = filter;
  document.querySelectorAll(".filter-pill").forEach(p => {
    p.classList.toggle("active", p.dataset.filter === filter);
  });
  applyFilters();
};

function applyFilters() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  let filtered = allSessions.filter(s => {
    const nameMatch = (s.fileName || "").toLowerCase().includes(search);
    if (!nameMatch) return false;
    if (activeFilter === "all")     return true;
    if (activeFilter === "summary") return !!s.summary;
    if (activeFilter === "quiz")    return !!s.quiz;
    if (activeFilter === "audio")   return !!s.audioB64;
    if (activeFilter === "video")   return !!s.videoUrl;
    return true;
  });
  renderGrid(filtered);
}

window.deleteNote = async function (sessionId, btn) {
  if (!confirm("Delete this note? This cannot be undone.")) return;
  btn.disabled = true;
  btn.textContent = "⏳";
  try {
    await deleteDoc(doc(db, "sessions", sessionId));
    allSessions = allSessions.filter(s => s.id !== sessionId);
    applyFilters();
    if (allSessions.length === 0) {
      document.getElementById("notesGrid").style.display = "none";
      document.getElementById("notesEmpty").style.display = "block";
    }
  } catch (err) {
    alert("Failed to delete: " + err.message);
    btn.disabled = false;
    btn.textContent = "🗑";
  }
};

function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
