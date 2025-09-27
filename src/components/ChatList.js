// src/components/ChatList.js
import React, { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { Link, useNavigate } from "react-router-dom";
import { rtdb } from "../firebase";
import { ref, onValue, get } from "firebase/database";
import NewChatModal from "./NewChatModal";
import ChatItem from "./ChatItem";
import "../index.css";

export default function ChatList() {
  const { user, logout } = useAuth();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewChat, setShowNewChat] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // inside useEffect in ChatList.js
if (!user || !user.id) {
  setChats([]);
  setLoading(false);
  return;
}

    setLoading(true);
    const userChatsRef = ref(rtdb, `userChats/${user.id}`);

    const unsub = onValue(userChatsRef, async (snapshot) => {
      const val = snapshot.val() || {};
      const chatIds = Object.keys(val || {});
      try {
        const chatPromises = chatIds.map(async (cid) => {
          const snap = await get(ref(rtdb, `chats/${cid}`));
          if (!snap || !snap.exists()) return null;
          return { id: cid, ...snap.val() };
        });
        const results = (await Promise.all(chatPromises)).filter(Boolean);
        results.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
        setChats(results);
      } catch (err) {
        console.error("ChatList: error fetching chats", err);
        setChats([]);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      try { unsub(); } catch (e) {}
    };
  }, [user]);

  if (!user) return null;

  return (
    <div className="app-wrap">
      <div className="topbar">
        <div className="app-title">
          <img src="/icon-192.png" alt="Protocol" style={{ width: 36, height: 36, borderRadius: 8 }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 18 }}>Protocol</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Private. Light. Fast.</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn" onClick={() => setShowNewChat(true)}>New chat</button>
          <button className="btn logout" onClick={() => { logout(); navigate("/login"); }}>Logout</button>
        </div>
      </div>

      <div className="layout" style={{ marginTop: 12 }}>
        <aside className="sidebar">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Chats</div>
            <div style={{ color: "var(--muted)" }}>{user.username}</div>
          </div>

          <div className="chat-list">
            {loading ? (
              <div style={{ padding: 12, color: "var(--muted)" }}>Loading chats…</div>
            ) : (
              <>
                {chats.length === 0 && <div style={{ padding: 12, color: "var(--muted)" }}>No chats yet</div>}
                {chats.map((c) => (
                  <Link key={c.id} to={`/chats/${c.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <ChatItem chat={c} />
                  </Link>
                ))}
              </>
            )}
          </div>
        </aside>

        <main className="panel" style={{ minHeight: 420 }}>
          {/* main chat view is displayed by router */}
          <div style={{ color: "var(--muted)" }}>
            Open or create a chat to start messaging.
          </div>
        </main>
      </div>

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
    </div>
  );
}
