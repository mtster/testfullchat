// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

async function getAllRecipientTokens(chatId, excludeUserId) {
  // gather user ids from chat participants; the function tolerates multiple shapes
  const chatSnap = await admin.database().ref(`chats/${chatId}`).once("value");
  if (!chatSnap || !chatSnap.exists()) return [];

  const chat = chatSnap.val() || {};
  const participants = chat.participants || {};
  const participantUsernames = chat.participantUsernames || null;
  const userIds = new Set();

  // participants might be object with keys equal to userId, or object with push ids -> userId, or nested objects
  if (participants && typeof participants === "object") {
    for (const [k, v] of Object.entries(participants)) {
      if (!v) continue;
      if (k && typeof k === "string" && k.startsWith("-O")) {
        // could be an auto-generated key; value might be an object with userId
        if (typeof v === "string") {
          // v could be userId
          userIds.add(v);
        } else if (typeof v === "object") {
          if (v.id) userIds.add(v.id);
          if (v.uid) userIds.add(v.uid);
          if (v.userId) userIds.add(v.userId);
          if (v.username && chat.userMap && chat.userMap[v.username]) {
            // edge case
          }
        }
      } else {
        // if key appears like a userId
        if (typeof k === "string" && k.length > 5) userIds.add(k);
        // if value is boolean true (common pattern)
        if (v === true && k && typeof k === "string") userIds.add(k);
      }
    }
  }

  // sometimes participantUsernames is present without ids; we can't map usernames to ids reliably here
  // so we will try to fallback to: if chat has a 'members' list that contains id-like values
  if (chat.members && typeof chat.members === "object") {
    Object.keys(chat.members || {}).forEach((mid) => userIds.add(mid));
  }

  // ensure excludeUserId not included
  if (excludeUserId) userIds.delete(excludeUserId);

  // collect tokens
  const tokens = [];
  for (const uid of Array.from(userIds)) {
    try {
      const tokSnap = await admin.database().ref(`fcmTokens/${uid}`).once("value");
      if (tokSnap && tokSnap.exists()) {
        const tokObj = tokSnap.val() || {};
        Object.keys(tokObj).forEach((tk) => {
          if (tokObj[tk]) tokens.push({ token: tk, uid });
        });
      }
    } catch (err) {
      console.warn("token-fetch error for uid", uid, err && err.message);
    }
  }
  return tokens;
}

async function sendNotificationsToTokens(tokensWithUid, payload) {
  if (!tokensWithUid || tokensWithUid.length === 0) return;

  const tokens = tokensWithUid.map((t) => t.token);
  try {
    const resp = await admin.messaging().sendMulticast({
      tokens,
      notification: payload.notification,
      data: payload.data || {},
      android: payload.android || undefined,
      webpush: payload.webpush || undefined,
      apns: payload.apns || undefined,
    });

    // remove invalid tokens
    const responses = resp.responses || [];
    const bads = [];
    for (let i = 0; i < responses.length; i++) {
      if (!responses[i].success) {
        const err = responses[i].error;
        const entry = tokensWithUid[i];
        if (err && (err.code === "messaging/invalid-registration-token" || err.code === "messaging/registration-token-not-registered")) {
          // schedule removal
          bads.push(entry);
        }
      }
    }
    // cleanup invalid tokens in DB
    for (const bad of bads) {
      try {
        await admin.database().ref(`fcmTokens/${bad.uid}/${bad.token}`).remove();
      } catch (e) {
        console.warn("failed to remove bad token", bad.token, e && e.message);
      }
    }
  } catch (err) {
    console.error("sendMulticast error", err && err.message, err);
  }
}

async function processMessageNotification(message, chatId) {
  if (!message) return null;
  if (!chatId && message.chatId) chatId = message.chatId;
  if (!chatId) {
    // cannot route notification without chatId
    console.warn("No chatId for message, skipping notification", { message });
    return null;
  }

  const senderId = message.senderId || null;
  const senderName = message.senderUsername || message.senderName || "Someone";
  const text = message.message || message.text || "";

  // Build notification payload
  const notification = {
    title: senderName,
    body: text ? (text.length > 120 ? text.slice(0, 117) + "..." : text) : "New message",
  };

  const data = {
    // app should know to open this URL to show the chat
    url: `/chat/${chatId}`,
    chatId: String(chatId),
  };

  // gather tokens for recipients (exclude sender)
  const tokensWithUid = await getAllRecipientTokens(chatId, senderId);
  if (!tokensWithUid || tokensWithUid.length === 0) {
    // nothing to send
    return null;
  }

  // Send the notifications
  await sendNotificationsToTokens(tokensWithUid, { notification, data });

  return null;
}

// 1) main trigger for nested messages: /messages/{chatId}/{messageId}
exports.sendMessageNotificationsNested = functions.database
  .ref("/messages/{chatId}/{messageId}")
  .onCreate(async (snap, context) => {
    try {
      const message = snap.val();
      const chatId = context.params.chatId;
      return await processMessageNotification(message, chatId);
    } catch (err) {
      console.error("sendMessageNotificationsNested error", err && err.message, err);
      return null;
    }
  });

// 2) secondary trigger for flat messages: /messages/{messageId}
//    This will process messages that have a chatId property.
//    It avoids duplicate sending by checking for chatId presence and returning early if absent.
exports.sendMessageNotificationsFlat = functions.database
  .ref("/messages/{messageId}")
  .onCreate(async (snap, context) => {
    try {
      const message = snap.val();
      // only process if message carries chatId (flat DB shape)
      if (message && message.chatId) {
        return await processMessageNotification(message, message.chatId);
      }
      // else, nothing to do in this trigger
      return null;
    } catch (err) {
      console.error("sendMessageNotificationsFlat error", err && err.message, err);
      return null;
    }
  });
