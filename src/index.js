// src/index.js
import './index.css';
import "./onesignalRegister";

import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";

import registerForPush from "./push/registerPush";

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <ErrorBoundary>
    <HashRouter>
      <App />
    </HashRouter>
  </ErrorBoundary>
);

// best-effort attempt to register service worker and push on app start
try {
  registerForPush().catch((e)=>{ console.warn('registerForPush failed', e); });
} catch (e) {
  console.warn('registerForPush call failed', e);
}

function showGlobalError(text) {
  try {
    // try to render a simple alert to user
    alert(text);
  } catch (e) {}
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
