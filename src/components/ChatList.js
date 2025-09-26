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

  // helper - robust membership check for various DB shapes
  function isUserParticipant(chatObj = {}, userId, username) {
    if (!chatObj) return false;
    const participants = chatObj.participants;
    const participantUsernames = chatObj.participantUsernames || chatObj.participantUsernames || chatObj.participantUsername;

    // 1) participants as object mapping userId -> true/metadata
    if (participants && typeof participants === "object") {
      // check if userId appears as a key
      if (Object.prototype.hasOwnProperty.call(participants, userId)) return true;
      // otherwise check values - sometimes participants are stored as { pushId: userId } or { pushId: { id: userId } }
      const vals = Object.values(participants);
      for (const v of vals) {
        if (!v) continue;
        if (v === true) {
          // could be keyed by userId, we already checked keys
          continue;
        }
        // value might be userId string itself
        if (typeof v === "string" && v === userId) return true;
        // nested object with id or uid
        if (typeof v === "object") {
          if (v.id === userId || v.uid === userId || v.userId === userId) return true;
          // sometimes username is stored in participant node, check that too
          if (username && (v.username === username || v.displayName === username)) return true;
        }
      }
    }

    // 2) participantUsernames (array or object) - check username if available
    if (participantUsernames) {
      if (Array.isArray(participantUsernames)) {
        if (user && username && participantUsernames.includes(username)) return true;
      } else if (typeof participantUsernames === "object") {
        // object-style usernames
        if (user && username && Object.values(participantUsernames).includes(username)) return true;
      } else if (typeof participantUsernames === "string") {
        if (user && username && participantUsernames === username) return true;
      }
    }

    // 3) createdBy could be the user's id if single-person chat
    if (chatObj.createdBy && chatObj.createdBy === userId) return true;

    return false;
  }

  useEffect(() => {
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
        let results = [];

        if (chatIds.length > 0) {
          // primary flow: read chats listed in userChats
          const chatPromises = chatIds.map(async (cid) => {
            const snap = await get(ref(rtdb, `chats/${cid}`));
            if (!snap || !snap.exists()) return null;
            return { id: cid, ...snap.val() };
          });
          results = (await Promise.all(chatPromises)).filter(Boolean);
        } else {
          // fallback: query all chats and filter by participant membership
          const allSnap = await get(ref(rtdb, `chats`));
          if (allSnap && allSnap.exists()) {
            const all = allSnap.val();
            results = Object.keys(all || {}).map((cid) => ({ id: cid, ...(all[cid] || {}) }))
              .filter((c) => isUserParticipant(c, user.id, user.username || null));
          } else {
            results = [];
          }
        }

        // sort by lastMessageAt (descending)
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

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn" onClick={() => setShowNewChat(true)}>New Chat</button>
          <button className="btn secondary" onClick={() => { logout(); navigate("/"); }}>Logout</button>
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
                  <ChatItem key={c.id} chat={c} />
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
