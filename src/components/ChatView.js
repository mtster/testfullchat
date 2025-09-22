// src/components/ChatView.js
import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { rtdb } from "../firebase";
import { ref, onValue, push, set, get } from "firebase/database";
import "../index.css";

/* same message path heuristics you had before */
const POSSIBLE_MESSAGE_PATHS = [
  (chatId) => `messages/${chatId}`,
  (chatId) => `chatMessages/${chatId}`,
  (chatId) => `chats/${chatId}/messages`,
  (chatId) => `messagesByChat/${chatId}`,
  (chatId) => `chats/${chatId}/messagesById`,
];

export default function ChatView() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [messages, setMessages] = useState([]);
  const [chat, setChat] = useState(null);
  const [text, setText] = useState("");
  const [messagesPath, setMessagesPath] = useState(null);
  const [error, setError] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!chatId || !user) return;
    let unsubMessages = null;
    let unsubChat = null;
    let mounted = true;

    async function findAndSubscribe() {
      try {
        const chatRef = ref(rtdb, `chats/${chatId}`);
        unsubChat = onValue(chatRef, (snap) => {
          if (!snap || !snap.exists()) {
            setChat(null);
            navigate("/", { replace: true });
            return;
          }
          if (mounted) setChat({ id: chatId, ...(snap.val() || {}) });
        });

        // find a message path that exists
        let found = null;
        for (const fn of POSSIBLE_MESSAGE_PATHS) {
          const candidate = fn(chatId);
          const snap = await get(ref(rtdb, candidate));
          if (snap && snap.exists()) {
            found = candidate;
            break;
          }
        }
        if (!found) found = `messages/${chatId}`;
        if (!mounted) return;
        setMessagesPath(found);

        unsubMessages = onValue(ref(rtdb, found), (snap) => {
          const val = snap.val() || {};
          const arr = Object.entries(val).map(([id, v]) => ({ id, ...(v || {}) }));
          arr.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          setMessages(arr);
          setTimeout(() => {
            if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
          }, 70);
        }, (listenErr) => {
          console.error("failed to attach message listener", listenErr);
          setError("Failed to subscribe to messages");
        });
      } catch (err) {
        console.error("ChatView setup error", err);
        setError("Unable to load chat");
      }
    }

    findAndSubscribe();

    return () => {
      mounted = false;
      try { if (typeof unsubMessages === "function") unsubMessages(); } catch(_) {}
      try { if (typeof unsubChat === "function") unsubChat(); } catch(_) {}
    };
  }, [chatId, user, navigate]);

  async function sendMessage(e) {
    if (e && e.preventDefault) e.preventDefault();
    setError(null);
    if (!text || !text.trim() || !chatId || !user) return;
    const txt = text.trim();
    setText("");
    try {
      const pathToUse = messagesPath || `messages/${chatId}`;
      const newRef = push(ref(rtdb, pathToUse));
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
        <button className="chat-back" onClick={() => navigate(-1)} aria-label="Go back">
          {/* simple back chevron (SVG) */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontWeight: 700 }}>{chat.name || `Chat ${chat.id}`}</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {chat.participantUsernames ? chat.participantUsernames.join(", ") : ""}
          </div>
        </div>

        <div style={{ marginLeft: "auto", color: "var(--muted)" }}>
          {error && <span style={{ color: "salmon" }}>{error}</span>}
        </div>
      </div>

      <div ref={listRef} className="messages">
        {messages.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No messages yet — say hello!</div>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === user.id;
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                <div className={`message ${mine ? "me" : "other"}`}>
                  <div style={{ fontSize: 14 }}>{m.message}</div>
                  <div className="meta">
                    {m.senderUsername ? `${m.senderUsername} • ` : ""}
                    {m.timestamp ? new Date(m.timestamp).toLocaleString() : ""}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={sendMessage} className="message-input-wrap" style={{ alignItems: "center" }}>
        <input
          className="message-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Type a message"
          /* intentionally no placeholder to match your requirement */
        />
        <button className="btn" type="submit">Send</button>
      </form>
    </div>
  );
}
