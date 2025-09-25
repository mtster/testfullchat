// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore, serverTimestamp } from "firebase/firestore";
import { getDatabase } from "firebase/database";

/**
 * Firebase config - keep your existing values here (already present in your repo).
 * Do NOT put any private keys here.
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const rtdb = getDatabase(app);

// VAPID public key for FCM web push. Put your public VAPID key here or set it through REACT_APP_FIREBASE_VAPID_KEY
const VAPID_KEY = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_FIREBASE_VAPID_KEY)
  ? process.env.REACT_APP_FIREBASE_VAPID_KEY
  : (typeof window !== 'undefined' && window.__REACT_APP_FIREBASE_VAPID_KEY) || 'YOUR_VAPID_KEY_HERE';

/**
 * Compute service worker URL relative to PUBLIC_URL / base path.
 * This makes registration work on GitHub Pages repos served from a path.
 */
function getServiceWorkerURL() {
  try {
    const base = (typeof process !== 'undefined' && process.env && process.env.PUBLIC_URL)
      ? process.env.PUBLIC_URL
      : (typeof window !== 'undefined' && window.PUBLIC_URL ? window.PUBLIC_URL : "");
    if (!base) return '/firebase-messaging-sw.js';
    // ensure no trailing slash
    const trimmed = base.replace(/\/$/, '');
    return `${trimmed}/firebase-messaging-sw.js`.replace(/\/\/+/g, '/');
  } catch (err) {
    return '/firebase-messaging-sw.js';
  }
}

/**
 * Try to obtain FCM token in a safe way:
 * - registers service worker (PUBLIC_URL-aware)
 * - requests Notification permission if needed
 * - dynamically imports firebase/messaging only when needed
 * - returns token string or null; never throws unhandled rejections
 */
export async function obtainFcmToken() {
  // feature checks first
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // environment doesn't support web push (e.g., old browsers)
    return null;
  }

  // register service worker (PUBLIC_URL-aware path)
  const swUrl = getServiceWorkerURL();
  try {
    await navigator.serviceWorker.register(swUrl);
  } catch (err) {
    // service worker registration failed; bail out
    console.warn('SW registration failed:', err && err.message ? err.message : err);
    return null;
  }

  // request permission if needed
  try {
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return null;
    } else if (Notification.permission !== 'granted') {
      return null;
    }
  } catch (err) {
    console.warn('Notification.requestPermission failed:', err && err.message ? err.message : err);
    return null;
  }

  // dynamic import of messaging (avoids importing module in unsupported envs)
  try {
    const messagingModule = await import('firebase/messaging');
    const { getMessaging, getToken } = messagingModule;
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) return null;
    return token;
  } catch (err) {
    // expected in unsupported browsers — log but don't throw
    console.warn('obtainFcmToken: messaging getToken failed or unsupported:', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * Remove FCM token (best-effort).
 * Uses dynamic import to avoid errors in unsupported browsers.
 */
export async function removeFcmToken() {
  if (typeof window === 'undefined') return;
  try {
    const messagingModule = await import('firebase/messaging');
    const { getMessaging, deleteToken } = messagingModule;
    const messaging = getMessaging(app);
    try {
      await deleteToken(messaging);
    } catch (err) {
      // ignore
    }
  } catch (err) {
    // ignore - not supported environment
  }
}

/**
 * Handle foreground messages (in-app). Pass a handler(payload) that receives the message payload.
 * Returns a function that unsubscribes (best-effort). If messaging not supported, returns a no-op.
 */
export function onForegroundMessage(handler) {
  if (typeof window === 'undefined') return () => {};
  try {
    // dynamic import and attach
    let unsub = null;
    import('firebase/messaging').then((messagingModule) => {
      try {
        const { getMessaging, onMessage } = messagingModule;
        const messaging = getMessaging(app);
        unsub = onMessage(messaging, (payload) => {
          try { handler(payload); } catch (e) {}
        });
      } catch (e) { /* ignore */ }
    }).catch(() => { /* ignore */ });
    return () => {
      try { if (typeof unsub === 'function') unsub(); } catch (e) {}
    };
  } catch (err) {
    return () => {};
  }
}

export { app, db, rtdb, serverTimestamp };
