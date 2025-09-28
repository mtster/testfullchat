// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";

/**
 * Replace the firebaseConfig below with the same object your app uses.
 * I left your values here (from what you previously pasted) — keep them or replace if needed.
 */
const firebaseConfig = {
  apiKey: "AIzaSyA-FwUy8WLXiYtT46F0f59gr461cEI_zmo",
  authDomain: "protocol-chat-b6120.firebaseapp.com",
  databaseURL: "https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "protocol-chat-b6120",
  storageBucket: "protocol-chat-b6120.appspot.com",
  messagingSenderId: "969101904718",
  appId: "1:969101904718:web:8dcd0bc8690649235cec1f"
};

export const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);

/** Helper - register the SW at root /firebase-messaging-sw.js */
async function registerMessagingSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    console.log('[FCM] Service Worker registered:', reg && reg.scope);
    return reg;
  } catch (err) {
    console.warn('[FCM] SW register failed', err && err.message ? err.message : err);
    return null;
  }
}

/** Internal helper to get the VAPID key set at build time (or window fallback). */
function getVapidKey() {
  if (typeof window !== 'undefined' && window.__REACT_APP_FIREBASE_VAPID_KEY) {
    return window.__REACT_APP_FIREBASE_VAPID_KEY;
  }
  if (typeof process !== 'undefined' && process.env && process.env.REACT_APP_FIREBASE_VAPID_KEY) {
    return process.env.REACT_APP_FIREBASE_VAPID_KEY;
  }
  return null;
}

/**
 * obtainFcmToken()
 * - Attempts to obtain an FCM token and returns it (does NOT write to DB).
 * - Returns token string or null.
 * Use this when you only want the token value (no DB write).
 */
export async function obtainFcmToken() {
  try {
    if (typeof Notification === 'undefined') {
      console.warn('[FCM] Notifications not supported in this environment');
      return null;
    }

    // If permission is 'default' we *do not* automatically request here — caller may want to trigger
    // request in a user gesture. But if permission is 'granted' proceed.
    if (Notification.permission !== 'granted') {
      console.warn('[FCM] Notification.permission !== "granted" (value: ' + Notification.permission + ')');
      return null;
    }

    const supported = await isSupported().catch(() => false);
    if (!supported) {
      console.warn('[FCM] Firebase Messaging not supported');
      return null;
    }

    // Best effort: register SW if possible
    const swReg = await registerMessagingSW();

    const messaging = getMessaging();
    const vapidKey = getVapidKey();
    const options = {};
    if (vapidKey) options.vapidKey = vapidKey;
    if (swReg) options.serviceWorkerRegistration = swReg;

    const token = await getToken(messaging, options);
    if (!token) {
      console.warn('[FCM] getToken returned null/empty');
      return null;
    }
    console.log('[FCM] obtainFcmToken ->', token);
    return token;
  } catch (err) {
    console.warn('[FCM] obtainFcmToken error:', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * obtainFcmTokenAndSave(uid)
 * - Requests Notification permission if needed (requests user permission).
 * - Obtains token and writes to RTDB at:
 *     users/{uid}/fcmTokens/{token} = true
 *     users/{uid}/lastFcmToken = token
 * - Returns token string or null.
 */
export async function obtainFcmTokenAndSave(uid) {
  if (!uid) {
    console.warn('[FCM] obtainFcmTokenAndSave called without uid');
    return null;
  }

  try {
    if (typeof Notification === 'undefined') {
      console.warn('[FCM] Notifications not supported');
      return null;
    }

    // Request permission only if default (so we don't spam prompt)
    if (Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (e) {
        console.warn('[FCM] Notification.requestPermission threw', e && e.message ? e.message : e);
      }
    }

    if (Notification.permission !== 'granted') {
      console.warn('[FCM] Notification permission not granted (status: ' + Notification.permission + ')');
      return null;
    }

    const supported = await isSupported().catch(() => false);
    if (!supported) {
      console.warn('[FCM] Firebase Messaging not supported in this browser');
      return null;
    }

    const swReg = await registerMessagingSW();

    const messaging = getMessaging();
    const vapidKey = getVapidKey();
    const options = {};
    if (vapidKey) options.vapidKey = vapidKey;
    if (swReg) options.serviceWorkerRegistration = swReg;

    const token = await getToken(messaging, options);
    if (!token) {
      console.warn('[FCM] getToken returned null');
      return null;
    }

    try {
      // write the token presence to RTDB
      await set(ref(rtdb, `users/${uid}/fcmTokens/${token}`), true);
      await set(ref(rtdb, `users/${uid}/lastFcmToken`), token);
    } catch (dbErr) {
      console.warn('[FCM] Failed to write token to RTDB', dbErr && dbErr.message ? dbErr.message : dbErr);
    }

    console.log('[FCM] obtainFcmTokenAndSave ->', token);
    return token;
  } catch (err) {
    console.warn('[FCM] obtainFcmTokenAndSave error:', err && err.message ? err.message : err);
    return null;
  }
}

/** removeFcmToken(uid, token) - remove token key from users/{uid}/fcmTokens */
export async function removeFcmToken(uid, token) {
  if (!uid || !token) return;
  try {
    // set to null to remove
    await set(ref(rtdb, `users/${uid}/fcmTokens/${token}`), null);
    console.log('[FCM] removed token for uid', uid);
  } catch (e) {
    console.warn('[FCM] could not remove token', e && e.message ? e.message : e);
  }
}

/** setupOnMessage(cb) - registers onMessage to receive payloads while page is foreground */
export function setupOnMessage(onMessageCallback) {
  isSupported().then(supported => {
    if (!supported) return;
    try {
      const messaging = getMessaging();
      onMessage(messaging, payload => {
        console.log('[FCM] onMessage payload:', payload);
        if (typeof onMessageCallback === 'function') onMessageCallback(payload);
      });
    } catch (e) {
      console.warn('[FCM] onMessage setup failed', e && e.message ? e.message : e);
    }
  }).catch(e => {
    console.warn('[FCM] isSupported() failed', e && e.message ? e.message : e);
  });
}
