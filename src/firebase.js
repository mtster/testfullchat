// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, push } from "firebase/database";
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

/** Compute a safe base path for the project page. */
function computeSiteBasePath() {
  // 1) If PUBLIC_URL is provided at build time, use it (CRA behavior)
  if (typeof process !== "undefined" && process.env && process.env.PUBLIC_URL) {
    // PUBLIC_URL might be absolute or relative. Normalize to path part only.
    try {
      const u = new URL(process.env.PUBLIC_URL, window.location.href);
      return u.pathname.replace(/\/$/, "");
    } catch (e) {
      // fallback to raw PUBLIC_URL
      return String(process.env.PUBLIC_URL).replace(/\/$/, "");
    }
  }

  // 2) If running as username.github.io (no repo), base is empty string
  // If running as username.github.io/reponame/..., base is '/reponame'
  if (typeof window !== "undefined" && window.location && window.location.pathname) {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return "";
    // If site is hosted under gh-pages as a project page, the repo name is the first segment.
    // Use that as the base (e.g. '/reponame').
    return `/${parts[0]}`;
  }

  return "";
}

/** Build the SW URL we should register. */
function computeSwUrl() {
  try {
    const basePath = computeSiteBasePath(); // like '' or '/reponame'
    const origin = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";
    // sw should be placed at: origin + basePath + '/firebase-messaging-sw.js'
    return `${origin}${basePath}/firebase-messaging-sw.js`;
  } catch (e) {
    return "/firebase-messaging-sw.js";
  }
}

/** Robust service worker registration using computed path & scope */
async function registerMessagingSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, reason: "no-service-worker-support", swUrl: null };
  }

  const swUrl = computeSwUrl();
  const scope = (function () {
    // scope must match basePath (or root '/')
    const basePath = computeSiteBasePath();
    return basePath ? `${basePath}/` : "/";
  })();

  try {
    // Try existing registration first but prefer registrations that match our expected scope
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    for (const reg of registrations || []) {
      try {
        if (reg && reg.scope && reg.scope.endsWith(scope)) {
          return { ok: true, registration: reg, used: "existing-matching-scope", swUrl, scope };
        }
      } catch (e) { /* ignore */ }
    }

    // Try to register at computed swUrl with the computed scope
    const reg = await navigator.serviceWorker.register(swUrl, { scope });
    return { ok: true, registration: reg, used: "registered", swUrl, scope };
  } catch (err) {
    // Return the attempted SW URL and the error reason for debugging
    const reason = (err && err.message) ? err.message : String(err);
    return { ok: false, reason, swUrl, scope };
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
    await set(ref(rtdb, `users/${uid}/fcmDebug/lastAttempt`), payload);
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

    // Register SW using computed project-aware URL
    const sw = await registerMessagingSW();
    if (!sw.ok) {
      console.warn('[FCM] SW register failed:', sw.reason, 'swUrl:', sw.swUrl, 'scope:', sw.scope);
      // continue — getToken might still work without swReg on some browsers (but likely won't)
    }

    const messaging = getMessaging();
    const vapidKey = getVapidKey();

    // Try multiple combinations similar to previous logic
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
        }
      } catch (err) {
        console.warn('[FCM] getToken error on', a.name, err && err.message ? err.message : err);
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

  // Resolve uid
  let resolvedUid = uid || null;
  if (!resolvedUid) {
    try {
      const auth = getAuth();
      if (auth && auth.currentUser && auth.currentUser.uid) resolvedUid = auth.currentUser.uid;
    } catch (e) {}
  }
  if (!resolvedUid && typeof window !== 'undefined') {
    if (window.__CURRENT_USER_UID__) resolvedUid = window.__CURRENT_USER_UID__;
    else if (window.currentUser && (window.currentUser.uid || window.currentUser.id)) {
      resolvedUid = window.currentUser.uid || window.currentUser.id;
    }
  }

  const baseDebug = {
    ts: startTs,
    clientTime: new Date(startTs).toISOString(),
    userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : null,
    permission: (typeof Notification !== 'undefined' ? Notification.permission : 'no-notification-api'),
    resolvedUid: resolvedUid || null,
    attempts: []
  };

  if (!resolvedUid) {
    await writeDebug(null, { ...baseDebug, note: "no-uid-resolved" });
    console.warn('[FCM] no uid resolved for token save');
    return null;
  }

  if (typeof Notification === 'undefined') {
    const dbg = { ...baseDebug, note: 'no-notification-api' };
    await writeDebug(resolvedUid, dbg);
    return null;
  }

  // Request permission if default (should be triggered by a user gesture)
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch (e) {
      const dbg = { ...baseDebug, note: 'requestPermission-threw', error: (e && e.message) ? e.message : String(e) };
      await writeDebug(resolvedUid, dbg);
      return null;
    }
  }

  baseDebug.permission = Notification.permission;
  if (Notification.permission !== 'granted') {
    const dbg = { ...baseDebug, note: 'permission-not-granted' };
    await writeDebug(resolvedUid, dbg);
    return null;
  }

  // Register SW and capture result
  const swRegInfo = await registerMessagingSW();
  baseDebug.sw = { ok: swRegInfo.ok, used: swRegInfo.used || null, reason: swRegInfo.reason || null, swUrl: swRegInfo.swUrl || null, scope: swRegInfo.scope || null };

  // Try obtaining token, capturing per-attempt info
  let token = null;
  try {
    const supported = await isSupported().catch(() => false);
    if (!supported) {
      const dbg = { ...baseDebug, note: 'messaging-not-supported' };
      await writeDebug(resolvedUid, dbg);
      return null;
    }

    const messaging = getMessaging();
    const vapidKey = getVapidKey();
    // try to get registration from navigator (may be null)
    const swRegObj = (await navigator.serviceWorker.getRegistration().catch(() => null)) || (swRegInfo && swRegInfo.registration ? swRegInfo.registration : null);

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

  if (token) {
    try {
      await set(ref(rtdb, `users/${resolvedUid}/fcmTokens/${token}`), true);
      await set(ref(rtdb, `users/${resolvedUid}/lastFcmToken`), token);
    } catch (dbErr) {
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
