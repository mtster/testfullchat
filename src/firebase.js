import { initializeApp } from "firebase/app";
import { getFirestore, serverTimestamp } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getMessaging, getToken, deleteToken, onMessage } from "firebase/messaging";

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

// Firestore
const db = getFirestore(app);

// Realtime Database
const rtdb = getDatabase(app);

// Firebase Cloud Messaging (for web push)
// You MUST add your Web Push certificate (VAPID key) from Firebase Console and
// set it here. You can either replace the string below with the VAPID key or
// create an environment variable REACT_APP_FIREBASE_VAPID_KEY containing the key.
const VAPID_KEY = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_FIREBASE_VAPID_KEY)
  ? process.env.REACT_APP_FIREBASE_VAPID_KEY
  : "BAhd__iDU8kvxQ65a7ebCZCL8HpB9B07W4BkythVrR__ZweCuef7db6mzErw-3hPk7VhSG_LJHocyAbtDXZuAHI";

// get messaging instance (may throw in environments that don't support SW / Push)
let messaging = null;
try {
  messaging = getMessaging(app);
} catch (err) {
  // messaging not supported in this environment
  messaging = null;
}

/**
 * Request/obtain an FCM token and return it.
 * - registers the service worker at /firebase-messaging-sw.js
 * - requests Notification permission if needed
 * - returns the token string or null if couldn't get one
 */
export async function obtainFcmToken() {
  if (!messaging) return null;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;

  // register service worker
  try {
    await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  } catch (err) {
    console.warn("Service worker registration failed", err);
    // continue; getToken will fail below if SW required
  }

  // request permission
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (err) {
      console.warn("Notification permission request failed", err);
      return null;
    }
  }
  if (Notification.permission !== "granted") return null;

  try {
    const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });
    return currentToken || null;
  } catch (err) {
    console.warn("getToken failed", err);
    return null;
  }
}

export async function removeFcmToken(token) {
  if (!messaging || !token) return;
  try {
    await deleteToken(messaging);
  } catch (err) {
    console.warn("deleteToken failed", err);
  }
}

// allow app to handle foreground messages
export function onForegroundMessage(handler) {
  if (!messaging) return () => {};
  const unsubscribe = onMessage(messaging, (payload) => {
    handler(payload);
  });
  return unsubscribe;
}

export { app, db, rtdb, serverTimestamp };
