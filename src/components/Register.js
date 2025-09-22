// src/components/Register.js
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function Register() {
  const { register } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      const created = await register({ username, password });
      // show success message then redirect — we auto-login in register()
      // redirect to main chat page
      navigate("/", { replace: true });
    } catch (error) {
      setErr(error.message || "Failed to register.");
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: "32px auto", padding: 20 }}>
      <h2>Register</h2>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Choose a username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>

        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>

        {err && <div style={{ color: "salmon", marginBottom: 8 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" type="submit">Register</button>
        </div>

        <div style={{ marginTop: 12 }}>
          Already have an account? <Link to="/login">Log in</Link>
        </div>
      </form>
    </div>
  );
}
