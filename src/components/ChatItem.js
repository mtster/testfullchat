// src/components/ChatItem.js
import React from "react";
import "../index.css";

export default function ChatItem({ chat }) {
  const preview = chat.lastMessage || (chat.participantUsernames ? `Conversation with ${chat.participantUsernames.join(", ")}` : "");
  const date = chat.lastMessageAt ? new Date(chat.lastMessageAt).toLocaleString() : "";

  return (
    <div className="chat-item" role="button" tabIndex={0}>
      <div className="name">{chat.name || `Chat ${chat.id}`}</div>
      <div className="meta">
        <div className="preview">{preview}</div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>{date}</div>
      </div>
    </div>
  );
}
