// src/notificationsBellInjector.js
// Injects a notification bell into the header (left of the New Chat button).
// It tries multiple heuristics to find the top bar and the New Chat button,
// and will re-insert itself if React re-renders the header.
//
// This file is DOM-based and safe to import from src/index.js (one line).
//
// It calls obtainFcmTokenAndSave(uid) on click. It will attempt to find the current
// user uid via firebase auth (auth.currentUser.uid) or fallbacks in window.*.

import { obtainFcmTokenAndSave } from "./firebase";
import { getAuth } from "firebase/auth";

(function initNotificationBell() {
  // small CSS for the injected button (keeps visual minimal, won't alter existing styles)
  const styleId = "injected-notify-bell-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .injected-notify-bell {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        margin-right: 8px;
        border-radius: 6px;
        border: none;
        background: transparent;
        cursor: pointer;
        padding: 0;
      }
      .injected-notify-bell:active { transform: translateY(1px); }
      .injected-notify-bell svg { width:18px; height:18px; color:inherit; }
      .injected-notify-bell[disabled] { opacity: .45; cursor: default; }
    `;
    document.head.appendChild(style);
  }

  // create bell element
  function createBellElement() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "injected-notify-bell";
    btn.title = "Enable notifications";
    btn.setAttribute("aria-label", "Enable notifications");

    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 22c1.1 0 1.99-.9 1.99-2H10c0 1.1.9 2 2 2z" fill="currentColor"/>
        <path d="M18 16v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 10-3 0v.68C7.63 5.36 6 7.92 6 11v5l-1.99 2H20L18 16z" fill="currentColor"/>
      </svg>
    `;

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        // try firebase auth first
        let uid = null;
        try {
          const auth = getAuth();
          if (auth && auth.currentUser && auth.currentUser.uid) uid = auth.currentUser.uid;
        } catch (e) {
          // ignore
        }
        // fallback to globals if your app exposes them (some apps set window.currentUser)
        if (!uid && window.currentUser && window.currentUser.uid) uid = window.currentUser.uid;
        if (!uid && window.__CURRENT_USER_UID__) uid = window.__CURRENT_USER_UID__;

        if (!uid) {
          // friendly alert so user knows they must be signed in first
          // (we avoid changing app UI - this is a minimal prompt)
          alert("Please sign in first to enable notifications.");
          btn.disabled = false;
          return;
        }

        // Call the function we added in firebase.js which requests permission & saves token
        const token = await obtainFcmTokenAndSave(uid);
        if (token) {
          // quick visual feedback
          try { navigator.vibrate && navigator.vibrate(40); } catch(e){}
          alert("Notifications enabled.");
        } else {
          // get reason from Notification.permission
          const p = (typeof Notification !== "undefined" && Notification.permission) ? Notification.permission : "unknown";
          alert("Could not enable notifications (permission: " + p + "). Make sure app is installed to Home Screen and try again.");
        }
      } catch (err) {
        console.error("notify-bell error", err);
        alert("Failed to enable notifications. Check console/logs.");
      } finally {
        // small delay before re-enabling to avoid double clicks
        setTimeout(() => { btn.disabled = false; }, 1200);
      }
    });

    return btn;
  }

  // heuristics to find header/topbar container and new chat button
  const containerSelectors = [
    "#topbar", ".topbar", ".header", ".app-header", ".chat-header", "header", ".AppHeader", ".navbar"
  ];

  const newChatSelectors = [
    "button[title='New Chat']",
    "button[aria-label*='new chat' i]",
    ".new-chat",
    ".btn-new-chat",
    ".add-chat",
    ".create-chat"
  ];

  function findHeaderContainer() {
    for (const sel of containerSelectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // fallback: try to pick a visible header-like element
    const headers = Array.from(document.querySelectorAll("header, .topbar, .header, .app-header")).filter(e => e.offsetParent !== null);
    return headers.length ? headers[0] : null;
  }

  function findNewChatButton(container) {
    for (const sel of newChatSelectors) {
      const el = container.querySelector(sel);
      if (el) return el;
    }
    // fallback: try to find a button with text "New Chat" (case-insensitive)
    const buttons = Array.from(container.querySelectorAll("button, a, div")).filter(el => {
      if (!el.innerText) return false;
      const txt = el.innerText.trim().toLowerCase();
      return txt === "new chat" || txt === "newchat" || txt.includes("new chat");
    });
    return buttons.length ? buttons[0] : null;
  }

  // try to insert bell left of New Chat; if New Chat not found, append to header right side
  async function tryInsertBell() {
    const container = findHeaderContainer();
    if (!container) return false;
    // don't duplicate
    if (container.querySelector(".injected-notify-bell")) return true;

    const newChatBtn = findNewChatButton(container);

    const bell = createBellElement();

    if (newChatBtn && newChatBtn.parentElement) {
      // insert before the New Chat button
      newChatBtn.parentElement.insertBefore(bell, newChatBtn);
      return true;
    } else {
      // fallback: append to container, but ensure it's visually near top-right
      // try to insert into first child that looks like action-group
      const actionsCandidate = container.querySelector(".actions, .controls, .right, .header-actions, .header-controls");
      if (actionsCandidate) {
        actionsCandidate.insertBefore(bell, actionsCandidate.firstChild || null);
      } else {
        container.appendChild(bell);
      }
      return true;
    }
  }

  // Attempt insertion now and keep observing for header changes
  let inserted = false;
  tryInsertBell().then((ok) => { inserted = !!ok; });

  // Use MutationObserver to watch for header changes and re-insert if needed
  const observer = new MutationObserver((mutations) => {
    if (document.querySelector(".injected-notify-bell")) {
      // already present
      return;
    }
    // try again
    tryInsertBell().then((ok) => {
      if (ok) {
        // stop observing once inserted successfully
        observer.disconnect();
      }
    });
  });

  // Start observing body for subtree changes (header may mount later)
  observer.observe(document.body, { childList: true, subtree: true });

  // as a last resort, keep a short interval retry (cleans up after success)
  const retryInterval = setInterval(async () => {
    if (document.querySelector(".injected-notify-bell")) {
      clearInterval(retryInterval);
      try { observer.disconnect(); } catch(e){}
      return;
    }
    await tryInsertBell();
  }, 800);

  // cleanup in 30s (enough retries)
  setTimeout(() => {
    try { observer.disconnect(); } catch(e){}
    clearInterval(retryInterval);
  }, 30000);
})();
