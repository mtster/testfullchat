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
      await login({ username, password });
      navigate("/", { replace: true });
    } catch (error) {
      setErr(error.message || "Failed to login.");
      setLoading(false);
    }
  }

  return (
    <div className="app-wrap" style={{ maxWidth: 480 }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div className="app-title" style={{ justifyContent: "center" }}>
          <img src="/icon-192.png" alt="Protocol" style={{ width: 36, height: 36, borderRadius: 8 }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <div style={{ fontSize: 22 }}>Protocol</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Secure, simple messaging</div>
          </div>
        </div>
      </div>

      <div className="panel">
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
