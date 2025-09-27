// src/components/NewChatModal.js
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { rtdb } from "../firebase";
import {
  ref,
  push,
  set,
  get,
} from "firebase/database";
import "../index.css";

export default function NewChatModal({ onClose }) {
  const { user } = useAuth();
  const [chatName, setChatName] = useState("");
  const [participantUsernames, setParticipantUsernames] = useState("");
  const [err, setErr] = useState(null);
  const navigate = useNavigate();

  const createChat = async (e) => {
    e && e.preventDefault();
    setErr(null);

    const name = (chatName || "").trim();
    if (!name) {
      setErr("Please enter a chat name.");
      return;
    }

    let participants = (participantUsernames || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!participants.includes(user.username)) participants.push(user.username);

    try {
      // resolve usernames -> ids
      const usersRef = ref(rtdb, "users");
      const usersSnap = await get(usersRef);
      const usersVal = (usersSnap && usersSnap.val()) || {};
      const usernameToId = {};
      Object.entries(usersVal).forEach(([uid, u]) => {
        if (u && u.username) usernameToId[u.username] = uid;
      });

      const found = [];
      for (const uname of participants) {
        if (!usernameToId[uname]) {
          throw new Error(`User not found: ${uname}`);
        }
        found.push({ id: usernameToId[uname], username: uname });
      }

      // check duplicates
      const chatsRef = ref(rtdb, "chats");
      const chatsSnap = await get(chatsRef);
      const chatsVal = (chatsSnap && chatsSnap.val()) || {};
      const participantIdsSorted = found.map(f => f.id).sort().join("|");
      for (const [cid, c] of Object.entries(chatsVal)) {
        const cParticipants = c.participants || [];
        const cPartSorted = Array.isArray(cParticipants) ? cParticipants.slice().sort().join("|") : "";
        const sameName = (c.name || "").trim() === name;
        if (sameName && cPartSorted === participantIdsSorted) {
          if (onClose) onClose();
          navigate(`/chats/${cid}`);
          return;
        }
      }

      // create chat payload - ensure no undefineds
      const chatIdRef = push(chatsRef);
      const chatId = chatIdRef.key;
      const payload = {
        id: chatId,
        name,
        participants: found.map((f) => f.id),
        participantUsernames: found.map((f) => f.username),
        createdAt: Date.now(),
        createdBy: user && user.id ? user.id : null,
        lastMessage: null,
        lastMessageAt: null,
      };

      // sanitize undefined -> null (RTDB rejects undefined)
      Object.keys(payload).forEach((k) => {
        if (payload[k] === undefined) payload[k] = null;
      });

      await set(chatIdRef, payload);

      // register chat under each user's userChats
      await Promise.all(
        found.map((p) => set(ref(rtdb, `userChats/${p.id}/${chatId}`), { chatId, addedAt: Date.now() }))
      );

      if (onClose) onClose();
      navigate(`/chats/${chatId}`);
    } catch (error) {
      console.error("createChat error", error);
      setErr((error && error.message) || "Failed to create chat.");
    }
  };

  return (
    <>
      <div className="modal-overlay" onClick={() => onClose && onClose()} />
      <div className="modal" role="dialog" aria-modal="true">
        <h3 style={{ marginTop: 0 }}>New Chat</h3>
        <p className="help">Give the chat a name and list participants by username (comma-separated).</p>
        <form onSubmit={createChat} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          <div className="form-row">
            <label>Chat name</label>
            <input value={chatName} onChange={(e) => setChatName(e.target.value)} />
          </div>

          <div className="form-row">
            <label>Participants (comma-separated usernames)</label>
            <input value={participantUsernames} onChange={(e) => setParticipantUsernames(e.target.value)} placeholder="alice, bob" />
          </div>

          {err && <div style={{ color: "salmon" }}>{err}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" type="submit">Create</button>
            <button className="btn secondary" type="button" onClick={() => onClose && onClose()}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
