// src/components/Header.js
import React from "react";
import { useAuth } from "./AuthProvider";
import NewChatModal from "./NewChatModal";
import { useNavigate } from "react-router-dom";

export default function Header() {
  const { user, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();

  // Use PUBLIC_URL so this works on GitHub Pages project sites and dev server
  const logoSrc = (process.env.PUBLIC_URL ? process.env.PUBLIC_URL : "") + "/icons/icon-192.png";

  return (
    <div className="header" role="banner">
      <div className="header-left">
        <img src={logoSrc} alt="Protocol" className="app-logo" />
        <div className="app-title">
          <div className="name">Protocol</div>
          <div className="subtitle">Signed in as {user?.username || "guest"}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button className="btn secondary" onClick={() => setOpen(true)}>New Chat</button>
        <button
          className="btn secondary"
          onClick={() => {
            logout();
            navigate("/login");
          }}
        >
          Logout
        </button>
      </div>

      {open && <NewChatModal onClose={() => setOpen(false)} />}
    </div>
  );
}
