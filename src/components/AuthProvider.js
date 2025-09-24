// src/components/AuthProvider.js
import React, { createContext, useContext, useState, useEffect } from "react";
import { rtdb } from "../firebase";
import {
  ref,
  push,
  set as dbSet,
  get,
  onDisconnect,
} from "firebase/database";
import { registerOneSignalForUser, removePlayerIdForUser } from "../onesignal";

const AuthContext = createContext();
export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { id, username, ... }
  const [initializing, setInitializing] = useState(true);

  // load user from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("protocol_user");
      if (raw) {
        const parsed = JSON.parse(raw);
        persistUser(parsed, { silent: true });
      }
    } catch (e) {
      console.warn("Failed to read persisted user", e);
    } finally {
      setInitializing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persistUser: store in memory + localStorage, also set presence and register OneSignal
  const persistUser = async (u, opts = {}) => {
    // u is either null or { id, username, ... }
    setUser(u);
    if (u) {
      try {
        localStorage.setItem("protocol_user", JSON.stringify(u));
      } catch (e) {
        console.warn("persistUser: failed to save to localStorage", e);
      }

      // Presence: set status/{uid} = true while the app is open
      try {
        const statusRef = ref(rtdb, `status/${u.id}`);
        await dbSet(statusRef, true);
        // ensure offline cleanup with onDisconnect
        const disco = onDisconnect(statusRef);
        disco.set(false).catch(() => { /* best-effort */ });
        // window events: toggle presence on focus/blur/unload
        const onFocus = () => dbSet(statusRef, true).catch(() => {});
        const onBlur = () => dbSet(statusRef, false).catch(() => {});
        window.addEventListener("focus", onFocus);
        window.addEventListener("blur", onBlur);
        window.addEventListener("beforeunload", () => {
          try { dbSet(statusRef, false); } catch (e) {}
        });

        // Save cleanup reference on the user object (non-serialised)
        u.__presenceCleanup = () => {
          try {
            window.removeEventListener("focus", onFocus);
            window.removeEventListener("blur", onBlur);
            // set offline
            dbSet(statusRef, false).catch(() => {});
          } catch (e) {}
        };
      } catch (e) {
        // non-fatal
        console.warn("presence setup failed", e);
      }

      // OneSignal registration (store player id at /users/{uid}/onesignalPlayerId)
      try {
        registerOneSignalForUser(u.id);
      } catch (e) {
        console.warn("error registering OneSignal", e);
      }
    } else {
      // clearing user -> cleanup localStorage and presence and OneSignal record
      try {
        localStorage.removeItem("protocol_user");
      } catch (e) {}
    }
  };

  // register(username, password)
  // simple username uniqueness check with your RTDB users root
  const register = async (username, password) => {
    if (!username || !password) throw new Error("username and password required");
    // ensure username is unique
    const usersRef = ref(rtdb, "users");
    // naive uniqueness: scan users for username
    const snap = await get(usersRef);
    const users = snap && snap.val() ? snap.val() : {};
    const found = Object.entries(users).find(([k, v]) => v.username === username);
    if (found) throw new Error("Username already exists");
    // create user record
    const newUserRef = push(usersRef);
    const userObj = {
      username,
      password, // NOTE: plaintext — kept for compatibility with your existing app
      createdAt: Date.now(),
    };
    await dbSet(newUserRef, userObj);
    const uid = newUserRef.key;
    const stored = { id: uid, username, createdAt: userObj.createdAt };
    await persistUser(stored);
    return stored;
  };

  // login(username, password)
  const login = async (username, password) => {
    // scan users for match
    const usersRef = ref(rtdb, "users");
    const snap = await get(usersRef);
    const users = snap && snap.val() ? snap.val() : {};
    const foundEntry = Object.entries(users).find(([k, v]) => v.username === username && v.password === password);
    if (!foundEntry) throw new Error("Invalid username/password.");
    const [id, data] = foundEntry;
    const found = { id, username: data.username, createdAt: data.createdAt };
    await persistUser(found);
    return found;
  };

  const logout = async () => {
    if (user) {
      try {
        // remove presence and cleanup
        if (user.__presenceCleanup) {
          try { user.__presenceCleanup(); } catch (e) {}
        }
        // remove OneSignal player id for this user (best-effort)
        try {
          await removePlayerIdForUser(user.id);
        } catch (e) {}
        // unset status explicitly
        try { await dbSet(ref(rtdb, `status/${user.id}`), false); } catch (e) {}
      } catch (e) {
        console.warn("logout cleanup error", e);
      }
    }
    persistUser(null);
    localStorage.removeItem("lastChat");
  };

  const value = { user, register, login, logout, initializing };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
