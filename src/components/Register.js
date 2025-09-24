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
      // <-- pass positional args (username, password)
      await register(username, password);
      navigate("/", { replace: true });
    } catch (error) {
      setErr(error.message || "Failed to register.");
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
        <h2 style={{ marginTop: 0 }}>Create account</h2>

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
