// src/components/AuthProvider.js
import React, { createContext, useContext, useState, useEffect } from "react";
import { rtdb } from "../firebase";
import {
  ref,
  push,
  set,
  get,
  query,
  orderByChild,
  equalTo,
  onDisconnect,
  child
} from "firebase/database";
import { obtainFcmToken, removeFcmToken, onForegroundMessage } from "../firebase";

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Custom simple auth using Realtime Database users node.
 * This preserves the app's existing custom authentication approach.
 *
 * Data layout:
 * users/{uid} = { username, password, createdAt, ...additional fields... }
 *
 * We will also store:
 * users/{uid}/fcmTokens/{token} = true
 * users/{uid}/online = true|false
 * users/{uid}/activeChat = chatId|null
 */
export default function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch (e) {
      return null;
    }
  });
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    setInitializing(false);
  }, []);

  useEffect(() => {
    let presenceRef = null;
    let disconnecter = null;
    let currentFcmToken = null;

    async function setupPresenceAndFcm(u) {
      if (!u || !u.id) return;
      try {
        // presence - write under users/{uid}/online and remove on disconnect
        presenceRef = ref(rtdb, `users/${u.id}/online`);
        await set(presenceRef, true);
        disconnecter = onDisconnect(presenceRef);
        try { await disconnecter.set(false); } catch (err) { /* best-effort */ }

        // Obtain FCM token (if browser supports it & permission granted)
        try {
          const token = await obtainFcmToken();
          if (token) {
            currentFcmToken = token;
            // store token under users/{uid}/fcmTokens/{token} = true
            await set(ref(rtdb, `users/${u.id}/fcmTokens/${token}`), true);
            // persist token in local user object (not sensitive)
            const updated = { ...u, fcmTokenSaved: true };
            setUser(updated);
            localStorage.setItem("user", JSON.stringify(updated));
          } else {
            // no token obtained
          }
        } catch (err) {
          console.warn("storing fcm token failed:", err && err.message);
        }

        // foreground messages - ignore native notification while app is visible
        try {
          onForegroundMessage((payload) => {
            // application-specific: you may show an in-app toast here
            console.debug("Foreground push received (ignored for native notification):", payload);
          });
        } catch (err) { /* ignore */ }

      } catch (err) {
        console.warn("presence setup failed:", err && err.message);
      }
    }

    if (user) {
      setupPresenceAndFcm(user);
    }

    return () => {
      // cleanup presence and FCM token if any (best-effort)
      (async () => {
        try {
          if (user && user.id) {
            await set(ref(rtdb, `users/${user.id}/online`), false);
            await set(ref(rtdb, `users/${user.id}/activeChat`), null);
            // remove saved FCM token (best-effort) - we don't know token value here reliably; apps often keep token list server-side.
            // NOTE: we won't delete tokens automatically here to avoid removing tokens used on other devices.
          }
        } catch (err) { /* ignore */ }
      })();
    };
  }, [user]);

  // Register a new user
  async function register({ username, password }) {
    if (!username || !password) throw new Error("username & password required");
    // check uniqueness
    const usersQ = query(ref(rtdb, "users"), orderByChild("username"), equalTo(username));
    const snap = await get(usersQ);
    if (snap && snap.exists()) {
      throw new Error("username taken");
    }
    // create new user with push key
    const newRef = push(ref(rtdb, "users"));
    const uid = newRef.key;
    const userObj = {
      username,
      password,
      createdAt: Date.now()
    };
    await set(ref(rtdb, `users/${uid}`), userObj);
    const u = { id: uid, username };
    persistUser(u);
    setUser(u);
    // setup presence and FCM for newly created user
    try { await (async () => {
      const token = await obtainFcmToken();
      if (token) await set(ref(rtdb, `users/${uid}/fcmTokens/${token}`), true);
    })(); } catch (e) {}
    return u;
  }

  // Login with username/password
  async function login({ username, password }) {
    if (!username || !password) throw new Error("username & password required");
    const usersQ = query(ref(rtdb, "users"), orderByChild("username"), equalTo(username));
    const snap = await get(usersQ);
    if (!snap || !snap.exists()) throw new Error("User not found");
    const val = snap.val();
    const keys = Object.keys(val || {});
    const uid = keys[0];
    const data = val[uid];
    if (!data) throw new Error("User data missing");
    if (String(data.password || "") !== String(password || "")) throw new Error("Invalid credentials");
    const u = { id: uid, username: data.username };
    persistUser(u);
    setUser(u);
    return u;
  }

  async function logout() {
    try {
      if (user && user.id) {
        // set online false
        await set(ref(rtdb, `users/${user.id}/online`), false).catch(()=>{});
        await set(ref(rtdb, `users/${user.id}/activeChat`), null).catch(()=>{});
        // remove fcm tokens for this device is hard without token value; instruct removeFcmToken on client if needed
      }
    } catch (err) {
      console.warn("logout cleanup failed:", err && err.message);
    }
    persistUser(null);
    setUser(null);
    localStorage.removeItem("lastChat");
  }

  function persistUser(u) {
    try {
      if (!u) {
        localStorage.removeItem("user");
      } else {
        localStorage.setItem("user", JSON.stringify(u));
      }
    } catch (e) {}
  }

  const value = { user, register, login, logout, initializing };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
