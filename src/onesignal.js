// src/onesignal.js (robust + debug)
import { rtdb } from "./firebase";
import { ref as dbRef, set as dbSet, push as dbPush } from "firebase/database";

const ONESIGNAL_APP_ID = "065caa62-cfe3-4bcf-ac90-2fdf30c168d7"; // optional duplicate; index.html init used too
const DEBUG_BASE = (uid) => `debug/onesignal/${uid || "anon"}`;

function now() { return new Date().toISOString(); }
async function writeDebug(uid, obj) {
  try {
    const base = DEBUG_BASE(uid);
    const p = dbRef(rtdb, `${base}/${Date.now()}`);
    await dbPush(p, obj);
  } catch (e) {
    // best-effort, don't break UI
    console.warn("debug write failed", e);
  }
}

function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }

function ensureOneSignalReady() {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);
    if (window.OneSignal) return resolve(window.OneSignal);
    const max = 60; let attempt = 0;
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

/**
 * Registers the browser with OneSignal for a given uid.
 * - writes detailed debug info to /debug/onesignal/{uid}
 * - writes /users/{uid}/onesignalPlayerId when a player id is available
 */
export async function registerOneSignalForUser(uid) {
  if (!uid) return;
  const OneSignal = await ensureOneSignalReady();
  if (!OneSignal) {
    // SDK not loaded yet — record debug
    await writeDebug(uid, { when: now(), event: "sdk_missing" });
    console.warn("OneSignal SDK missing");
    return;
  }

  // Use push wrapper
  OneSignal.push(async (os) => {
    try {
      await writeDebug(uid, { when: now(), event: "push_handler_started" });

      // fallback init if not done in index.html
      try {
        if (!os.init) {
          os.init({ appId: ONESIGNAL_APP_ID, allowLocalhostAsSecureOrigin: true });
          await writeDebug(uid, { when: now(), event: "init_called_fallback" });
        }
      } catch (e) {
        await writeDebug(uid, { when: now(), event: "init_error", error: String(e) });
      }

      // log permission status early
      try {
        const perm = os.getNotificationPermission ? await os.getNotificationPermission() : null;
        await writeDebug(uid, { when: now(), event: "perm_initial", perm: perm || "unknown" });
      } catch (e) {
        await writeDebug(uid, { when: now(), event: "perm_error", error: String(e) });
      }

      // Try to read existing player id (may be null)
      try {
        const existingPid = os.getUserId ? await os.getUserId() : null;
        await writeDebug(uid, { when: now(), event: "existing_player", playerId: existingPid || null });
        if (existingPid) {
          await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), existingPid);
          await writeDebug(uid, { when: now(), event: "saved_existing_player", playerId: existingPid });
          return; // already subscribed — done
        }
      } catch (e) {
        await writeDebug(uid, { when: now(), event: "getUserId_error", error: String(e) });
      }

      // Listen for subscriptionChange -> save id when it appears
      if (os.on) {
        try {
          os.on("subscriptionChange", async (isSubscribed) => {
            try {
              const pid = os.getUserId ? await os.getUserId() : null;
              await writeDebug(uid, { when: now(), event: "subscriptionChange", isSubscribed, pid: pid || null });
              if (isSubscribed && pid) {
                await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), pid);
                await writeDebug(uid, { when: now(), event: "saved_on_subscription", playerId: pid });
              } else if (!isSubscribed) {
                await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), null);
                await writeDebug(uid, { when: now(), event: "cleared_on_unsubscribe" });
              }
            } catch (e) {
              await writeDebug(uid, { when: now(), event: "subscriptionChange_handler_error", error: String(e) });
            }
          });
        } catch (e) {
          await writeDebug(uid, { when: now(), event: "on_subscriptionChange_error", error: String(e) });
        }
      }

      // Listen for permission changes
      if (os.on) {
        try {
          os.on("notificationPermissionChange", async (permChange) => {
            await writeDebug(uid, { when: now(), event: "notificationPermissionChange", permChange });
          });
        } catch (e) {
          // ignore
        }
      }

      // Try prompting the user for permission:
      // On iOS Safari this usually requires PWA; calling this auto-attempt here is okay.
      try {
        // Do not call showNativePrompt too many times — call once here
        if (os.showNativePrompt) {
          await writeDebug(uid, { when: now(), event: "attempt_showNativePrompt" });
          try {
            await os.showNativePrompt();
            await writeDebug(uid, { when: now(), event: "showNativePrompt_called" });
          } catch (e) {
            await writeDebug(uid, { when: now(), event: "showNativePrompt_error", error: String(e) });
          }
        } else {
          await writeDebug(uid, { when: now(), event: "no_showNativePrompt_method" });
        }
      } catch (e) {
        await writeDebug(uid, { when: now(), event: "prompt_attempt_error", error: String(e) });
      }

      // Poll for userId for a few seconds (OneSignal may provide it asynchronously)
      for (let i = 0; i < 10; i++) {
        try {
          const pid = os.getUserId ? await os.getUserId() : null;
          if (pid) {
            await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), pid);
            await writeDebug(uid, { when: now(), event: "saved_polling_player", playerId: pid, attempt: i });
            break;
          } else {
            await writeDebug(uid, { when: now(), event: "poll_no_player", attempt: i });
          }
        } catch (e) {
          await writeDebug(uid, { when: now(), event: "poll_error", error: String(e), attempt: i });
        }
        await wait(700); // wait 700ms between attempts
      }
    } catch (e) {
      await writeDebug(uid, { when: now(), event: "push_handler_uncaught_error", error: String(e) });
    }
  });
}

export async function removePlayerIdForUser(uid) {
  if (!uid) return;
  try {
    await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), null);
  } catch (e) {
    console.warn("removePlayerIdForUser err", e);
  }
}
