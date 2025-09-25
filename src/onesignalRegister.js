// src/onesignalRegister.js
// Detects the logged-in user (tries several localStorage keys), reads OneSignal player id
// and writes it to Realtime Database at users/{userId}/playerId.
// Minimal, best-effort and safe (non-blocking).

import { rtdb } from "./firebase";
import { ref as dbRef, set as dbSet } from "firebase/database";

const LOCAL_USER_KEYS = [
  "frbs_user",
  "user",
  "currentUser",
  "current_user",
  "protocol_user",
  "app_user",
];

function getUserFromLocalStorage() {
  try {
    for (const k of LOCAL_USER_KEYS) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.id || parsed.uid || parsed.userId)) {
          const id = parsed.id || parsed.uid || parsed.userId;
          return { id: String(id), rawKey: k, raw: parsed };
        }
      } catch (e) {
        if (raw && raw.length < 100 && /^[A-Za-z0-9_-]+$/.test(raw)) {
          return { id: raw, rawKey: k, raw };
        }
      }
    }
  } catch (e) {
    console.warn("onesignalRegister:getUserFromLocalStorage error", e);
  }
  return null;
}

async function writePlayerIdToUser(userId, playerId) {
  try {
    await dbSet(dbRef(rtdb, `users/${userId}/playerId`), playerId);
    await dbSet(dbRef(rtdb, `users/${userId}/playerIdAt`), Date.now());
    console.log(`[onesignalRegister] wrote playerId for user ${userId}: ${playerId}`);
  } catch (e) {
    console.warn(`[onesignalRegister] failed writing playerId for user ${userId}:`, e);
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

window.OneSignalDeferred = window.OneSignalDeferred || [];
window.OneSignalDeferred.push(async function (OneSignal) {
  console.log("[onesignalRegister] OneSignal ready");

  async function attemptRegisterOnce() {
    const appUser = getUserFromLocalStorage();
    if (!appUser || !appUser.id) {
      return { ok: false, reason: "no-app-user" };
    }

    try {
      const playerId = await OneSignal.getUserId();
      if (!playerId) return { ok: false, reason: "no-playerId-yet" };
      await writePlayerIdToUser(appUser.id, playerId);
      return { ok: true, playerId };
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : String(e) };
    }
  }

  (async function loopRegister() {
    const MAX_RETRIES = 20;
    const RETRY_MS = 1500;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const res = await attemptRegisterOnce();
        if (res.ok) {
          console.log("[onesignalRegister] success:", res);
          break;
        } else {
          console.log(`[onesignalRegister] attempt ${i + 1}/${MAX_RETRIES} failed`, res.reason);
        }
      } catch (e) {
        console.warn("[onesignalRegister] unexpected error", e);
      }
      await sleep(RETRY_MS);
    }
  })();

  if (OneSignal.on) {
    try {
      OneSignal.on("subscriptionChange", async (isSubscribed) => {
        console.log("[onesignalRegister] subscriptionChange:", isSubscribed);
        const appUser = getUserFromLocalStorage();
        if (!appUser || !appUser.id) return;
        try {
          const playerId = await OneSignal.getUserId();
          if (playerId) {
            await writePlayerIdToUser(appUser.id, playerId);
          } else {
            console.log("[onesignalRegister] subscriptionChange but no playerId yet");
          }
        } catch (e) {
          console.warn("[onesignalRegister] subscriptionChange error", e);
        }
      });
    } catch (e) {
      console.warn("[onesignalRegister] failed to attach subscriptionChange listener", e);
    }
  }

  window.addEventListener("storage", async function (ev) {
    if (!ev.key) return;
    if (LOCAL_USER_KEYS.includes(ev.key)) {
      console.log("[onesignalRegister] storage event for user key:", ev.key);
      try {
        const appUser = getUserFromLocalStorage();
        if (appUser && appUser.id) {
          const playerId = await OneSignal.getUserId();
          if (playerId) {
            await writePlayerIdToUser(appUser.id, playerId);
          } else {
            console.log("[onesignalRegister] storage event but no playerId yet");
          }
        }
      } catch (e) {
        console.warn("[onesignalRegister] storage handler error", e);
      }
    }
  });
});
