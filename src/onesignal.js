// src/onesignal.js (debug-friendly)
// Important: replace the APP ID below if you prefer to init here; index.html init is primary.
import { rtdb } from "./firebase";
import { ref as dbRef, set as dbSet, push as dbPush } from "firebase/database";

const ONESIGNAL_APP_ID = "065caa62-cfe3-4bcf-ac90-2fdf30c168d7"; // also configured in index.html init

function now() { return new Date().toISOString(); }
function debugPath(uid) { return `debug/onesignal/${uid || "anon"}`; }

function writeDebug(uid, obj) {
  try {
    const p = dbRef(rtdb, debugPath(uid) + "/" + Date.now());
    dbPush(p).catch(() => {});
  } catch (e) {
    // best-effort
    console.warn("debug write failed", e);
  }
}

function ensureOneSignalReady() {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);
    if (window.OneSignal) return resolve(window.OneSignal);
    const max = 50; let attempt = 0;
    const iv = setInterval(() => {
      attempt++;
      if (window.OneSignal) {
        clearInterval(iv);
        return resolve(window.OneSignal);
      }
      if (attempt >= max) {
        clearInterval(iv);
        return resolve(null);
      }
    }, 100);
  });
}

export async function registerOneSignalForUser(uid) {
  if (!uid) return;
  const OneSignal = await ensureOneSignalReady();
  if (!OneSignal) {
    // SDK not loaded yet; write debug and exit
    try { await dbSet(dbRef(rtdb, `debug/onesignal/${uid}/error`), { when: now(), msg: "OneSignal SDK missing" }); } catch (e) {}
    console.warn("OneSignal SDK not available yet");
    return;
  }

  OneSignal.push(async (os) => {
    try {
      // If OneSignal hasn't been initialised yet, init it here as a fallback
      if (!os.init) {
        try {
          os.init({ appId: ONESIGNAL_APP_ID, allowLocalhostAsSecureOrigin: true });
        } catch (e) { /* non-fatal */ }
      }

      // Log current permission state
      const perm = await (os.getNotificationPermission ? os.getNotificationPermission() : Promise.resolve(null));
      try { await dbSet(dbRef(rtdb, `debug/onesignal/${uid}/perm`), { when: now(), perm: perm || "unknown" }); } catch (e) {}

      // Try to get an existing player id (may be null)
      let playerId = null;
      try {
        if (os.getUserId) playerId = await os.getUserId();
      } catch (e) {
        console.warn("getUserId error", e);
      }

      if (playerId) {
        await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), playerId);
        try { await dbSet(dbRef(rtdb, `debug/onesignal/${uid}/events`), { when: now(), event: "saved_existing_player", playerId }); } catch (e) {}
      }

      // subscriptionChange event: when the user subscribes/unsubscribes
      if (os.on) {
        os.on("subscriptionChange", async (isSubscribed) => {
          try {
            const pid = await os.getUserId();
            await dbSet(dbRef(rtdb, `debug/onesignal/${uid}/subscriptionChange`), { when: now(), isSubscribed, pid: pid || null });
            if (isSubscribed && pid) {
              await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), pid);
            } else if (!isSubscribed) {
              await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), null);
            }
          } catch (e) {
            console.warn("subscriptionChange handler err", e);
          }
        });
        // also listen for permission changes
        os.on("notificationPermissionChange", async (permissionChange) => {
          try {
            await dbSet(dbRef(rtdb, `debug/onesignal/${uid}/permissionChange`), { when: now(), permissionChange });
          } catch (e) {}
        });
      }

      // If not subscribed, try prompting in a safe, non-intrusive manner:
      // Only call showNativePrompt if user hasn't denied already. Many browsers manage prompts.
      try {
        const isEnabled = await (os.isPushNotificationsEnabled ? os.isPushNotificationsEnabled() : Promise.resolve(false));
        if (!isEnabled && os.showNativePrompt) {
          // Note: this will show a browser prompt. On iOS you must be a PWA (Add to Home Screen) to receive.
          try {
            await os.showNativePrompt();
            await dbSet(dbRef(rtdb, `debug/onesignal/${uid}/events_after_prompt`), { when: now(), attemptedPrompt: true });
          } catch (e) {
            await dbSet(dbRef(rtdb, `debug/onesignal/${uid}/events_after_prompt_error`), { when: now(), error: String(e) });
          }
        }
      } catch (e) {
        // non-fatal
      }
    } catch (e) {
      try { await dbSet(dbRef(rtdb, `debug/onesignal/${uid}/error`), { when: now(), msg: String(e) }); } catch (ee) {}
      console.warn("onesignal register error", e);
    }
  });
}

export async function removePlayerIdForUser(uid) {
  if (!uid) return;
  try {
    await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), null);
    const OneSignal = window.OneSignal;
    if (OneSignal && OneSignal.push) {
      OneSignal.push((os) => {
        if (os.removeExternalUserId) {
          try { os.removeExternalUserId(); } catch (e) {}
        }
      });
    }
  } catch (e) {
    console.warn("removePlayerIdForUser err", e);
  }
}
