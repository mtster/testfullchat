// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, push, serverTimestamp } from "firebase/database";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { getAuth } from "firebase/auth";

/**
 * Your firebaseConfig - keep the same object you were using.
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
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, reason: "no-service-worker-support" };
  }
  try {
    // try to get an existing registration first
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) {
      return { ok: true, registration: existing, used: "existing" };
    }
    // otherwise register
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    return { ok: true, registration: reg, used: "registered" };
  } catch (err) {
    return { ok: false, reason: (err && err.message) ? err.message : String(err) };
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

/** Write structured debug info into RTDB under users/{uid}/fcmDebug */
async function writeDebug(uid, payload) {
  try {
    if (!uid) return;
    const base = ref(rtdb, `users/${uid}/fcmDebug`);
    // lastAttempt (easy to inspect)
    await set(ref(rtdb, `users/${uid}/fcmDebug/lastAttempt`), payload);
    // pushes a detailed attempt (history)
    await push(ref(rtdb, `users/${uid}/fcmDebug/attempts`), payload);
  } catch (err) {
    // best-effort; do not throw
    console.warn('[FCM][debug] write failed', err && err.message ? err.message : err);
  }
}

/**
 * obtainFcmToken()
 * - Does NOT request permission; returns token or null.
 * - Caller should ensure Notification.permission === 'granted'.
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

    // Ensure SW is registered
    const sw = await registerMessagingSW();
    if (!sw.ok) {
      console.warn('[FCM] SW register failed:', sw.reason);
      // continue — getToken might still work in some environments without swReg
    }

    const messaging = getMessaging();
    const vapidKey = getVapidKey();

    // We'll attempt multiple combinations to maximize chance on various browsers:
    // 1) vapidKey + serviceWorkerRegistration
    // 2) serviceWorkerRegistration only
    // 3) vapidKey only
    // 4) no options
    const attempts = [];

    if (vapidKey && sw.ok && sw.registration) {
      attempts.push({ name: 'vapid+sw', options: { vapidKey, serviceWorkerRegistration: sw.registration } });
    }
    if (sw.ok && sw.registration) {
      attempts.push({ name: 'sw-only', options: { serviceWorkerRegistration: sw.registration } });
    }
    if (vapidKey) {
      attempts.push({ name: 'vapid-only', options: { vapidKey } });
    }
    attempts.push({ name: 'no-options', options: {} });

    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      try {
        console.log('[FCM] getToken attempt', a.name, a.options);
        const token = await getToken(messaging, a.options);
        if (token) {
          console.log('[FCM] getToken success on', a.name);
          return token;
        } else {
          console.warn('[FCM] getToken returned null on', a.name);
          // continue to next attempt
        }
      } catch (err) {
        console.warn('[FCM] getToken error on', a.name, err && err.message ? err.message : err);
        // continue to next attempt
      }
    }

    // All attempts failed
    return null;
  } catch (err) {
    console.warn('[FCM] obtainFcmToken error:', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * obtainFcmTokenAndSave(uid?)
 * - Resolves uid similarly to your app: optional uid param, getAuth().currentUser, window.__CURRENT_USER_UID__
 * - Requests Notification permission if default (must be invoked in user gesture on iOS).
 * - Tries to obtain token via obtainFcmToken(), and writes debug info to RTDB.
 * - Saves successful token under users/{uid}/fcmTokens/{token} and lastFcmToken.
 * - Returns token string on success, null on failure.
 */
