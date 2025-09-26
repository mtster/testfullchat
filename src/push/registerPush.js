// src/push/registerPush.js
// Usage: import { initPushForUser } from './push/registerPush'
//         initPushForUser(firebaseApp, rtdb, user)
// Make sure this runs after the user is authenticated.

import { getMessaging, isSupported, getToken, onMessage } from "firebase/messaging";
import { ref as dbRef, get as dbGet, set as dbSet, push as dbPush, remove as dbRemove } from "firebase/database";

/* utility to convert VAPID base64 to Uint8Array for PushManager */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function initPushForUser(firebaseApp, rtdb, user) {
  if (!user || !user.id) {
    console.warn("initPushForUser: no user");
    return;
  }
  const uid = user.id;

  // Write a debug entry that we started
  try {
    await dbSet(dbRef(rtdb, `debug/push/${uid}/startedAt`), Date.now());
  } catch (e) { console.warn("debug push write failed", e); }

  // 1) register service worker (must be at site root: /firebase-messaging-sw.js)
  let swRegistration = null;
  if ("serviceWorker" in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      await dbSet(dbRef(rtdb, `debug/push/${uid}/swRegistered`), { ok: true, time: Date.now() });
    } catch (err) {
      console.warn("SW register failed", err);
      await dbSet(dbRef(rtdb, `debug/push/${uid}/swRegistered`), { ok: false, error: String(err), time: Date.now() });
    }
  } else {
    await dbSet(dbRef(rtdb, `debug/push/${uid}/swSupported`), false);
  }

  // 2) Try Firebase Messaging SDK (FCM) if supported
  try {
    const supported = await isSupported();
    await dbSet(dbRef(rtdb, `debug/push/${uid}/messagingSupported`), !!supported);
    if (supported) {
      try {
        // Request permission
        const permission = await Notification.requestPermission();
        await dbSet(dbRef(rtdb, `debug/push/${uid}/notificationPermission`), permission);

        if (permission === "granted") {
          const messaging = getMessaging(firebaseApp);

          // read vapidKey from DB (config/fcm/vapidKey) or hardcode here if you have it
          let vapidKey = null;
          try {
            const snap = await dbGet(dbRef(rtdb, `config/fcm/vapidKey`));
            vapidKey = snap && snap.exists() ? snap.val() : null;
            await dbSet(dbRef(rtdb, `debug/push/${uid}/vapidKeyFound`), !!vapidKey);
          } catch (e) {
            await dbSet(dbRef(rtdb, `debug/push/${uid}/vapidKeyError`), String(e));
          }

          // getToken (will register with FCM). If no vapidKey available, getToken may still work if configured in project.
          const token = await getToken(messaging, { vapidKey: vapidKey || undefined, serviceWorkerRegistration: swRegistration || undefined });
          if (token) {
            await dbSet(dbRef(rtdb, `fcmTokens/${uid}/${token}`), { createdAt: Date.now(), platform: "fcm-web" });
            await dbSet(dbRef(rtdb, `debug/push/${uid}/fcmToken`), { token, time: Date.now() });
          } else {
            await dbSet(dbRef(rtdb, `debug/push/${uid}/fcmToken`), { token: null, time: Date.now() });
          }

          // optional: onMessage to show in-app notifications; your app likely already has this.
          onMessage(messaging, (payload) => {
            console.log("FCM onMessage:", payload);
            dbSet(dbRef(rtdb, `debug/push/${uid}/lastOnMessage`), { payload, time: Date.now() });
          });
        } else {
          // permission denied or default
          await dbSet(dbRef(rtdb, `debug/push/${uid}/notificationPermission`), permission);
        }
        return; // done (we prefer FCM when available)
      } catch (fcmErr) {
        console.warn("FCM setup failed", fcmErr);
        await dbSet(dbRef(rtdb, `debug/push/${uid}/fcmSetupError`), String(fcmErr));
        // fallthrough to PushManager
      }
    }
  } catch (e) {
    console.warn("isSupported check failed", e);
    await dbSet(dbRef(rtdb, `debug/push/${uid}/isSupportedError`), String(e));
    // continue to push manager fallback
  }

  // 3) Fallback: standard Web Push subscription (PushManager)
  if (swRegistration && "pushManager" in swRegistration) {
    try {
      // fetch applicationServerKey (VAPID public key) from DB: config/webpush/publicKey
      const ksnap = await dbGet(dbRef(rtdb, `config/webpush/publicKey`));
      const publicKey = ksnap && ksnap.exists() ? ksnap.val() : null;

      await dbSet(dbRef(rtdb, `debug/push/${uid}/pushManagerPublicKeyFound`), !!publicKey);

      if (!publicKey) {
        await dbSet(dbRef(rtdb, `debug/push/${uid}/pushManagerError`), "noPublicKey");
        return;
      }

      // request permission (some browsers require this)
      const permission = await Notification.requestPermission();
      await dbSet(dbRef(rtdb, `debug/push/${uid}/notificationPermissionPushManager`), permission);
      if (permission !== "granted") return;

      const sub = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // store subscription in DB
      // push a node with JSON-serializable subscription
      const subsNode = dbRef(rtdb, `webPushSubscriptions/${uid}`);
      const pushedRef = await dbPush(subsNode, { subscription: sub.toJSON(), createdAt: Date.now(), platform: "webpush" });
      await dbSet(dbRef(rtdb, `debug/push/${uid}/pushManagerSubscription`), { id: pushedRef.key, createdAt: Date.now() });

      console.log("pushManager subscribed and saved");
    } catch (pmErr) {
      console.warn("pushManager subscribe failed", pmErr);
      await dbSet(dbRef(rtdb, `debug/push/${uid}/pushManagerError`), String(pmErr));
    }
  } else {
    await dbSet(dbRef(rtdb, `debug/push/${uid}/pushManagerSupported`), false);
  }
}
