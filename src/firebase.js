// --- paste into src/firebase.js (or your firebase util) ---
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, update } from "firebase/database";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";

const firebaseConfig = {
  // your config
};
export const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);

// Helper to register the SW (ensures path at root)
async function registerMessagingSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // Ensure the file exists at /firebase-messaging-sw.js
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    console.log('[FCM] Service Worker registered:', reg.scope);
    return reg;
  } catch (err) {
    console.warn('[FCM] SW register failed', err);
    return null;
  }
}

/**
 * Obtain an FCM token and save it under users/{uid}/fcmTokens/{token} = true
 * Also saves users/{uid}/lastFcmToken = token (for quick debug/inspection)
 * Returns the token or null.
 */
export async function obtainFcmTokenAndSave(uid) {
  if (!uid) throw new Error('uid required');

  // Check Notification permission
  if (typeof Notification === 'undefined') {
    console.warn('[FCM] Notifications not supported in this browser');
    return null;
  }

  // Request notification permission (will show permission prompt)
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.warn('[FCM] Notification permission not granted:', permission);
    return null;
  }

  // Ensure browser supports messaging APIs
  const supported = await isSupported().catch(() => false);
  if (!supported) {
    console.warn('[FCM] Firebase Messaging not supported in this browser');
    return null;
  }

  // Ensure VAPID key is available
  const vapidKey = (typeof window !== 'undefined' && window.__REACT_APP_FIREBASE_VAPID_KEY) || process.env.REACT_APP_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.warn('[FCM] VAPID key missing. Add public key to window.__REACT_APP_FIREBASE_VAPID_KEY or env REACT_APP_FIREBASE_VAPID_KEY');
    // still try — may fail
  }

  // Register the SW
  const swReg = await registerMessagingSW();
  if (!swReg) {
    console.warn('[FCM] SW registration failed — token may not be obtained');
    return null;
  }

  try {
    const messaging = getMessaging(); // modular import above
    const token = await getToken(messaging, {
      vapidKey: vapidKey,
      serviceWorkerRegistration: swReg
    });

    if (!token) {
      console.warn('[FCM] getToken returned null/empty');
      return null;
    }

    // Save token to RTDB at users/{uid}/fcmTokens/{token} = true
    // And save lastFcmToken for quick UI debug
    const userTokensRef = ref(rtdb, `users/${uid}/fcmTokens/${token}`);
    await set(userTokensRef, true);
    const lastTokenRef = ref(rtdb, `users/${uid}/lastFcmToken`);
    await set(lastTokenRef, token);

    console.log('[FCM] Obtained token and saved to RTDB:', token);
    return token;
  } catch (err) {
    console.error('[FCM] error obtaining token', err);
    return null;
  }
}

// Optional: remove a token from DB when logout/uninstall
export async function removeFcmToken(uid, token) {
  if (!uid || !token) return;
  const tokenRef = ref(rtdb, `users/${uid}/fcmTokens/${token}`);
  try {
    await set(tokenRef, null);
  } catch (e) {
    console.warn('[FCM] could not remove token', e);
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
      console.warn('[FCM] onMessage setup failed', e);
    }
  });
}
