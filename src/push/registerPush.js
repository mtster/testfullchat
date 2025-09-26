// src/push/registerPush.js
// Usage: import { initPushForUser } from './push/registerPush'
// and call: initPushForUser(firebaseApp, rtdb, userObj)
// where userObj contains at least { username, email, id | uid | userId }

import { getMessaging, isSupported, getToken, onMessage } from "firebase/messaging";
import { ref as dbRef, set as dbSet, get as dbGet, push as dbPush } from "firebase/database";

/* helper to convert base64 VAPID to Uint8Array for PushManager */
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
  if (!user) return;
  // resolve uid used in DB (we'll assume caller passes the DB user id if available)
  const uid = user.id || user.uid || user.userId || null;

  // quick debug log that we started
  try { if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/startedAt`), Date.now()); } catch(e){}

  // 1) register SW (must be at /firebase-messaging-sw.js)
  let swReg = null;
  try {
    if ("serviceWorker" in navigator) {
      swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/swRegistered`), { ok: true, time: Date.now() });
    } else {
      if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/swSupported`), false);
    }
  } catch (err) {
    if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/swRegisterError`), String(err));
  }

  // 2) ask explicit permission (this triggers the OS/Browser dialog)
  let permission = Notification.permission;
  try {
    // force prompt in browsers where it hasn't been asked yet
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/notificationPermission`), permission);
  } catch (err) {
    if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/requestPermError`), String(err));
  }

  if (permission !== "granted") {
    // user denied or not granted — record and stop
    if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/permissionNotGranted`), permission);
    return;
  }

  // 3) Try Firebase Messaging (preferred) if supported
  try {
    const supported = await isSupported();
    if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/messagingIsSupported`), supported);
    if (supported) {
      const messaging = getMessaging(firebaseApp);
      // try to read VAPID key from DB (optional)
      let vapidKey = null;
      try {
        const snap = await dbGet(dbRef(rtdb, `config/fcm/vapidKey`));
        vapidKey = snap && snap.exists() ? snap.val() : null;
        if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/fcmVapidKeyFound`), !!vapidKey);
      } catch (e) {
        if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/vapidReadError`), String(e));
      }

      try {
        const token = await getToken(messaging, { vapidKey: vapidKey || undefined, serviceWorkerRegistration: swReg || undefined });
        if (token && uid) {
          await dbSet(dbRef(rtdb, `fcmTokens/${uid}/${token}`), { createdAt: Date.now(), platform: "fcm-web" });
          await dbSet(dbRef(rtdb, `debug/push/${uid}/fcmTokenWritten`), { token, time: Date.now() });
        }
        // listen for foreground messages (optional)
        onMessage(messaging, (payload) => {
          if (uid) dbSet(dbRef(rtdb, `debug/push/${uid}/lastOnMessage`), { payload, time: Date.now() });
        });
        return;
      } catch (e) {
        if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/fcmGetTokenError`), String(e));
        // fallthrough to PushManager fallback
      }
    }
  } catch (e) {
    if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/isSupportedError`), String(e));
  }

  // 4) Fallback: PushManager subscription using VAPID public key from config/webpush/publicKey
  try {
    if (!swReg) {
      if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/noSwForPushManager`), true);
      return;
    }

    const vapidSnap = await dbGet(dbRef(rtdb, `config/webpush/publicKey`));
    const publicKey = vapidSnap && vapidSnap.exists() ? vapidSnap.val() : null;
    if (!publicKey) {
      if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/noWebpushPublicKey`), true);
      return;
    }

    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    if (uid) {
      const pushNode = dbRef(rtdb, `webPushSubscriptions/${uid}`);
      const p = await dbPush(pushNode, { subscription: sub.toJSON(), createdAt: Date.now(), platform: "webpush" });
      await dbSet(dbRef(rtdb, `debug/push/${uid}/webPushSaved`), { id: p.key, time: Date.now() });
    }
  } catch (err) {
    if (uid) await dbSet(dbRef(rtdb, `debug/push/${uid}/pushManagerError`), String(err));
  }
}
