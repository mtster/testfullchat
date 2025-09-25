// src/push/registerPush.js
import urlBase64ToUint8Array from "./urlBase64ToUint8Array";
import { rtdb } from "../firebase";
import { ref, set } from "firebase/database";

/**
 * VAPID public key (base64 url-safe)
 * Paste your VAPID public key here exactly as provided.
 */
export const VAPID_PUBLIC_KEY = "BAdYi2DwAr_u2endCUZda9Sth0jVH8e6ceuQXn0EQAl3ALEQCF5cDoEB9jfE8zOdOpHlu0gyu1pUYFrGpU5wEWQ";

async function getLocalUser() {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export default async function registerForPush() {
  try {
    if (!('serviceWorker' in navigator)) return;
    if (!('PushManager' in window)) return;
    const user = await getLocalUser();
    if (!user || !user.id) return; // best-effort: silently return if not logged in

    // register service worker (best-effort)
    let reg;
    try {
      reg = await navigator.serviceWorker.register('/sw.js');
    } catch (e) {
      console.warn('[registerForPush] sw register failed', e);
      return;
    }

    // request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return;
    }

    // subscribe
    let subscription;
    try {
      const convertedVapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });
    } catch (e) {
      console.warn('[registerForPush] subscribe failed', e);
      return;
    }

    // save to realtime DB at users/{uid}/pushSubscription
    try {
      const dbRef = ref(rtdb, `users/${user.id}/pushSubscription`);
      await set(dbRef, subscription);
      console.log('[registerForPush] subscription saved for user', user.id);
    } catch (e) {
      console.warn('[registerForPush] saving subscription failed', e);
    }
  } catch (e) {
    console.warn('[registerForPush] unexpected error', e);
  }
}
