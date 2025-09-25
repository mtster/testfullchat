import './index.css';


// src/index.js  (add this near the other top-level imports)
import { registerForPush } from "./push/registerPush";

// Try to register service worker and push subscription for the currently signed-in user (best-effort)
(async function(){
  try{ await registerForPush(); }catch(e){ console.warn("registerForPush failed:", e);} 
})();





// src/index.js
import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
...
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
