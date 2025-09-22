// src/index.js
import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

const container = document.getElementById("root");
const root = createRoot(container);

root.render(
  <HashRouter>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </HashRouter>
);

// --- Global runtime error reporter (shows an overlay on-screen) ---
// This helps because you can't open DevTools on iPhone.
// Any uncaught error or unhandled promise rejection will be shown on the page.

function showGlobalError(text) {
  try {
    let el = document.getElementById("global-error-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "global-error-banner";
      // Inline styles so the error is visible without relying on external CSS
      Object.assign(el.style, {
        position: "fixed",
        left: "8px",
        right: "8px",
        bottom: "12px",
        zIndex: 99999,
        background: "#fff4f4",
        color: "#7a0000",
        padding: "12px",
        borderRadius: "10px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
        fontSize: "13px",
        lineHeight: "1.2",
        maxHeight: "50vh",
        overflow: "auto",
        whiteSpace: "pre-wrap"
      });
      document.body.appendChild(el);
    }
    el.textContent = text;
  } catch (e) {
    // ignore never-block UI
    console.error("showGlobalError failed", e);
  }
}

window.onerror = function (message, source, lineno, colno, error) {
  console.error("window.onerror", message, source, lineno, colno, error);
  const text = `Runtime error: ${message}\nSource: ${source}:${lineno}:${colno}\n${error && error.stack ? error.stack : ""}`;
  showGlobalError(text);
};

window.addEventListener("unhandledrejection", function (evt) {
  console.error("unhandledrejection", evt.reason);
  const reason = evt.reason && evt.reason.stack ? evt.reason.stack : String(evt.reason);
  showGlobalError(`Unhandled promise rejection:\n${reason}`);
});
