// src/push/registerPush.js
// Registers service worker, requests permission, subscribes to push, and saves subscription to RTDB
import urlBase64ToUint8Array from './urlBase64ToUint8Array';
import { rtdb } from '../firebase';
import { ref as dbRef, set as dbSet } from 'firebase/database';

/**
 * Put your VAPID public key here (base64 URL-safe). Replace before deploy.
 * You can generate a keypair with `npx web-push generate-vapid-keys` or online tools.
 */
const VAPID_PUBLIC_KEY = "BAdYi2DwAr_u2endCUZda9Sth0jVH8e6ceuQXn0EQAl3ALEQCF5cDoEB9jfE8zOdOpHlu0gyu1pUYFrGpU5wEWQ";

/**
 * Reads the current local user (if any) from localStorage key "frbs_user".
 * If your app stores the logged user under another key, adapt accordingly.
 */
function getLocalUser() {
  try {
    const raw = localStorage.getItem("frbs_user");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export async function registerForPush(user = null) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[registerForPush] Push or ServiceWorker not supported in this browser.');
      return null;
    }

    const currUser = user || getLocalUser();
    if (!currUser || !currUser.id) {
      console.warn('[registerForPush] no authenticated user detected; skipping subscription.');
      return null;
    }

    // Register service worker (public/sw.js)
    const registration = await navigator.serviceWorker.register('/sw.js');
    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[registerForPush] Notification permission not granted:', permission);
      return null;
    }

    // Subscribe
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    // Save to RTDB at users/{uid}/pushSubscription
    await dbSet(dbRef(rtdb, `users/${currUser.id}/pushSubscription`), subscription);

    console.log('[registerForPush] subscription saved for user', currUser.id);
    return subscription;
  } catch (e) {
    console.warn('[registerForPush] error', e);
    return null;
  }
}

export default registerForPush;
