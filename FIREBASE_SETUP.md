# Firebase Setup Guide for ScholarAI

## Step 1 — Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **"Add project"**
3. Name it `scholarai` (or anything you like)
4. Disable Google Analytics if you don't need it → **Create project**

---

## Step 2 — Register a Web App

1. On the project overview page, click the **`</>`** (Web) icon
2. Name it `scholarai-web` → click **Register app**
3. You'll see a `firebaseConfig` object — **copy it**
4. Open `frontend/firebase-config.js` and paste your values:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "scholarai-xxxxx.firebaseapp.com",
  projectId:         "scholarai-xxxxx",
  storageBucket:     "scholarai-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abcdef"
};
```

---

## Step 3 — Enable Authentication

1. In the Firebase console → **Authentication** → **Get started**
2. Click **Sign-in method** tab
3. Enable **Google** → set your support email → Save
4. Enable **Email/Password** → Save

---

## Step 4 — Create Firestore Database

1. Firebase console → **Firestore Database** → **Create database**
2. Choose **Start in test mode** (we'll add rules after)
3. Pick a region close to your users → **Enable**
4. Go to **Rules** tab and paste the contents of `firebase.rules`

---

## Step 5 — Enable Firebase Storage

1. Firebase console → **Storage** → **Get started**
2. Choose **Start in test mode** → **Done**
3. Go to **Rules** tab and paste the contents of `firebase.storage.rules`

---

## Step 6 — Create Firestore Index (Required for History)

The history query uses `uid` + `orderBy createdAt`. Firebase needs a composite index.

Either:
- Run the app and click the link in the browser console error (easiest), OR
- Firebase console → Firestore → **Indexes** → **Add index**:
  - Collection: `sessions`
  - Fields: `uid` (Ascending), `createdAt` (Descending)

---

## Step 7 — Run the App

Open `frontend/login.html` in a browser (via a local server, not file://).

Quick local server options:
```bash
# Python
python -m http.server 3000 --directory frontend

# Node (if installed)
npx serve frontend
```

Then visit: http://localhost:3000/login.html
