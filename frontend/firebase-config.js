import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyB0pUDaydWCOHq0-gnDpmiRYTy3sP4Oix0",
  authDomain:        "scholarai-b47ff.firebaseapp.com",
  projectId:         "scholarai-b47ff",
  storageBucket:     "scholarai-b47ff.firebasestorage.app",
  messagingSenderId: "1094722752606",
  appId:             "1:1094722752606:web:14831d4b4dc7e9c23ce4cf"
};

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();

// Storage is NOT used — requires paid plan.
// Audio is stored as base64 in Firestore. Video URL is stored as a string.

export { auth, db, provider };
