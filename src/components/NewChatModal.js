// src/components/NewChatModal.js
import { rtdb } from "../firebase";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import {
  ref,
  push,
  set,
  query,
  orderByChild,
  equalTo,
  get,
} from "firebase/database";

export default function NewChatModal({ onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [chatName, setChatName] = useState("");
  const [participantUsernames, setParticipantUsernames] = useState("");
  const [err, setErr] = useState(null);

  // use the already-initialized rtdb instance
  const rdb = rtdb;

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

    // ensure the current user is included
    if (!participants.includes(user.username)) {
      participants.push(user.username);
    }

    try {
      // find participant user ids
      const usersRef = ref(rdb, "users");
      const usersSnap = await get(usersRef);
      const usersVal = (usersSnap && usersSnap.val()) || {};
      const userMap = {};
      Object.entries(usersVal).forEach(([id, u]) => {
        if (u && u.username) userMap[u.username] = { id, ...u };
      });

      const participantIds = participants
        .map((uname) => userMap[uname])
        .filter(Boolean)
        .map((u) => u.id);

      // create chat
      const chatsRef = ref(rdb, "chats");
      const newChatRef = push(chatsRef);
      const chatId = newChatRef.key;
      const chatObj = {
        id: chatId,
        name,
        participants: participantIds,
        createdAt: Date.now(),
        createdBy: user.id,
      };
      await set(newChatRef, chatObj);

      // register chat under each user's userChats
      await Promise.all(
        participantIds.map((pid) =>
          set(ref(rdb, `userChats/${pid}/${chatId}`), { chatId, addedAt: Date.now() })
        )
      );

      if (onClose) onClose();
      navigate(`/chats/${chatId}`);
    } catch (err) {
      console.error("createChat error", err);
      setErr("Failed to create chat");
    }
  };

  return (
    <>
      <div className="modal-backdrop" />
      <div className="modal">
        <h3>New Chat</h3>
        <form onSubmit={createChat} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label>
            Chat name
            <input value={chatName} onChange={(e) => setChatName(e.target.value)} />
          </label>

          <label>
            Participants (comma-separated usernames)
            <input value={participantUsernames} onChange={(e) => setParticipantUsernames(e.target.value)} />
          </label>

          {err && <div style={{ color: "salmon", marginBottom: 8 }}>{err}</div>}

          <div style={{ display: "flex", gap: 8 }}>
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
