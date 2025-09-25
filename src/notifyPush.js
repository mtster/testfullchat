// src/notifyPush.js
import { rtdb } from "./firebase";
import { ref, get } from "firebase/database";

/**
 * Pipedream webhook target - paste provided URL here
 */
const PIPEDREAM_WEBHOOK_URL = "https://eokc3egoifuzx5y.m.pipedream.net";

/**
 * A best-effort non-blocking notify function.
 * - chatId: id of chat
 * - message: message object (should include text and senderName)
 * - senderId: uid of sender
 */
export async function notifyChatRecipients(chatId, message, senderId) {
  try {
    if (!chatId || !message) return;
    // Try participants node first
    const participantsRef = ref(rtdb, `chats/${chatId}/participants`);
    let snap = await get(participantsRef);
    let participantIds = [];
    if (snap && snap.exists()) {
      const val = snap.val();
      if (Array.isArray(val)) participantIds = val.map(String).filter(Boolean);
      else if (typeof val === "object") participantIds = Object.values(val).map(String).filter(Boolean);
    }

    // fallback: scan common message paths to infer participant ids
    if (!participantIds.length) {
      const POSSIBLE_MESSAGE_PATHS = [
        (id) => `messages/${id}`,
        (id) => `chatMessages/${id}`,
        (id) => `chats/${id}/messages`,
        (id) => `rooms/${id}/messages`
      ];
      const idsSet = new Set();
      for (const fn of POSSIBLE_MESSAGE_PATHS) {
        const p = fn(chatId);
        try {
          const s = await get(ref(rtdb, p));
          if (s && s.exists()) {
            const val = s.val();
            if (typeof val === 'object') {
              Object.values(val).forEach(m => {
                if (m && m.senderId) idsSet.add(String(m.senderId));
              });
            }
          }
        } catch (e) {}
      }
      participantIds = Array.from(idsSet);
    }

    // dedupe and remove sender
    participantIds = participantIds.map(String).filter(id => id !== String(senderId));
    if (!participantIds.length) return;

    const title = message.senderName ? String(message.senderName) : "New message";
    const body = message.text ? String(message.text) : (message.message ? String(message.message) : "You have a new message");
    const data = { chatId, message };

    // send to each participant if they have a pushSubscription
    participantIds.forEach(async (uid) => {
      try {
        const subSnap = await get(ref(rtdb, `users/${uid}/pushSubscription`));
        if (!subSnap || !subSnap.exists()) return;
        const subscription = subSnap.val();
        // fire-and-forget POST to pipedream
        try {
          fetch(PIPEDREAM_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscription,
              title,
              body,
              url: `/?/chat/${chatId}`,
              data
            })
          }).catch((e) => {
            console.warn('[notifyChatRecipients] pipedream send failed', e);
          });
        } catch (e) {}
      } catch (e) {}
    });
  } catch (e) {
    console.warn('[notifyChatRecipients] unexpected', e);
  }
}

export default notifyChatRecipients;
