// src/components/ChatView.js
import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { rtdb } from "../firebase";
import { ref, onValue, push, set, get } from "firebase/database";
import "../index.css";

// NOTIFICATION IMPORT (UPDATED)
import { notifyChatRecipients } from "../notifyPush";

/* same message path heuristics you had before */
const POSSIBLE_MESSAGE_PATHS = [
  (chatId) => `messages/${chatId}`,
  (chatId) => `chatMessages/${chatId}`,
  (chatId) => `chats/${chatId}/messages`,
  (chatId) => `rooms/${chatId}/messages`,
];

export default function ChatView() {
  const { chatId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const refScroll = useRef();

  useEffect(() => {
    if (!chatId) return;
    // Attempt various message paths
    let unsub;
    (async function subscribe() {
      for (const p of POSSIBLE_MESSAGE_PATHS) {
        try {
          const r = ref(rtdb, p(chatId));
          unsub = onValue(r, (snapshot) => {
            const val = snapshot.val() || {};
            const items = [];
            Object.keys(val).forEach((k) => items.push({ id: k, ...val[k] }));
            items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            setMessages(items);
          });
          // we set unsub reference; keep listening to first one that succeeds
          break;
        } catch (e) {
          // try next path
        }
      }
    })();

    // read chat meta if exists
    (async function() {
      try {
        const cRef = ref(rtdb, `chats/${chatId}`);
        const snap = await get(cRef);
        if (snap && snap.exists()) setChat(snap.val());
      } catch (e) {}
    })();

    return () => {
      try { if (unsub) unsub(); } catch(e) {}
    };
  }, [chatId]);

  async function sendMessage(e) {
    e.preventDefault();
    setError(null);
    if (!text || !text.trim()) return;
    const txt = text.trim();
    setText("");
    try {
      // try to find a place to write message (non-invasive)
      let newRef;
      for (const p of POSSIBLE_MESSAGE_PATHS) {
        try {
          const messagesRef = ref(rtdb, p(chatId));
          newRef = push(messagesRef);
          break;
        } catch (e) {
          // continue
        }
      }
      if (!newRef) throw new Error("No message path available");

      await set(newRef, {
        senderId: user.id,
        senderUsername: user.username || null,
        message: txt,
        timestamp: Date.now(),
      });
      // update chat metadata
      try {
        await set(ref(rtdb, `chats/${chatId}/lastMessage`), txt);
        await set(ref(rtdb, `chats/${chatId}/lastMessageAt`), Date.now());
      } catch (metaErr) {
        console.warn("Failed to update chat metadata", metaErr);
      }

      // NOTIFICATION: best-effort, non-blocking call to send push to other participants
      // This will not affect sending flow if it fails.
      try {
        notifyChatRecipients(
          chatId,
          { text: txt, senderName: user.username || user.id },
          user.id
        )
          .then((res) => console.log("[ChatView] notifyChatRecipients result:", res))
          .catch((err) => console.warn("notifyChatRecipients error:", err));
      } catch (notifyErr) {
        console.warn("notifyChatRecipients call failed:", notifyErr);
      }

    } catch (err) {
      console.error("sendMessage error:", err);
      setError("Failed to send message");
    }
  }

  if (!user) return null;
  if (!chat) return <div style={{ padding: 12 }}>Select a chat</div>;

  return (
    <div className="chat-view">
      <div className="chat-header">
        <h3>{chat.chatName || "Chat"}</h3>
      </div>

      <div className="messages" ref={refScroll}>
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.senderId === user.id ? "mine" : ""}`}>
            <div className="meta">
              <span className="sender">{m.senderUsername || m.senderId}</span>
              <span className="time">{m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ""}</span>
            </div>
            <div className="body">{m.message}</div>
          </div>
        ))}
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