export async function obtainFcmTokenAndSave(uid) {
  const startTs = Date.now();
  // resolve uid
  let resolvedUid = uid || null;
  if (!resolvedUid) {
    try {
      const auth = getAuth();
      if (auth && auth.currentUser && auth.currentUser.uid) resolvedUid = auth.currentUser.uid;
    } catch (e) {
      // ignore
    }
  }
  if (!resolvedUid && typeof window !== 'undefined') {
    if (window.__CURRENT_USER_UID__) resolvedUid = window.__CURRENT_USER_UID__;
    else if (window.currentUser && (window.currentUser.uid || window.currentUser.id)) {
      resolvedUid = window.currentUser.uid || window.currentUser.id;
    }
  }

  // minimal debug object we will write
  const baseDebug = {
    ts: startTs,
    clientTime: new Date(startTs).toISOString(),
    userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : null,
    permission: (typeof Notification !== 'undefined' ? Notification.permission : 'no-notification-api'),
    resolvedUid: resolvedUid || null,
    attempts: []
  };

  if (!resolvedUid) {
    // write debug and return
    await writeDebug(null, { ...baseDebug, note: "no-uid-resolved" });
    console.warn('[FCM] no uid resolved for token save');
    return null;
  }

  // Ensure Notification API exists
  if (typeof Notification === 'undefined') {
    const dbg = { ...baseDebug, note: 'no-notification-api' };
    await writeDebug(resolvedUid, dbg);
    return null;
  }

  // Request permission if default (should be triggered inside user gesture)
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch (e) {
      // capture error
      const dbg = { ...baseDebug, note: 'requestPermission-threw', error: (e && e.message) ? e.message : String(e) };
      await writeDebug(resolvedUid, dbg);
      return null;
    }
  }

  // After request attempt, update permission value
  baseDebug.permission = Notification.permission;

  // If not granted, write debug and exit
  if (Notification.permission !== 'granted') {
    const dbg = { ...baseDebug, note: 'permission-not-granted' };
    await writeDebug(resolvedUid, dbg);
    return null;
  }

  // Now attempt to get token (obtainFcmToken tries multiple getToken options)
  try {
    const vapidKey = getVapidKey();
    const swRegistrationInfo = await registerMessagingSW();
    // record SW status
    baseDebug.sw = { ok: swRegistrationInfo.ok, used: swRegistrationInfo.used || null, reason: swRegistrationInfo.reason || null };
  } catch (e) {
    baseDebug.sw = { ok: false, reason: (e && e.message) ? e.message : String(e) };
  }

  // Try obtaining token and track each attempt in debug
  let token = null;
  try {
    // We'll replicate the internal attempts used by obtainFcmToken() and also capture errors per attempt
    const supported = await isSupported().catch(() => false);
    if (!supported) {
      const dbg = { ...baseDebug, note: 'messaging-not-supported' };
      await writeDebug(resolvedUid, dbg);
      return null;
    }

    // We'll gather attempts in the debug object by reusing obtainFcmToken logic but capturing each step
    const messaging = getMessaging();
    const vapidKey = getVapidKey();
    const swRegObj = await navigator.serviceWorker.getRegistration().catch(() => null);

    const attemptConfigs = [];
    if (vapidKey && swRegObj) attemptConfigs.push({ name: 'vapid+sw', options: { vapidKey, serviceWorkerRegistration: swRegObj } });
    if (swRegObj) attemptConfigs.push({ name: 'sw-only', options: { serviceWorkerRegistration: swRegObj } });
    if (vapidKey) attemptConfigs.push({ name: 'vapid-only', options: { vapidKey } });
    attemptConfigs.push({ name: 'no-options', options: {} });

    for (let i = 0; i < attemptConfigs.length; i++) {
      const cfg = attemptConfigs[i];
      const attempt = { name: cfg.name, optionsProvided: Object.keys(cfg.options || {}), result: null, error: null };
      try {
        const t = await getToken(messaging, cfg.options);
        if (t) {
          attempt.result = { token: t };
          baseDebug.attempts.push(attempt);
          token = t;
          break;
        } else {
          attempt.result = null;
          baseDebug.attempts.push(attempt);
        }
      } catch (err) {
        attempt.error = (err && err.message) ? err.message : String(err);
        baseDebug.attempts.push(attempt);
      }
    }
  } catch (err) {
    const dbg = { ...baseDebug, note: 'getToken-flow-threw', error: (err && err.message) ? err.message : String(err) };
    await writeDebug(resolvedUid, dbg);
    return null;
  }

  // Write final debug and save token if obtained
  if (token) {
    try {
      await set(ref(rtdb, `users/${resolvedUid}/fcmTokens/${token}`), true);
      await set(ref(rtdb, `users/${resolvedUid}/lastFcmToken`), token);
    } catch (dbErr) {
      // include DB error in debug
      baseDebug.dbError = (dbErr && dbErr.message) ? dbErr.message : String(dbErr);
    }
    const successDbg = { ...baseDebug, note: 'token-obtained', token, tsEnd: Date.now() };
    await writeDebug(resolvedUid, successDbg);
    return token;
  } else {
    const failDbg = { ...baseDebug, note: 'no-token-obtained', tsEnd: Date.now() };
    await writeDebug(resolvedUid, failDbg);
    return null;
  }
}

/** Optional: remove a token from DB when logout/uninstall */
export async function removeFcmToken(uid, token) {
  if (!uid || !token) return;
  try {
    await set(ref(rtdb, `users/${uid}/fcmTokens/${token}`), null);
  } catch (e) {
    console.warn('[FCM] could not remove token', e && e.message ? e.message : e);
  }
}

/** setupOnMessage: foreground message hook alias */
export function setupOnMessage(onMessageCallback) {
  isSupported().then(supported => {
    if (!supported) return;
    try {
      const messaging = getMessaging();
      onMessage(messaging, payload => {
        if (typeof onMessageCallback === 'function') onMessageCallback(payload);
      });
    } catch (e) {
      console.warn('[FCM] onMessage setup failed', e && e.message ? e.message : e);
    }
  }).catch(e => {
    console.warn('[FCM] isSupported() failed', e && e.message ? e.message : e);
  });
}

/** alias kept for compatibility */
export const onForegroundMessage = (cb) => setupOnMessage(cb);
