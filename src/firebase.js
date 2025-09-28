// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { getAuth } from "firebase/auth";

/**
 * Replace/keep this firebaseConfig with your project's config
 * (kept the values you previously used).
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
 * - Returns token string or null.
 * - Does NOT request permission: caller must ensure Notification.permission === 'granted'
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
 * obtainFcmTokenAndSave(uid?)
 * - uid optional. If not provided, tries firebase auth and window fallbacks.
 * - Requests permission if it's 'default' (so it can be invoked inside a user gesture).
 * - Writes token to RTDB at users/{uid}/fcmTokens/{token} = true and users/{uid}/lastFcmToken = token.
 * - Returns token string or null.
 */
export async function obtainFcmTokenAndSave(uid) {
  try {
    // resolve uid if not provided
    let resolvedUid = uid || null;
    if (!resolvedUid) {
      try {
        const auth = getAuth();
        if (auth && auth.currentUser && auth.currentUser.uid) {
          resolvedUid = auth.currentUser.uid;
        }
      } catch (e) {
        console.warn('[FCM] getAuth() failed while resolving uid', e && e.message ? e.message : e);
      }
    }
    // fallback to global app exposures
    if (!resolvedUid && typeof window !== 'undefined') {
      if (window.currentUser && (window.currentUser.uid || window.currentUser.id)) {
        resolvedUid = window.currentUser.uid || window.currentUser.id;
      } else if (window.__CURRENT_USER_UID__) {
        resolvedUid = window.__CURRENT_USER_UID__;
      }
    }

    // If no uid found, don't fail silently — return null after explaining why
    if (!resolvedUid) {
      console.warn('[FCM] obtainFcmTokenAndSave: no uid provided and could not resolve current user uid. Provide uid or ensure Firebase Auth is signed in.');
      return null;
    }

    // Ensure Notification API exists
    if (typeof Notification === 'undefined') {
      console.warn('[FCM] Notifications not supported in this environment');
      return null;
    }

    // Request permission if default. This should be triggered by a user gesture.
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

    // messaging support
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
      await set(ref(rtdb, `users/${resolvedUid}/fcmTokens/${token}`), true);
      await set(ref(rtdb, `users/${resolvedUid}/lastFcmToken`), token);
      console.log('[FCM] Saved token to RTDB for uid', resolvedUid);
    } catch (dbErr) {
      console.warn('[FCM] Failed to write token to RTDB', dbErr && dbErr.message ? dbErr.message : dbErr);
      // still return token even if DB save failed
    }

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

/** setupOnMessage(cb) - foreground message hook */
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

/** onForegroundMessage alias for compatibility */
export const onForegroundMessage = (cb) => setupOnMessage(cb);
