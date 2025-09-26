// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const webpush = require("web-push");

admin.initializeApp();

// helper: read webpush keys from RTDB (config/webpush)
async function loadWebPushVAPID() {
  try {
    const snap = await admin.database().ref("config/webpush").once("value");
    if (!snap.exists()) return null;
    const cfg = snap.val() || {};
    if (!cfg.publicKey || !cfg.privateKey) return null;
    const contact = cfg.contactEmail || "mailto:admin@example.com";
    webpush.setVapidDetails(contact, cfg.publicKey, cfg.privateKey);
    return { publicKey: cfg.publicKey, privateKey: cfg.privateKey, contact };
  } catch (e) {
    console.warn("loadWebPushVAPID error", e && e.message);
    return null;
  }
}

async function sendWebPushToSubscriptions(subscriptions, payload) {
  if (!subscriptions || subscriptions.length === 0) return;
  // send each; cleanup failed ones
  const removals = [];
  for (const s of subscriptions) {
    try {
      const sub = s.subscription;
      // web-push expects the object exactly as pushManager.toJSON()
      await webpush.sendNotification(sub, JSON.stringify(payload));
    } catch (err) {
      // If a subscription is no longer valid, remove it
      console.warn("webpush send error", err && err.statusCode, err && err.body);
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        // schedule removal
        removals.push(s);
      }
    }
  }
  // remove dead subs
  for (const r of removals) {
    try {
      await admin.database().ref(`webPushSubscriptions/${r.uid}/${r.key}`).remove();
    } catch (e) {
      console.warn("failed to remove dead webpush subscription", e && e.message);
    }
  }
}

async function getAllRecipientTokensAndSubs(chatId, excludeUserId) {
  const chatSnap = await admin.database().ref(`chats/${chatId}`).once("value");
  if (!chatSnap.exists()) return { tokens: [], subscriptions: [] };
  const chat = chatSnap.val() || {};
  const participants = chat.participants || {};
  const userIds = new Set();

  if (participants && typeof participants === "object") {
    for (const [k, v] of Object.entries(participants)) {
      if (v === true) userIds.add(k);
      else if (typeof v === "string") userIds.add(v);
      else if (v && typeof v === "object") {
        if (v.id) userIds.add(v.id);
        if (v.uid) userIds.add(v.uid);
      } else {
        // if key looks like a user id
        if (k && k.length > 10) userIds.add(k);
      }
    }
  }

  // also fallback to chat.members or createdBy
  if (chat.members && typeof chat.members === "object") {
    Object.keys(chat.members).forEach((m) => userIds.add(m));
  }
  if (chat.createdBy) userIds.add(chat.createdBy);

  if (excludeUserId) userIds.delete(excludeUserId);

  const tokens = [];
  const subscriptions = []; // will collect { uid, key, subscription }

  for (const uid of Array.from(userIds)) {
    try {
      const tokSnap = await admin.database().ref(`fcmTokens/${uid}`).once("value");
      if (tokSnap.exists()) {
        const tokObj = tokSnap.val() || {};
        Object.keys(tokObj).forEach((tk) => {
          tokens.push({ token: tk, uid });
        });
      }
    } catch (e) {
      console.warn("error reading fcm tokens", uid, e && e.message);
    }

    try {
      const subsSnap = await admin.database().ref(`webPushSubscriptions/${uid}`).once("value");
      if (subsSnap.exists()) {
        const subs = subsSnap.val();
        Object.entries(subs).forEach(([k, v]) => {
          subscriptions.push({ uid, key: k, subscription: v.subscription });
        });
      }
    } catch (e) {
      console.warn("error reading webpush subs", uid, e && e.message);
    }
  }

  return { tokens, subscriptions };
}

async function sendNotificationsGeneric(message, chatId) {
  const senderId = message.senderId || null;
  const senderName = message.senderUsername || message.senderName || "Someone";
  const body = message.message || message.text || "New message";
  const notification = {
    title: senderName,
    body: body.length > 120 ? body.slice(0, 117) + "..." : body,
  };
  const data = { url: `/chat/${chatId}` };

  const { tokens, subscriptions } = await getAllRecipientTokensAndSubs(chatId, senderId);

  if (tokens && tokens.length > 0) {
    // send FCM multicast (as before)
    const tokenArray = tokens.map(t => t.token);
    try {
      const resp = await admin.messaging().sendMulticast({
        tokens: tokenArray,
        notification,
        data,
      });
      // cleanup invalid tokens
      const bads = [];
      resp.responses.forEach((r, idx) => {
        if (!r.success) {
          const e = r.error;
          if (e && (e.code === 'messaging/invalid-registration-token' || e.code === 'messaging/registration-token-not-registered')) {
            bads.push(tokens[idx]);
          }
        }
      });
      for (const b of bads) {
        await admin.database().ref(`fcmTokens/${b.uid}/${b.token}`).remove();
      }
    } catch (e) {
      console.warn("FCM multicast error", e && e.message);
    }
  }

  // Send Web Push for subscriptions (if any)
  if (subscriptions && subscriptions.length > 0) {
    const vapid = await loadWebPushVAPID();
    if (!vapid) {
      console.warn("No webpush VAPID keys configured at config/webpush — cannot send web push");
    } else {
      const payload = {
        notification,
        data,
      };
      // wrap subs with uid/key mapping
      try {
        await sendWebPushToSubscriptions(subscriptions, payload);
      } catch (e) {
        console.warn("web-push send error", e && e.message);
      }
    }
  }
}

// Trigger for nested messages
exports.sendMessageNotificationsNested = functions.database
  .ref("/messages/{chatId}/{messageId}")
  .onCreate(async (snap, context) => {
    const message = snap.val();
    const chatId = context.params.chatId;
    try {
      return await sendNotificationsGeneric(message, chatId);
    } catch (e) {
      console.error("error in nested trigger", e && e.message);
      return null;
    }
  });

// Trigger for flat messages that include chatId
exports.sendMessageNotificationsFlat = functions.database
  .ref("/messages/{messageId}")
  .onCreate(async (snap, context) => {
    const message = snap.val();
    if (!message || !message.chatId) return null;
    try {
      return await sendNotificationsGeneric(message, message.chatId);
    } catch (e) {
      console.error("error in flat trigger", e && e.message);
      return null;
    }
  });
