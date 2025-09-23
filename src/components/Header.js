// src/components/Header.js
import React from "react";
import { useAuth } from "./AuthProvider";
import NewChatModal from "./NewChatModal";
import { useNavigate } from "react-router-dom";

/**
 * Header component with robust logo loading:
 * - tries CRA PUBLIC_URL path
 * - falls back to absolute /icons path (useful on GH Pages)
 * - uses an inline SVG fallback if the image can't be loaded
 *
 * Keeps the previous behavior (New Chat, Logout).
 */
export default function Header() {
  const { user, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const [logoSrc, setLogoSrc] = React.useState(() => {
    // prefer process.env.PUBLIC_URL when available (CRA)
    const pub = (typeof process !== "undefined" && process.env && process.env.PUBLIC_URL) ? process.env.PUBLIC_URL : "";
    return `${pub}/icons/icon-192.png`;
  });

  // If logo fails to load, attempt an alternate path (no PUBLIC_URL)
  function handleLogoError() {
    // If current src is already a fallback, do nothing
    const current = logoSrc || "";
    if (current.endsWith("/icons/icon-192.png") && current.startsWith("/")) {
      // already the absolute path fallback tried - set inline SVG fallback
      setLogoSrc("data:image/svg+xml;utf8," + encodeURIComponent(HEADER_SVG));
      return;
    }
    // try absolute path (works for many GH Pages setups)
    setLogoSrc("/icons/icon-192.png");
  }

  return (
    <div className="topbar" role="banner" aria-label="Top bar">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img
          src={logoSrc}
          onError={handleLogoError}
          alt="Protocol"
          style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }}
        />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Protocol</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{user ? `Signed in as ${user.username}` : "Not signed in"}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn" onClick={() => setOpen(true)}>New chat</button>
        <button
          className="btn logout"
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

/* small inline SVG fallback (simple protocol glyph) */
const HEADER_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='none'>
  <rect width='24' height='24' rx='5' fill='%230f1720'/>
  <path d='M7 12h10' stroke='%236ee7b7' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/>
  <path d='M7 7h10' stroke='%236ee7b7' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' opacity='0.8'/>
  <path d='M7 17h6' stroke='%236ee7b7' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' opacity='0.6'/>
</svg>`;
