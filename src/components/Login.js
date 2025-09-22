// src/components/Login.js
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await login({ username, password });
      // redirect to main page (chat list)
      navigate("/", { replace: true });
    } catch (error) {
      setErr(error.message || "Failed to login.");
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: "32px auto", padding: 20 }}>
      <h2>Login</h2>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>

        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>

        {err && <div style={{ color: "salmon", marginBottom: 8 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" type="submit">Login</button>
        </div>

        <div style={{ marginTop: 12 }}>
          {/* textual link as requested */}
          Don't have an account yet? <Link to="/register">Register here</Link>
        </div>
      </form>
    </div>
  );
}
