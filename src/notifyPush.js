// src/notifyPush.js
// Notification helper that posts a payload to a Pipedream webhook which sends Web Push via web-push.
// Replace PIPEDREAM_WEBHOOK_URL with your Pipedream workflow HTTP endpoint.

import { get, ref as dbRef } from "firebase/database";
import { rtdb } from "./firebase";

/**
 * Configuration - replace with your Pipedream webhook URL
 * Example: const PIPEDREAM_WEBHOOK_URL = "https://eo8x....m.pipedream.net";
 */
const PIPEDREAM_WEBHOOK_URL = "REPLACE_WITH_PIPEDREAM_WEBHOOK_URL";

/**
 * Try to gather participant user IDs for a chat.
 * First attempts chats/{chatId}/participants, then falls back to scanning message senders.
 */
async function getParticipantUserIds(chatId, excludeUserId = null) {
  try {
    // Try explicit participants array
    const chatSnap = await get(dbRef(rtdb, `chats/${chatId}/participants`));
    if (chatSnap && chatSnap.exists()) {
      let arr = chatSnap.val();
      if (Array.isArray(arr)) {
        const out = arr.map(String).filter((id) => id && id !== String(excludeUserId));
        return out;
      }
    }
  } catch (e) {
    // ignore
  }

  // Fallback: scan common message paths for sender ids
  const PATH_CANDIDATES = [
    (id) => `messages/${id}`,
    (id) => `chatMessages/${id}`,
    (id) => `chats/${id}/messages`,
  ];

  const ids = new Set();
  for (const fn of PATH_CANDIDATES) {
    try {
      const snap = await get(dbRef(rtdb, fn(chatId)));
      if (snap && snap.exists()) {
        const v = snap.val();
        if (v && typeof v === "object") {
          Object.keys(v).forEach((k) => {
            const m = v[k];
            if (m) {
              if (m.senderId) ids.add(String(m.senderId));
              if (m.userId) ids.add(String(m.userId));
              if (m.from) ids.add(String(m.from));
              if (m.sender) ids.add(String(m.sender));
            }
          });
        }
      }
    } catch (e) {}
  }

  if (excludeUserId) ids.delete(String(excludeUserId));
  return Array.from(ids);
}

/**
 * Send a POST to Pipedream webhook for each subscription found for participants.
 * @param {*} chatId
 * @param {*} message - message object { text, senderName, ... }
 * @param {*} currentUserId - sender id to exclude
 */
export async function notifyChatRecipients(chatId, message = {}, currentUserId = null) {
  if (!PIPEDREAM_WEBHOOK_URL || PIPEDREAM_WEBHOOK_URL.startsWith("REPLACE_")) {
    console.warn("[notifyPush] PIPEDREAM_WEBHOOK_URL not configured; skipping push send.");
    return { ok: false, reason: "no-webhook" };
  }

  const participantIds = await getParticipantUserIds(chatId, currentUserId);
  if (!participantIds || participantIds.length === 0) {
    console.log("[notifyPush] no participants found for chat", chatId);
    return { ok: false, reason: "no-participants" };
  }

  // For each participant, fetch /users/{uid}/pushSubscription
  const results = [];
  for (const uid of participantIds) {
    try {
      const subSnap = await get(dbRef(rtdb, `users/${uid}/pushSubscription`));
      if (!subSnap || !subSnap.exists()) {
        results.push({ uid, ok: false, reason: "no-subscription" });
        continue;
      }
      const subscription = subSnap.val();

      const title = message.senderName ? String(message.senderName) : "New message";
      const body = message.text ? String(message.text).slice(0, 140) : "You have a new message";
      const payload = {
        subscription,
        title,
        body,
        url: message.url || "/",
        data: { chatId, message },
      };

      // POST to pipedream webhook
      try {
        const res = await fetch(PIPEDREAM_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          results.push({ uid, ok: true });
        } else {
          const txt = await res.text().catch(() => "");
          results.push({ uid, ok: false, status: res.status, text: txt });
        }
      } catch (e) {
        results.push({ uid, ok: false, error: String(e) });
      }
    } catch (e) {
      results.push({ uid, ok: false, error: String(e) });
    }
  }

  return results;
}

export default notifyChatRecipients;
