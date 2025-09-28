// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";

/**
 * Keep / replace this firebaseConfig with the one your app uses.
 * I included the config values you previously posted.
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

/** Register SW at root /firebase-messaging-sw.js */
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

/** Get VAPID key from build-time env or window fallback */
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
 * - Returns a token string or null.
 * - Does NOT request permission. Caller should ensure Notification.permission === 'granted'
 */
export async function obtainFcmToken() {
  try {
    if (typeof Notification === 'undefined') {
      console.warn('[FCM] Notifications not supported in this environment');
      return null;
    }

    if (Notification.permission !== 'granted') {
      console.warn('[FCM] Notification.permission !== "granted" (value: ' + Notification.permission + ')');
      return null;
    }

    const supported = await isSupported().catch(() => false);
    if (!supported) {
      console.warn('[FCM] Firebase Messaging not supported');
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
 * - Requests permission if default, obtains token and writes it to RTDB.
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

    // Request permission only if default (so callers can trigger on a user gesture)
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
    await set(ref(rtdb, `users/${uid}/fcmTokens/${token}`), null);
    console.log('[FCM] removed token for uid', uid);
  } catch (e) {
    console.warn('[FCM] could not remove token', e && e.message ? e.message : e);
  }
}

/**
 * setupOnMessage(cb)
 * - Register onMessage to receive payloads while page is foreground
 */
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

/**
 * onForegroundMessage(payloadCallback)
 * - Compatibility export: same as setupOnMessage
 */
export const onForegroundMessage = (cb) => setupOnMessage(cb);
