// src/notifyOneSignal.js
// Minimal OneSignal notification helper for client-side push.
// WARNING: placing the OneSignal REST API key in client-side JS is insecure (visible to anyone).

import { get, child, ref as dbRef } from "firebase/database";
import { rtdb } from "./firebase";

/** CONFIGURE THESE **/
const ONESIGNAL_APP_ID = "065caa62-cfe3-4bcf-ac90-2fdf30c168d7"; // your OneSignal App ID
const ONESIGNAL_REST_API_KEY = "os_v2_app_azokuywp4nf47leqf7ptbqli26dxlfmbjiiecdvqvrc62vctjnia6o5fvgi5aa6ihkjep4u7q4mjk3ota5sayijzac2kh3v3alw6ody"; // <<< PUT YOUR REST KEY HERE

async function sendNotificationToPlayerIds(playerIds = [], title = "", body = "", data = {}) {
  if (!playerIds || playerIds.length === 0) {
    console.warn("[notifyOneSignal] no playerIds to send to");
    return { ok: false, reason: "no player ids" };
  }
  if (!ONESIGNAL_REST_API_KEY || ONESIGNAL_REST_API_KEY.indexOf("<PUT_") === 0) {
    console.warn("[notifyOneSignal] OneSignal REST API key not set. Set ONESIGNAL_REST_API_KEY in src/notifyOneSignal.js");
    return { ok: false, reason: "no-rest-key" };
  }

  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_player_ids: playerIds,
    headings: { en: title || "" },
    contents: { en: body || "" },
    data: data || {},
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
      console.warn("[notifyOneSignal] send error", res.status, json);
      return { ok: false, reason: json };
    }
    console.log("[notifyOneSignal] sent OK", json);
    return { ok: true, result: json };
  } catch (err) {
    console.warn("[notifyOneSignal] send failed", err);
    return { ok: false, reason: err.toString() };
  }
}

async function findChatParticipantUserIds(chatId, messagesPathCandidates = [], excludeUserId = null) {
  const db = rtdb;
  const tries = [
    `chats/${chatId}/members`,
    `chat/${chatId}/members`,
    `rooms/${chatId}/members`,
    `chats/${chatId}/participants`,
    `chatMeta/${chatId}/members`,
    `chatMeta/${chatId}/participants`,
    `chatInfo/${chatId}/members`,
  ];

  for (const p of tries) {
    try {
      const snap = await get(child(dbRef(db), p));
      if (snap && snap.exists()) {
        let val = snap.val();
        let ids = [];
        if (Array.isArray(val)) {
          ids = val.filter(Boolean).map(String);
        } else if (typeof val === "object" && val !== null) {
          ids = Object.keys(val);
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

  // fallback: check messages for sender ids
  for (const msgPathFactory of messagesPathCandidates) {
    try {
      const p = typeof msgPathFactory === "function" ? msgPathFactory(chatId) : msgPathFactory;
      const snap = await get(child(dbRef(db), p));
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

export async function notifyChatRecipients(chatId, message = {}, currentUserId = null) {
  const messagesPathCandidates = [
    (id) => `messages/${id}`,
    (id) => `chatMessages/${id}`,
    (id) => `messages/${id}/messages`,
    (id) => `rooms/${id}/messages`,
  ];

  const participantUserIds = await findChatParticipantUserIds(chatId, messagesPathCandidates, currentUserId);
  if (!participantUserIds.length) {
    console.log("[notifyOneSignal] no participants found for", chatId);
    return { ok: false, reason: "no-participants" };
  }

  const db = rtdb;
  const playerIds = [];
  for (const uid of participantUserIds) {
    try {
      const snap = await get(child(dbRef(db), `users/${uid}/playerId`));
      if (snap && snap.exists()) {
        const pid = snap.val();
        if (pid) playerIds.push(String(pid));
      }
    } catch (e) {}
  }

  if (!playerIds.length) {
    console.log("[notifyOneSignal] no playerIds for participants of", chatId, "uids:", participantUserIds);
    return { ok: false, reason: "no-player-ids" };
  }

  const title = message.senderName ? String(message.senderName) : "New message";
  const body = message.text ? String(message.text) : (message.preview ? String(message.preview) : "You have a new message");
  const data = { chatId, message };

  const result = await sendNotificationToPlayerIds(playerIds, title, body, data);
  return result;
}

export { sendNotificationToPlayerIds };
