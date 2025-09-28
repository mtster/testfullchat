// src/firebase.js
// --- paste into src/firebase.js (or your firebase util) ---

import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";

////////////////////////////////////////////////////////////////////////////////
// Replace or keep your firebaseConfig object below - this is the same config used by your app
const firebaseConfig = {
  // your config - keep exactly as in your app
  apiKey: "AIzaSyA-FwUy8WLXiYtT46F0f59gr461cEI_zmo",
  authDomain: "protocol-chat-b6120.firebaseapp.com",
  databaseURL: "https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "protocol-chat-b6120",
  storageBucket: "protocol-chat-b6120.appspot.com",
  messagingSenderId: "969101904718",
  appId: "1:969101904718:web:8dcd0bc8690649235cec1f"
};
////////////////////////////////////////////////////////////////////////////////

export const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);

// Helper to register the SW (ensures path at root)
async function registerMessagingSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    // Ensure the file exists at /firebase-messaging-sw.js
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    console.log('[FCM] Service Worker registered:', reg && reg.scope);
    return reg;
  } catch (err) {
    console.warn('[FCM] SW register failed', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * Obtain an FCM token and save it under users/{uid}/fcmTokens/{token} = true
 * Also saves users/{uid}/lastFcmToken = token (for quick debug/inspection)
 * Returns the token or null.
 */
export async function obtainFcmTokenAndSave(uid) {
  if (!uid) {
    console.warn('[FCM] obtainFcmTokenAndSave called without uid');
    return null;
  }

  try {
    // Check Notification support
    if (typeof Notification === 'undefined') {
      console.warn('[FCM] Notifications not supported in this environment');
      return null;
    }

    // Request permission if default
    if (Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (e) {
        console.warn('[FCM] Notification.requestPermission threw', e && e.message ? e.message : e);
      }
    }

    if (Notification.permission !== 'granted') {
      console.warn('[FCM] Notification permission is not granted:', Notification.permission);
      return null;
    }

    // Check messaging support
    const supported = await isSupported().catch(() => false);
    if (!supported) {
      console.warn('[FCM] Firebase Messaging not supported in this browser');
      return null;
    }

    // Determine VAPID key (build-time env or window fallback)
    const vapidKey = (typeof window !== 'undefined' && window.__REACT_APP_FIREBASE_VAPID_KEY)
      || (typeof process !== 'undefined' && process.env && process.env.REACT_APP_FIREBASE_VAPID_KEY)
      || null;

    if (!vapidKey || vapidKey === 'YOUR_VAPID_KEY_HERE') {
      console.warn('[FCM] VAPID key missing. Make sure REACT_APP_FIREBASE_VAPID_KEY is set at build time.');
      // proceed — getToken will likely fail if vapidKey is invalid/missing
    }

    // Register the SW (best-effort)
    const swReg = await registerMessagingSW();

    const messaging = getMessaging();
    const getTokenOptions = {};
    if (vapidKey) getTokenOptions.vapidKey = vapidKey;
    if (swReg) getTokenOptions.serviceWorkerRegistration = swReg;

    // Attempt to get the token
    const token = await getToken(messaging, getTokenOptions);
    if (!token) {
      console.warn('[FCM] getToken returned null or empty');
      return null;
    }

    // Save token to RTDB at users/{uid}/fcmTokens/{token} = true
    try {
      await set(ref(rtdb, `users/${uid}/fcmTokens/${token}`), true);
      await set(ref(rtdb, `users/${uid}/lastFcmToken`), token);
    } catch (dbErr) {
      console.warn('[FCM] Failed to write token to RTDB', dbErr && dbErr.message ? dbErr.message : dbErr);
      // still return token even if DB save failed
    }

    console.log('[FCM] Token obtained and saved (maybe):', token);
    return token;
  } catch (err) {
    console.warn('[FCM] obtainFcmTokenAndSave error:', err && err.message ? err.message : err);
    return null;
  }
}

// Optional: remove a token from DB when logout/uninstall
export async function removeFcmToken(uid, token) {
  if (!uid || !token) return;
  try {
    // remove by setting null
    await set(ref(rtdb, `users/${uid}/fcmTokens/${token}`), null);
    // don't remove lastFcmToken automatically (optional)
    console.log('[FCM] Removed token from RTDB for uid:', uid);
  } catch (e) {
    console.warn('[FCM] could not remove token', e && e.message ? e.message : e);
  }
}

// Listen for foreground messages (in-app)
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
