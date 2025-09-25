// src/components/ErrorBoundary.js
import React from "react";

/**
 * Enhanced ErrorBoundary for mobile debugging:
 * - Shows error.message and stack
 * - Shows component stack
 * - Shows context: current URL, hash, localStorage "frbs_user" (if present)
 * - Provides "Copy error" and "Reload" buttons for iPhone workflow
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null, time: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, info: null, time: Date.now() };
  }

  componentDidCatch(error, info) {
    // store stack for display
    this.setState({
      error,
      info: info && info.componentStack ? info.componentStack : null,
      time: Date.now()
    });
    // Log so GitHub Actions logs / browsers with remote debugger can see it
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught an error", error, info);
  }

  copyToClipboard = async () => {
    try {
      const payload = this.buildReport();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(payload);
        alert("Error text copied to clipboard. Paste it here.");
      } else {
        // fallback: select and copy via textarea
        const ta = document.createElement("textarea");
        ta.value = payload;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          alert("Error text copied to clipboard (via fallback). Paste it here.");
        } finally {
          document.body.removeChild(ta);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Copy failed", e);
      alert("Copy failed: " + String(e));
    }
  };

  buildReport = () => {
    const err = this.state.error;
    const info = this.state.info;
    const url = typeof window !== "undefined" ? window.location.href : "<no-window>";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    let frbsUser = null;
    try {
      frbsUser = localStorage.getItem("frbs_user");
    } catch (e) {
      frbsUser = `<localStorage read error: ${String(e)}>`;
    }
    const now = new Date(this.state.time || Date.now()).toISOString();

    const parts = [
      `==== FRBS Chat - Error Report (${now}) ====`,
      `URL: ${url}`,
      `Hash: ${hash}`,
      `frbs_user (localStorage): ${frbsUser}`,
      ``,
      `Error (toString): ${err ? String(err) : "<no error>"}\n`,
      `Error.stack:\n${err && err.stack ? err.stack : "<no stack>"}\n`,
      `Component stack:\n${info ? info : "<no component stack>"}\n`,
      `User agent: ${typeof navigator !== "undefined" ? navigator.userAgent : "<no navigator>"}\n`,
      `Window size: ${typeof window !== "undefined" ? window.innerWidth + "x" + window.innerHeight : "<no window>"}\n`,
      `==== End Report ====`
    ];
    return parts.join("\n");
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const err = this.state.error;
    const info = this.state.info;
    const report = this.buildReport();

    return (
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(0,0,0,0.55)",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial"
      }}>
        <div style={{
          width: "min(980px, 96%)",
          maxHeight: "92vh",
          overflow: "auto",
          background: "#fff8f6",
          color: "#7a0000",
          borderRadius: 10,
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          padding: 16,
          lineHeight: 1.3,
          fontSize: 13
        }}>
          <h2 style={{ marginTop: 0 }}>Application error</h2>

          <div style={{ marginBottom: 12 }}>
            <strong style={{ color: "#5a0000" }}>{err && err.message ? err.message : String(err)}</strong>
          </div>

          <details style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Full error report (tap to expand)</summary>
            <pre style={{ marginTop: 8, fontSize: 12, overflowX: "auto", whiteSpace: "pre-wrap" }}>
              {report}
            </pre>
          </details>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                try { window.location.reload(); } catch (e) { /* ignore */ }
              }}
              style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#e9b8b8", color: "#6a0000", cursor: "pointer" }}>
              Reload page
            </button>

            <button
              onClick={this.copyToClipboard}
              style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#bfe3ff", color: "#00385e", cursor: "pointer" }}>
              Copy error text
            </button>

            <button
              onClick={() => {
                // Try to navigate to login page (HashRouter)
                try {
                  window.location.hash = "/#/login";
                  window.location.reload();
                } catch (e) {
                  // ignore
                }
              }}
              style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#dfe7d8", color: "#0b4b00", cursor: "pointer" }}>
              Go to Login
            </button>
          </div>

          <div style={{ marginTop: 12, color: "#5a0000" }}>
            Tap "Copy error text", paste the copied text here (in this chat) and I will fix the root cause. If copy doesn't work on your iPhone, take a screenshot and paste the image text manually.
          </div>
        </div>
      </div>
    );
  }
}
