// src/components/ChatView.js
import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { rtdb } from "../firebase";
import { ref, onValue, push, set, get, onDisconnect } from "firebase/database";
import "../index.css";

/* message path: messages/{chatId}/{messageId} */
export default function ChatView() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesPath, setMessagesPath] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const listRef = useRef();

  useEffect(() => {
    let mounted = true;
    let unsubMessages = null;
    let chatRef = null;
    let activeRef = null;
    let disconnectActive = null;

    async function setup() {
      if (!chatId) return;
      try {
        // load chat metadata
        chatRef = ref(rtdb, `chats/${chatId}`);
        const chatSnap = await get(chatRef);
        const chatVal = chatSnap && chatSnap.exists() ? chatSnap.val() : null;
        if (!mounted) return;
        setChat({ id: chatId, ...(chatVal || {}) });

        // ensure messages path is messages/{chatId}
        const path = `messages/${chatId}`;
        setMessagesPath(path);

        // attach messages listener
        unsubMessages = onValue(ref(rtdb, path), (snap) => {
          const val = snap.val() || {};
          const arr = Object.entries(val).map(([id, v]) => ({ id, ...(v || {}) }));
          arr.sort((a,b)=> (a.timestamp||0)-(b.timestamp||0));
          setMessages(arr);
          setTimeout(()=> {
            if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
          }, 50);
        }, (listenErr) => {
          console.error("failed to attach message listener", listenErr);
          setError("Failed to subscribe to messages");
        });

        // mark this chat as active for this user so Cloud Function can skip notifications when chat is open
        if (user && user.id) {
          activeRef = ref(rtdb, `users/${user.id}/activeChat`);
          await set(activeRef, chatId);
          disconnectActive = onDisconnect(activeRef);
          try { await disconnectActive.set(null); } catch (err) { /* best-effort */ }
        }
      } catch (err) {
        console.error("ChatView setup error", err);
        setError("Unable to load chat");
      }
    }

    setup();

    return () => {
      mounted = false;
      try { if (unsubMessages) unsubMessages(); } catch(_) {}
      try { if (chatRef) {/* nothing */} } catch(_) {}
      // clear activeChat
      (async ()=> {
        try {
          if (user && user.id) {
            await set(ref(rtdb, `users/${user.id}/activeChat`), null);
          }
        } catch (e) {}
      })();
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
      // try to obtain a senderNotificationId (one of sender's tokens) so recipients may use it (optional)
      let senderNotificationId = null;
      try {
        const fcmSnap = await get(ref(rtdb, `users/${user.id}/fcmTokens`));
        if (fcmSnap && fcmSnap.exists()) {
          const tokens = Object.keys(fcmSnap.val() || {});
          if (tokens.length > 0) senderNotificationId = tokens[0];
        }
      } catch (e) {}

      const newRef = push(ref(rtdb, pathToUse));
      await set(newRef, {
        chatId,
        chatName: (chat && chat.name) ? chat.name : null,
        senderId: user.id,
        senderUsername: user.username || null,
        senderNotificationId: senderNotificationId || null,
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontWeight: 700 }}>{chat.name || `Chat ${chat.id}`}</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {chat.participantUsernames ? (Array.isArray(chat.participantUsernames) ? chat.participantUsernames.join(", ") : chat.participantUsernames) : ""}
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
        />
        <button className="btn" type="submit">Send</button>
      </form>
    </div>
  );
}
