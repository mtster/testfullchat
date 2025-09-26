// src/components/ChatList.js
import React, { useEffect, useState } from "react";
import { rtdb } from "../firebase";
import { ref, onValue, get } from "firebase/database";
import ChatItem from "./ChatItem";
import NewChatModal from "./NewChatModal";
import { useAuth } from "./AuthProvider";

export default function ChatList() {
  const { user, logout } = useAuth();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbUserId, setDbUserId] = useState(null);
  const [showNew, setShowNew] = useState(false);

  // resolve DB user key: try user.id/uid/userId, else scan /users by username/email
  useEffect(() => {
    let mounted = true;
    async function resolve() {
      if (!user) { if (mounted) setDbUserId(null); return; }
      if (user.id || user.uid || user.userId) {
        if (mounted) setDbUserId(user.id || user.uid || user.userId);
        return;
      }
      // otherwise scan /users for matching username or email
      try {
        const snap = await get(ref(rtdb, `users`));
        if (!snap.exists()) { if (mounted) setDbUserId(null); return; }
        const all = snap.val() || {};
        const candidateKey = Object.keys(all).find((k) => {
          const u = all[k] || {};
          if (user.username && u.username && u.username === user.username) return true;
          if (user.email && u.email && u.email === user.email) return true;
          // fallback: createdAt or other heuristics could be added
          return false;
        });
        if (mounted) setDbUserId(candidateKey || null);
      } catch (e) {
        console.warn("resolve db user id error", e);
        if (mounted) setDbUserId(null);
      }
    }
    resolve();
    return () => { mounted = false; };
  }, [user]);

  // helper to check membership in many DB shapes
  function isMember(chatObj, userId, username) {
    if (!chatObj) return false;
    const participants = chatObj.participants || chatObj.members || {};
    // direct key check
    if (participants && typeof participants === "object") {
      if (Object.prototype.hasOwnProperty.call(participants, userId)) return true;
      // values might hold uid strings
      const vals = Object.values(participants);
      for (const v of vals) {
        if (!v) continue;
        if (typeof v === "string" && v === userId) return true;
        if (typeof v === "object") {
          if (v.id === userId || v.uid === userId) return true;
          if (username && (v.username === username || v.displayName === username)) return true;
        }
        if (v === true && typeof v !== "object" && typeof v !== "string") {
          // nothing
        }
      }
    }
    // participantUsernames checks
    if (chatObj.participantUsernames) {
      if (Array.isArray(chatObj.participantUsernames) && username && chatObj.participantUsernames.includes(username)) return true;
      if (typeof chatObj.participantUsernames === "object" && username && Object.values(chatObj.participantUsernames).includes(username)) return true;
    }
    if (chatObj.createdBy && chatObj.createdBy === userId) return true;
    return false;
  }

  useEffect(() => {
    if (!dbUserId) { setChats([]); setLoading(false); return; }

    setLoading(true);
    const userChatsRef = ref(rtdb, `userChats/${dbUserId}`);

    const unsub = onValue(userChatsRef, async (snap) => {
      const val = snap.val() || {};
      const chatIds = Object.keys(val || {});

      let results = [];
      try {
        if (chatIds.length > 0) {
          const promises = chatIds.map(async (cid) => {
            const cs = await get(ref(rtdb, `chats/${cid}`));
            return cs && cs.exists() ? { id: cid, ...(cs.val() || {}) } : null;
          });
          results = (await Promise.all(promises)).filter(Boolean);
        } else {
          // fallback scan all chats
          const allSnap = await get(ref(rtdb, `chats`));
          if (allSnap && allSnap.exists()) {
            const all = allSnap.val();
            results = Object.keys(all).map(k => ({ id: k, ...(all[k] || {}) }))
              .filter(c => isMember(c, dbUserId, user && user.username ? user.username : null));
          } else {
            results = [];
          }
        }

        results.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
        setChats(results);
      } catch (e) {
        console.error("fetch chats error", e);
        setChats([]);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      try { unsub(); } catch (e) {}
    };
  }, [dbUserId]);

  return (
    <div className="chatlist-wrapper">
      <div className="header">
        <h3>Chats</h3>
        <div>{user && user.username}</div>
        <button onClick={() => setShowNew(true)}>New</button>
      </div>

      <div className="chats">
        {loading ? <div>Loading…</div> : null}
        {!loading && chats.length === 0 ? <div>No chats</div> : null}
        {chats.map(c => <ChatItem key={c.id} chat={c} />)}
      </div>

      {showNew && <NewChatModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
