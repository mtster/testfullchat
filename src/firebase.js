// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore, serverTimestamp } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getMessaging, getToken, deleteToken, onMessage } from "firebase/messaging";

/**
 * NOTE:
 * If you cannot set environment variables during build, replace the placeholder
 * values below with your actual values (firebaseConfig already present).
 *
 * Also ensure REACT_APP_FIREBASE_VAPID_KEY contains the PUBLIC VAPID key (from
 * Firebase Console -> Project settings -> Cloud Messaging -> Web Push certificates).
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

// Firestore (exported in case other parts use it)
const db = getFirestore(app);

// Realtime Database
const rtdb = getDatabase(app);

// VAPID key (public) — put your public VAPID key in REACT_APP_FIREBASE_VAPID_KEY
const VAPID_KEY = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_FIREBASE_VAPID_KEY)
  ? process.env.REACT_APP_FIREBASE_VAPID_KEY
  : (typeof window !== 'undefined' && window.__REACT_APP_FIREBASE_VAPID_KEY) || "BAhd__iDU8kvxQ65a7ebCZCL8HpB9B07W4BkythVrR__ZweCuef7db6mzErw-3hPk7VhSG_LJHocyAbtDXZuAHI";

let messaging = null;
try {
  messaging = getMessaging(app);
} catch (err) {
  // OK if messaging is not supported in this environment
  console.warn("getMessaging() not available in this environment:", err && err.message);
  messaging = null;
}

/**
 * Compute the service worker URL according to PUBLIC_URL so it works on GitHub Pages
 * (the app may be served under a repo path like /testfullchat).
 */
function getServiceWorkerURL() {
  try {
    // process.env.PUBLIC_URL will be substituted at build time (CRA). If not available, fallback to empty.
    const base = (typeof process !== 'undefined' && process.env && process.env.PUBLIC_URL) ? process.env.PUBLIC_URL : (window && window.PUBLIC_URL ? window.PUBLIC_URL : "");
    // ensure leading slash if base not empty and doesn't already start with '/'
    if (base && base.charAt(0) !== "/") {
      return `/${base.replace(/\/$/, "")}/firebase-messaging-sw.js`;
    }
    return `${base}/firebase-messaging-sw.js`.replace(/\/\/+/g, '/');
  } catch (err) {
    return '/firebase-messaging-sw.js';
  }
}

/**
 * Request/obtain an FCM token and return it.
 * - registers the service worker at PUBLIC_URL/firebase-messaging-sw.js
 * - requests Notification permission if needed
 * - returns the token string or null if couldn't get one
 *
 * This function is defensive and logs errors instead of letting promises reject unhandled.
 */
export async function obtainFcmToken() {
  if (!messaging) {
    console.debug("FCM: messaging not available in this environment.");
    return null;
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.debug("FCM: serviceWorker or PushManager not supported by browser.");
    return null;
  }

  // register service worker using PUBLIC_URL-aware path
  const swUrl = getServiceWorkerURL();
  try {
    // register returns a ServiceWorkerRegistration
    await navigator.serviceWorker.register(swUrl);
    console.debug("FCM: service worker registered at:", swUrl);
  } catch (err) {
    console.warn("FCM: service worker registration failed for", swUrl, err && err.message);
    // don't throw — gracefully fail
    return null;
  }

  // request permission when in default state; if denied, bail
  try {
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.debug("FCM: Notification permission was not granted:", permission);
        return null;
      }
    } else if (Notification.permission !== "granted") {
      console.debug("FCM: Notification permission currently:", Notification.permission);
      return null;
    }
  } catch (err) {
    console.warn("FCM: Notification.requestPermission() error:", err && err.message);
    return null;
  }

  // obtain token
  try {
    const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!currentToken) {
      console.debug("FCM: getToken returned null/empty (maybe VAPID key incorrect or blocked).");
      return null;
    }
    console.debug("FCM: obtained token (truncated):", currentToken && currentToken.substr ? currentToken.substr(0, 20) + "..." : currentToken);
    return currentToken;
  } catch (err) {
    console.warn("FCM: getToken failed:", err && err.message);
    return null;
  }
}

export async function removeFcmToken(token) {
  if (!messaging || !token) return;
  try {
    await deleteToken(messaging);
  } catch (err) {
    console.warn("FCM: deleteToken failed:", err && err.message);
  }
}

export function onForegroundMessage(handler) {
  if (!messaging) {
    return () => {};
  }
  try {
    const unsubscribe = onMessage(messaging, (payload) => {
      try {
        handler(payload);
      } catch (handlerErr) {
        console.error("onForegroundMessage handler threw:", handlerErr);
      }
    });
    return unsubscribe;
  } catch (err) {
    console.warn("onForegroundMessage setup failed:", err && err.message);
    return () => {};
  }
}

export { app, db, rtdb, serverTimestamp };
