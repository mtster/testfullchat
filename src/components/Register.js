// src/components/Register.js
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import "../index.css";

export default function Register() {
  const { register } = useAuth();
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
      await register({ username, password });
      navigate("/", { replace: true });
    } catch (error) {
      setErr(error.message || "Failed to register.");
      setLoading(false);
    }
  }

  return (
    <div className="app-wrap" style={{ maxWidth: 520 }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div className="app-title" style={{ justifyContent: "center" }}>
          <img src="/icon-192.png" alt="Protocol" style={{ width: 36, height: 36, borderRadius: 8 }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <div style={{ fontSize: 22 }}>Protocol</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Create a new account</div>
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
              {loading ? "Creating..." : "Create account"}
            </button>
            <div style={{ marginLeft: "auto" }}>
              <Link to="/login" style={{ color: "var(--muted)" }}>Already have an account?</Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
