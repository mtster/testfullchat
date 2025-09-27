// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore, serverTimestamp } from "firebase/firestore";
import { getDatabase } from "firebase/database";

/**
 * Firebase config - reuse your existing values (the repo already had these).
 * Keep the same config as in your project.
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
const serverTs = serverTimestamp();

/**
 * VAPID public key for FCM web push.
 * Put your public VAPID key here or set it through REACT_APP_FIREBASE_VAPID_KEY.
 *
 * On GitHub Pages (no secure env injection), the easiest path is to set it in index.html:
 * <script>window.__REACT_APP_FIREBASE_VAPID_KEY = "YOUR_VAPID_KEY_HERE";</script>
 */
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
    return (base ? base.replace(/\/$/,'') : '') + '/firebase-messaging-sw.js';
  } catch (e) {
    return '/firebase-messaging-sw.js';
  }
}

/**
 * Try to obtain an FCM token for this browser. Uses dynamic import so it won't crash unsupported browsers (e.g. older Safari).
 * Returns the token string or null.
 */
export async function obtainFcmToken() {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  if (Notification.permission === 'denied') return null;
  try {
    const messagingModule = await import('firebase/messaging');
    const { getMessaging, getToken } = messagingModule;
    // register service worker if available
    let registration = null;
    try {
      if ('serviceWorker' in navigator) {
        registration = await navigator.serviceWorker.register(getServiceWorkerURL());
      }
    } catch (err) {
      // registration failed but we still try without it
      registration = null;
    }
    const messaging = getMessaging(app);
    const options = {};
    if (VAPID_KEY && VAPID_KEY !== 'YOUR_VAPID_KEY_HERE') options.vapidKey = VAPID_KEY;
    if (registration) options.serviceWorkerRegistration = registration;
    const token = await getToken(messaging, options);
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
  try {
    if (typeof window === 'undefined') return () => {};
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

export { app, db, rtdb, serverTs as serverTimestamp };
