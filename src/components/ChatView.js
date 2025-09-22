// src/components/ChatView.js
import { rtdb } from "../firebase";
import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { ref, onValue, push, set, get } from "firebase/database";

const POSSIBLE_MESSAGE_PATHS = [
  (chatId) => `messages/${chatId}`,
  (chatId) => `chatMessages/${chatId}`,
  (chatId) => `chats/${chatId}/messages`,
  (chatId) => `messagesByChat/${chatId}`,
  (chatId) => `chats/${chatId}/messagesById`
];

export default function ChatView() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [chat, setChat] = useState(null);
  const [text, setText] = useState("");
  const listRef = useRef(null);

  // use the already-initialized rtdb instance
  const rdb = rtdb;

  useEffect(() => {
    if (!chatId || !user) return;
    let activeUnsub = null;
    // try different possible message paths
    async function findMessagesPath() {
      for (const pFn of POSSIBLE_MESSAGE_PATHS) {
        const p = pFn(chatId);
        const snap = await get(ref(rdb, p));
        if (snap && snap.exists()) {
          return p;
        }
      }
      // fallback to messages/chatId
      return `messages/${chatId}`;
    }

    let mounted = true;
    (async () => {
      const chatRef = ref(rdb, `chats/${chatId}`);
      const chatSnap = await get(chatRef);
      if (!chatSnap || !chatSnap.exists()) {
        if (mounted) {
          setChat(null);
          navigate("/");
        }
        return;
      }
      setChat({ id: chatId, ...chatSnap.val() });

      const messagesRefPath = await findMessagesPath();
      // subscribe
      activeUnsub = onValue(ref(rdb, messagesRefPath), (mSnap) => {
        const val = mSnap.val() || {};
        // convert to array
        const arr = Object.entries(val).map(([id, v]) => ({ id, ...v }));
        // sort by timestamp if present
        arr.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        setMessages(arr);
        // scroll to bottom
        setTimeout(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
        }, 50);
      });
    })();

    return () => {
      mounted = false;
      if (activeUnsub) activeUnsub();
    };
  }, [chatId, user, rdb, navigate]);

  async function sendMessage(e) {
    e && e.preventDefault();
    if (!text || !text.trim() || !chatId || !user) return;
    const txt = text.trim();
    setText("");
    try {
      // choose path used earlier; simplest: push to messages/<chatId>
      const messagesRefPath = `messages/${chatId}`;
      const newMsgRef = push(ref(rdb, messagesRefPath));
      await set(newMsgRef, {
        senderId: user.id,
        message: txt,
        timestamp: Date.now(),
      });
      // update some chat meta if you have lastMessage fields
      await set(ref(rdb, `chats/${chatId}/lastMessage`), txt).catch(()=>{});
      await set(ref(rdb, `chats/${chatId}/lastMessageAt`), Date.now()).catch(()=>{});
    } catch (err) {
      console.error("sendMessage error", err);
    }
  }

  if (!user) return null;
  if (!chat) return <div style={{ padding: 12 }}>Select a chat</div>;

  return (
    <div style={{ padding: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>{chat.name || `Chat ${chat.id}`}</strong>
      </div>

      <div ref={listRef} style={{ maxHeight: 400, overflow: "auto", border: "1px solid #eee", padding: 8, marginBottom: 8 }}>
        {messages.map((m) => {
          const mine = m.senderId === user.id;
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 6 }}>
              <div style={{ maxWidth: "70%", background: mine ? "#dcf8c6" : "#fff", padding: 8, borderRadius: 6, boxShadow: "0 0 0 1px rgba(0,0,0,0.03)" }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>{m.message}</div>
                <div style={{ fontSize: 10, opacity: 0.6 }}>{new Date(m.timestamp || Date.now()).toLocaleString()}</div>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={sendMessage} style={{ display: "flex", gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" />
        <button className="btn" type="submit">Send</button>
      </form>
    </div>
  );
}
