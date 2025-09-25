// src/onesignalRegister.js
// More-robust registration of OneSignal player id to your RTDB users/{uid}/playerId
// Put this file in src/ and make sure you import it in src/index.js with:
//   import "./onesignalRegister";

import { rtdb } from "./firebase";
import { ref as dbRef, set as dbSet, get as dbGet } from "firebase/database";

/*
  EDIT NOTHING HERE unless you need to add another storage key.
  This will:
   - try many localStorage/sessionStorage keys (raw string or JSON user object)
   - wait for OneSignal to be ready
   - poll OneSignal.getUserId() until it returns a non-empty id (with retries)
   - write playerId & playerIdAt to users/{uid}/playerId and users/{uid}/playerIdAt
*/

const LOCAL_KEYS = [
  "frbs_user",
  "user",
  "currentUser",
  "current_user",
  "protocol_user",
  "app_user",
  "auth_user",
  "loggedInUser",
  "me",
  "sessionUser",
];

const SESSION_KEYS = [
  "frbs_user",
  "user",
  "currentUser",
  "me"
];

function tryParsePossibleUser(raw) {
  if (!raw) return null;
  // if looks like JSON
  try {
    const p = JSON.parse(raw);
    if (p && (p.id || p.uid || p.userId)) {
      return String(p.id || p.uid || p.userId);
    }
  } catch (e) {
    // not JSON, if it's likely an id string, return it
    if (typeof raw === "string" && raw.trim().length > 3 && raw.length < 150 && /^[A-Za-z0-9_-]+$/.test(raw.trim())) {
      return raw.trim();
    }
  }
  return null;
}

function findUserIdFromStorages() {
  // localStorage
  try {
    for (const k of LOCAL_KEYS) {
      const raw = localStorage.getItem(k);
      const uid = tryParsePossibleUser(raw);
      if (uid) return uid;
    }
  } catch (e) {}

  // sessionStorage
  try {
    for (const k of SESSION_KEYS) {
      const raw = sessionStorage.getItem(k);
      const uid = tryParsePossibleUser(raw);
      if (uid) return uid;
    }
  } catch (e) {}

  // fallback: if localStorage contains a single raw uid under some OTHER key, try scanning
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const raw = localStorage.getItem(key);
      const uid = tryParsePossibleUser(raw);
      if (uid) return uid;
    }
  } catch (e) {}

  return null;
}

async function writePlayerId(userId, playerId) {
  if (!userId || !playerId) return;
  try {
    await dbSet(dbRef(rtdb, `users/${userId}/playerId`), playerId);
    await dbSet(dbRef(rtdb, `users/${userId}/playerIdAt`), Date.now());
    console.log(`[onesignalRegister] wrote playerId for ${userId}`, playerId);
  } catch (e) {
    console.warn("[onesignalRegister] failed writePlayerId", e);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Polling helper: wait for OneSignal global + getUserId non-null
async function waitForPlayerId(maxAttempts = 20, delayMs = 1000) {
  // wait until OneSignal is present
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    if (window.OneSignal && typeof window.OneSignal.getUserId === "function") {
      try {
        const pid = await window.OneSignal.getUserId();
        if (pid) return pid;
      } catch (e) {
        // ignore and retry
      }
    }
    await sleep(delayMs);
  }
  return null;
}

// Main flow: run when SDK is ready (OneSignalDeferred ensures SDK loaded)
window.OneSignalDeferred = window.OneSignalDeferred || [];
window.OneSignalDeferred.push(async function (OneSignal) {
  console.log("[onesignalRegister] OneSignal ready (robust)");
  // Immediately try to register if we have a stored user id
  (async () => {
    try {
      const userId = findUserIdFromStorages();
      if (!userId) {
        console.log("[onesignalRegister] no userId found in storages yet");
      } else {
        const pid = await waitForPlayerId(15, 1000);
        if (pid) {
          await writePlayerId(userId, pid);
          return;
        } else {
          console.log("[onesignalRegister] OneSignal returned no playerId within timeout");
        }
      }
      // If no userId or no playerId yet, we will listen for storage events and subscription changes
    } catch (e) {
      console.warn("[onesignalRegister] initial register attempt error", e);
    }
  })();

  // When subscription changes, try again (useful when user grants permission)
  try {
    OneSignal.on && OneSignal.on("subscriptionChange", async (isSubscribed) => {
      console.log("[onesignalRegister] subscriptionChange:", isSubscribed);
      const userId = findUserIdFromStorages();
      if (!userId) return;
      const pid = await waitForPlayerId(10, 1000);
      if (pid) await writePlayerId(userId, pid);
    });
  } catch (e) {
    console.warn("[onesignalRegister] failed to attach subscriptionChange listener", e);
  }

  // Listen for localStorage/sessionStorage changes from other tabs (e.g. login finished)
  window.addEventListener("storage", async (ev) => {
    if (!ev.key) return;
    // if login key changed, attempt to register
    const interesting = LOCAL_KEYS.concat(SESSION_KEYS);
    if (!interesting.includes(ev.key)) return;
    try {
      const userId = findUserIdFromStorages();
      if (!userId) return;
      const pid = await waitForPlayerId(10, 1000);
      if (pid) await writePlayerId(userId, pid);
    } catch (e) {
      console.warn("[onesignalRegister] storage handler error", e);
    }
  });

  // Also observe the users/{userId}/playerId; if it exists we won't overwrite,
  // but if there's no playerId yet and we detect a matching user id locally, write it.
  // (This double-check helps when user just created account via your signup flow.)
  // We don't set up DB listeners here because we don't know userId always; signup snippet below is more reliable.
});
