// src/notifyOneSignal.js
// Minimal OneSignal notification helper for client-side push.
// WARNING: If you place your OneSignal REST API key in client code it will be publicly visible.
// Prefer a server-side call if you can later.

import { get, child, ref as dbRef } from "firebase/database";
import { rtdb } from "./firebase";

/**
 * CONFIG - edit only the REST API key if you must put it client-side.
 * Put your OneSignal REST API KEY in the ONESIGNAL_REST_API_KEY constant below.
 */
const ONESIGNAL_APP_ID = "065caa62-cfe3-4bcf-ac90-2fdf30c168d7"; // your OneSignal App ID
const ONESIGNAL_REST_API_KEY = "os_v2_app_azokuywp4nf47leqf7ptbqli26dxlfmbjiiecdvqvrc62vctjnia6o5fvgi5aa6ihkjep4u7q4mjk3ota5sayijzac2kh3v3alw6ody"; // <<< PUT REST KEY HERE

async function sendNotificationToPlayerIds(playerIds = [], title = "", body = "", data = {}) {
  if (!playerIds || playerIds.length === 0) return { ok: false, reason: "no player ids" };
  if (!ONESIGNAL_REST_API_KEY || ONESIGNAL_REST_API_KEY.indexOf("<PUT_") === 0) {
    console.warn("OneSignal REST API key not set. Set ONESIGNAL_REST_API_KEY in src/notifyOneSignal.js");
    return { ok: false, reason: "no-rest-key" };
  }
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_player_ids: playerIds,
    headings: { en: title || "" },
    contents: { en: body || "" },
    data: data || {},
    // optional: large_icon, small_icon, url, etc.
  };

  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) {
      console.warn("OneSignal send error", res.status, json);
      return { ok: false, reason: json };
    }
    return { ok: true, result: json };
  } catch (err) {
    console.warn("OneSignal send failed", err);
    return { ok: false, reason: err.toString() };
  }
}

/**
 * Attempt to resolve chat participants' user IDs for common RTDB layouts.
 * This tries a few common locations:
 * - chats/{chatId}/members  (object or array)
 * - chat/{chatId}/members
 * - rooms/{chatId}/members
 * - chats/{chatId}/participants
 * - chatMeta/{chatId}/members
 *
 * If those aren't found, it will try to inspect the messages path for distinct senders.
 *
 * Returns: array of user ids (strings). Excludes the authorId passed as `excludeUserId`.
 */
async function findChatParticipantUserIds(chatId, messagesPathCandidates = [], excludeUserId = null) {
  const db = rtdb;
  const tries = [
    `chats/${chatId}/members`,
    `chat/${chatId}/members`,
    `rooms/${chatId}/members`,
    `chats/${chatId}/participants`,
    `chatMeta/${chatId}/members`,
    `chatMeta/${chatId}/participants`,
    `chatInfo/${chatId}/members`
  ];

  for (const p of tries) {
    try {
      const snap = await get(dbRef(db, p));
      if (snap && snap.exists()) {
        let val = snap.val();
        // members could be object {uid:true} or array or list of ids
        let ids = [];
        if (Array.isArray(val)) {
          ids = val.filter(Boolean).map(String);
        } else if (typeof val === "object" && val !== null) {
          // if object values are true/1, keys are uids; or values might be objects with id property
          ids = Object.keys(val);
          // if the values are like {id: 'uid'} try to extract
          if (ids.length === 0) {
            const alt = Object.values(val).map(v => (v && v.id) ? v.id : null).filter(Boolean);
            if (alt.length) ids = alt;
          }
        } else if (typeof val === "string") {
          ids = [val];
        }
        ids = ids.map(String).filter(Boolean);
        if (excludeUserId) ids = ids.filter(id => id !== String(excludeUserId));
        if (ids.length) return ids;
      }
    } catch (e) {
      // ignore try errors
    }
  }

  // fallback: check messages to find senders
  for (const msgPathFactory of messagesPathCandidates) {
    try {
      const p = typeof msgPathFactory === "function" ? msgPathFactory(chatId) : msgPathFactory;
      const snap = await get(dbRef(db, p));
      if (snap && snap.exists()) {
        const msgs = snap.val();
        const idsSet = new Set();
        Object.values(msgs).forEach(m => {
          if (m && (m.senderId || m.userId || m.from)) {
            idsSet.add(String(m.senderId || m.userId || m.from));
          }
        });
        if (excludeUserId) idsSet.delete(String(excludeUserId));
        if (idsSet.size) return Array.from(idsSet);
      }
    } catch (e) {}
  }

  return [];
}

/**
 * Public helper:
 * - given chatId and a message object and the currentUserId, notify other chat participant devices.
 * - message should be an object { text, senderName?, ... } (we will create a short body).
 */
export async function notifyChatRecipients(chatId, message = {}, currentUserId = null) {
  // these are the common message path constructors your app might use; if your app uses different
  // paths you can add them here.
  const messagesPathCandidates = [
    (id) => `messages/${id}`,
    (id) => `chatMessages/${id}`,
    (id) => `messages/${id}/messages`, // sometimes nested
    (id) => `rooms/${id}/messages`,
  ];

  // 1) find participant user ids (excluding sender)
  const participantUserIds = await findChatParticipantUserIds(chatId, messagesPathCandidates, currentUserId);
  if (!participantUserIds.length) {
    return { ok: false, reason: "no-participants" };
  }

  // 2) for each participant, read users/{uid}/playerId
  const db = rtdb;
  const playerIds = [];
  for (const uid of participantUserIds) {
    try {
      const snap = await get(child(dbRef(db), `users/${uid}/playerId`));
      if (snap && snap.exists()) {
        const pid = snap.val();
        if (pid) playerIds.push(String(pid));
      }
    } catch (e) {
      // ignore
    }
  }

  if (!playerIds.length) return { ok: false, reason: "no-player-ids" };

  // Create title/body from message
  let title = "New message";
  let body = "";
  if (message.senderName) title = `${message.senderName}`;
  if (message.text) body = message.text;
  else if (message.preview) body = message.preview;
  else body = "You have a new message";

  // Add custom data so the app could open direct chat if needed (client can handle)
  const data = { chatId, message: message };

  // 3) send via OneSignal
  const result = await sendNotificationToPlayerIds(playerIds, title, body, data);
  return result;
}

// export low-level send for direct usage if needed
export { sendNotificationToPlayerIds };
