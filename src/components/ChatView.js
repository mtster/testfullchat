// src/components/ChatView.js
import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { rtdb } from "../firebase";
import { ref, onValue, push, set, get } from "firebase/database";
import "../index.css";

import { notifyChatRecipients } from "../notifyPush";

/**
 * Message path heuristics (will pick the first existing path)
 */
const POSSIBLE_MESSAGE_PATHS = [
  (chatId) => `messages/${chatId}`,
  (chatId) => `chatMessages/${chatId}`,
  (chatId) => `chats/${chatId}/messages`,
  (chatId) => `rooms/${chatId}/messages`
];

export default function ChatView() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [chatMeta, setChatMeta] = useState({ name: '' });
  const messagesRefRef = useRef(null);

  useEffect(() => {
    let unsub = () => {};
    let canceled = false;

    async function findAndListen() {
      if (!chatId) return;
      // try to find a messages path that exists; prefer first that exists, else use default messages/{chatId}
      let chosenPath = null;
      for (const fn of POSSIBLE_MESSAGE_PATHS) {
        try {
          const p = fn(chatId);
          const snap = await get(ref(rtdb, p));
          if (snap && snap.exists()) {
            chosenPath = p;
            break;
          }
        } catch (e) {}
      }
      if (!chosenPath) chosenPath = POSSIBLE_MESSAGE_PATHS[0](chatId);

      messagesRefRef.current = ref(rtdb, chosenPath);
      onValue(messagesRefRef.current, (snapshot) => {
        if (canceled) return;
        const val = snapshot.val() || {};
        const arr = Object.keys(val).map(k => {
          const item = val[k];
          return { id: k, ...item };
        }).sort((a,b)=> (a.timestamp||0)-(b.timestamp||0));
        setMessages(arr);
      });

      // also try to load chat meta if present at chats/{chatId}
      try {
        const metaSnap = await get(ref(rtdb, `chats/${chatId}`));
        if (metaSnap && metaSnap.exists()) {
          setChatMeta(metaSnap.val());
        }
      } catch (e) {}
    }

    findAndListen();

    return () => {
      canceled = true;
      try { if (messagesRefRef.current) messagesRefRef.current.off; } catch(e){}
      unsub();
    };
  }, [chatId]);

  async function sendMessage(e) {
    e.preventDefault();
    if (!text || !text.trim()) return;
    const msg = {
      chatId,
      senderId: user?.id || "anon",
      senderName: user?.username || "Anonymous",
      text: String(text).trim(),
      timestamp: Date.now()
    };

    // determine where to write: try common paths in same order as listener
    let writePath = null;
    for (const fn of POSSIBLE_MESSAGE_PATHS) {
      const p = fn(chatId);
      try {
        const snap = await get(ref(rtdb, p));
        if (snap && snap.exists()) {
          writePath = p;
          break;
        }
      } catch (e) {}
    }
    if (!writePath) writePath = POSSIBLE_MESSAGE_PATHS[0](chatId);

    try {
      await push(ref(rtdb, writePath), msg);
      // Fire-and-forget notify; do not await or block UI
      try {
        notifyChatRecipients(chatId, msg, msg.senderId);
      } catch (e) {}
    } catch (e) {
      console.error("sendMessage failed", e);
    } finally {
      setText("");
    }
  }

  return (
    <div className="chat-view" style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button className="btn" onClick={() => navigate(-1)}>Back</button>
        <div style={{ fontWeight: 700 }}>{chatMeta.name || `Chat ${chatId}`}</div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="messages">
          {messages.map(m => (
            <div key={m.id} className={"message " + (m.senderId === (user && user.id) ? "me" : "them")}>
              <div className="message-sender">{m.senderName || m.senderId}</div>
              <div className="message-text">{m.text || m.message}</div>
              <div className="message-time" style={{ fontSize: 11, color: "var(--muted)" }}>
                {m.timestamp ? new Date(m.timestamp).toLocaleString() : ""}
              </div>
            </div>
          ))}
          {messages.length === 0 && <div style={{ color: "var(--muted)", padding: 12 }}>No messages yet</div>}
        </div>
      </div>

      <form onSubmit={sendMessage} className="message-input-wrap" style={{ alignItems: "center" }}>
        <input
          className="message-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Type a message"
        />
        <button className="btn" type="submit">Send</button>
      </form>
    </div>
  );
}
