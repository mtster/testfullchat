// src/components/ChatList.js
import { rtdb } from "../firebase";
import React, { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useNavigate, Link } from "react-router-dom";
import { ref, onValue, get } from "firebase/database";
import NewChatModal from "./NewChatModal";
import ChatItem from "./ChatItem";

export default function ChatList() {
  const { user, logout } = useAuth();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewChat, setShowNewChat] = useState(false);

  // use the already-initialized rtdb instance
  const rdb = rtdb;

  useEffect(() => {
    if (!user) {
      setChats([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const userChatsRef = ref(rdb, `userChats/${user.id}`);
    const unsub = onValue(userChatsRef, async (snapshot) => {
      const val = snapshot.val() || {};
      const chatIds = Object.keys(val || {});
      // fetch chat details in parallel
      const chatPromises = chatIds.map(async (cid) => {
        const chatSnap = await get(ref(rdb, `chats/${cid}`));
        return chatSnap.exists() ? { id: cid, ...chatSnap.val() } : null;
      });
      const chatResults = (await Promise.all(chatPromises)).filter(Boolean);
      setChats(chatResults);
      setLoading(false);
    });
    return () => unsub();
  }, [user, rdb]);

  if (!user) return null;

  return (
    <div style={{ maxWidth: 1000, margin: "12px auto", padding: 12 }}>
      {/* Top bar - only here */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <strong>FRBS Chat</strong>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 14, opacity: 0.9 }}>Signed in as <strong>{user.username}</strong></div>
          <button className="btn" onClick={() => setShowNewChat(true)}>New chat</button>
          <button className="btn secondary" onClick={() => { logout(); }}>Logout</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ width: 300 }}>
          {loading ? (
            <div>Loading chats...</div>
          ) : (
            <div className="chat-list">
              {chats.map((c) => (
                <Link key={c.id} to={`/chats/${c.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <ChatItem chat={c} />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }}>
          {/* main chat view will render via router */}
        </div>
      </div>

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
    </div>
  );
}
