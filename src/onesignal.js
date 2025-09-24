// src/onesignal.js
import { rtdb } from "./firebase";
import { ref as dbRef, set as dbSet } from "firebase/database";

/**
 * NOTE:
 * - Replace APP_ID below with your OneSignal App ID in index.html or here (I recommend keeping the one in index.html).
 * - This module is safe to import anywhere; it checks for window.OneSignal.
 */

const ONESIGNAL_APP_ID = "REPLACE_WITH_ONESIGNAL_APP_ID"; // optional here, index.html init is primary

function ensureOneSignalReady() {
  // OneSignal has a push-queue interface; return a promise that resolves when OneSignal exists.
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);
    if (window.OneSignal) return resolve(window.OneSignal);
    // Poll for a short while (OneSignal SDK is async)
    const max = 50; // ~5s
    let attempt = 0;
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
 * Register the currently running browser as a OneSignal device for this userId.
 * This will call OneSignal.init (if necessary) and store the OneSignal playerId in RTDB.
 *
 * Usage: call registerOneSignalForUser(uid) AFTER user is known (on login/persist).
 */
export async function registerOneSignalForUser(uid) {
  if (!uid) return;
  const OneSignal = await ensureOneSignalReady();
  if (!OneSignal) {
    console.warn("OneSignal SDK not available yet");
    return;
  }

  // Use the push wrapper to safely call methods
  OneSignal.push(async (os) => {
    try {
      // If you didn't initialize OneSignal in index.html, you can initialize here:
      // os.init({ appId: ONESIGNAL_APP_ID, allowLocalhostAsSecureOrigin: true });

      // Ask for permission (non-intrusive: the SDK itself may already have asked)
      // We will not prompt if user already allowed/denied; OneSignal SDK manages that.
      const isSubscribed = await os.isPushNotificationsEnabled
        ? await os.isPushNotificationsEnabled()
        : null;

      // If not subscribed, still try to get existing id; the subscriptionChange event will handle new subscriptions
      if (os.getUserId) {
        const playerId = await os.getUserId();
        if (playerId) {
          await savePlayerIdForUser(uid, playerId, os);
        }
      }

      // Listen for subscription changes (user grants permission, or toggles)
      if (os.on) {
        os.on("subscriptionChange", async (isSubscribedNow) => {
          try {
            if (isSubscribedNow) {
              const pid = await os.getUserId();
              if (pid) {
                await savePlayerIdForUser(uid, pid, os);
              }
            } else {
              // unsubscribed; remove stored player id
              await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), null);
            }
          } catch (e) {
            console.warn("error in subscriptionChange handler", e);
          }
        });
      }

      // It's helpful to map OneSignal external ID to your uid for debugging / segmentation
      if (os.setExternalUserId) {
        try {
          os.setExternalUserId(String(uid));
        } catch (e) {
          // non-fatal
        }
      }
    } catch (e) {
      console.warn("onesignal register error", e);
    }
  });
}

async function savePlayerIdForUser(uid, playerId, os) {
  if (!uid || !playerId) return;
  try {
    await dbSet(dbRef(rtdb, `users/${uid}/onesignalPlayerId`), playerId);
    // also set an external id just in case
    if (os && os.setExternalUserId) {
      try {
        os.setExternalUserId(String(uid));
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    console.warn("Failed to save OneSignal playerId:", e);
  }
}

/**
 * Remove the OneSignal player id for a user (call on logout if desired).
 */
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
