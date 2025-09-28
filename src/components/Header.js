// src/components/Header.js
import React from "react";
import { useAuth } from "./AuthProvider";
import NewChatModal from "./NewChatModal";
import { useNavigate } from "react-router-dom";
import { obtainFcmTokenAndSave } from "../firebase";
import { getAuth } from "firebase/auth";

/**
 * Header component with robust logo loading:
 * - tries CRA PUBLIC_URL path
 * - falls back to absolute /icons path (useful on GH Pages)
 * - uses an inline SVG fallback if the image can't be loaded
 *
 * Keeps the previous behavior (New Chat, Logout).
 * Added: a small notification bell button to the left of New chat which requests
 * notification permission (user gesture) and saves token to RTDB via obtainFcmTokenAndSave(uid).
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

  // notification button state
  const [notifLoading, setNotifLoading] = React.useState(false);

  // Attempt to obtain current user's uid by multiple fallbacks
  function resolveUidFallback() {
    // primary: user object from AuthProvider
    if (user && (user.uid || user.id)) {
      return user.uid || user.id;
    }
    // second: firebase auth currentUser
    try {
      const auth = getAuth();
      if (auth && auth.currentUser && (auth.currentUser.uid || auth.currentUser.id)) {
        return auth.currentUser.uid || auth.currentUser.id;
      }
    } catch (e) {
      /* ignore */
    }
    // third: global fallbacks some apps use
    if (window.currentUser && (window.currentUser.uid || window.currentUser.id)) {
      return window.currentUser.uid || window.currentUser.id;
    }
    if (window.__CURRENT_USER_UID__) return window.__CURRENT_USER_UID__;
    return null;
  }

  // Click handler for the bell; uses obtainFcmTokenAndSave(uid)
  async function handleEnableNotifications() {
    if (notifLoading) return;
    setNotifLoading(true);
    try {
      const uid = resolveUidFallback();
      if (!uid) {
        // don't change UI - minimal friendly prompt
        alert("Please sign in first to enable notifications.");
        setNotifLoading(false);
        return;
      }

      const token = await obtainFcmTokenAndSave(uid);
      if (token) {
        // success feedback (minimal)
        alert("Notifications enabled.");
      } else {
        // show likely reason
        const perm = (typeof Notification !== "undefined" && Notification.permission) ? Notification.permission : "unknown";
        alert("Could not enable notifications. Permission status: " + perm + ". Make sure the app is installed to Home Screen and try again.");
      }
    } catch (err) {
      console.error("enable notifications error", err);
      alert("Failed to enable notifications. Check console for details.");
    } finally {
      // small debounce
      setTimeout(() => setNotifLoading(false), 600);
    }
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
        {/* Notification bell inserted left of New chat (minimal styling, uses .btn for visual parity) */}
        <button
          className="btn"
          onClick={handleEnableNotifications}
          disabled={notifLoading}
          title="Enable notifications"
          aria-label="Enable notifications"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "6px 8px" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 22c1.1 0 1.99-.9 1.99-2H10c0 1.1.9 2 2 2z" fill="currentColor" />
            <path d="M18 16v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 10-3 0v.68C7.63 5.36 6 7.92 6 11v5l-1.99 2H20L18 16z" fill="currentColor" />
          </svg>
        </button>

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
