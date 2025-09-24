// src/components/Login.js
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import "../index.css";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e && e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      // <-- pass positional args (username, password)
      await login(username, password);
      navigate("/", { replace: true });
    } catch (error) {
      setErr(error.message || "Failed to login.");
      setLoading(false);
    }
  }

  return (
    <div style={{
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
        padding: 18
      }}>
        <h2 style={{ marginTop: 0 }}>Sign in</h2>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-row">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>

          <div className="form-row">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          {err && <div style={{ color: "salmon" }}>{err}</div>}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
            <div style={{ marginLeft: "auto" }}>
              <Link to="/register" style={{ color: "var(--muted)" }}>Create account</Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
