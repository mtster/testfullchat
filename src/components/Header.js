// src/components/Header.js
import React from "react";
import { useAuth } from "./AuthProvider";
import NewChatModal from "./NewChatModal";
import { useNavigate } from "react-router-dom";

export default function Header() {
  const { user, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();

  return (
    <div className="header">
      <div style={{display:"flex", alignItems:"center", gap:12}}>
        <div style={{fontWeight:700}}>FRBS Chat</div>
        <div style={{color:"var(--muted)"}}>Logged in as {user?.username}</div>
      </div>

      <div style={{display:"flex", alignItems:"center", gap:8}}>
        <button className="btn secondary" onClick={() => setOpen(true)}>New Chat</button>
        <button className="btn secondary" onClick={() => { logout(); navigate("/login"); }}>Logout</button>
      </div>

      {open && <NewChatModal onClose={() => setOpen(false)} />}
    </div>
  );
}
