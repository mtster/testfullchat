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

/**
 * Accepts either:
 *  - register(username, password)
 *  - register({ username, password })
 *
 * and same for login(...)
 */
function normalizeCredentials(arg1, arg2) {
  if (!arg1) return { username: undefined, password: undefined };
  if (typeof arg1 === "object" && arg1 !== null && ("username" in arg1 || "password" in arg1)) {
    return { username: arg1.username, password: arg1.password };
  }
  // positional
  return { username: arg1, password: arg2 };
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  // Handlers used for presence; declared here so persistUser can reference them
  function onFocus() {
    try {
      if (user && user.id) {
        dbSet(ref(rtdb, `status/${user.id}`), true).catch(() => {});
      }
    } catch (e) {}
  }
  function onBlur() {
    try {
      if (user && user.id) {
        dbSet(ref(rtdb, `status/${user.id}`), false).catch(() => {});
      }
    } catch (e) {}
  }

  // Persist user in localStorage and set presence / register OneSignal
  async function persistUser(u, opts = {}) {
    // opts.silent => don't write presence or register onesignal if true
    setUser(u);
    try {
      if (u) {
        localStorage.setItem("protocol_user", JSON.stringify(u));
      } else {
        localStorage.removeItem("protocol_user");
      }
    } catch (e) {
      // non-fatal
      console.warn("persistUser storage error", e);
    }

    if (!u || opts.silent) return;

    // presence: mark user online and setup onDisconnect to mark offline
    try {
      const statusRef = ref(rtdb, `status/${u.id}`);
      await dbSet(statusRef, true);
      try {
        const od = onDisconnect(statusRef);
        od.set(false).catch(() => {});
      } catch (e) {
        // some runtimes may not support onDisconnect in the same way; ignore
      }

      // update last seen time
      try {
        await dbSet(ref(rtdb, `users/${u.id}/lastSeen`), Date.now());
      } catch (e) {}
    } catch (e) {
      console.warn("presence setup failed", e);
    }

    // add global focus/blur listeners to update presence while app is open
    try {
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);
    } catch (e) {}

    // store a cleanup function on user to remove listeners later
    try {
      u.__presenceCleanup = () => {
        try {
          window.removeEventListener("focus", onFocus);
          window.removeEventListener("blur", onBlur);
          // set offline
          dbSet(ref(rtdb, `status/${u.id}`), false).catch(() => {});
        } catch (e) {}
      };
    } catch (e) {}

    // register OneSignal player id for this user (best-effort, non-blocking)
    try {
      registerOneSignalForUser(u.id);
    } catch (e) {
      console.warn("error registering OneSignal", e);
    }
  }

  // register(username, password) or register({username, password})
  const register = async (a1, a2) => {
    const { username, password } = normalizeCredentials(a1, a2);
    if (!username || !password) throw new Error("username and password required");

    // ensure username is unique
    const usersRef = ref(rtdb, "users");
    const snap = await get(usersRef);
    const users = snap && snap.val() ? snap.val() : {};
    const found = Object.entries(users).find(([k, v]) => v.username === username);
    if (found) throw new Error("Username already exists");

    // create user record
    const newUserRef = push(usersRef);
    const userObj = {
      username,
      password, // NOTE: plaintext—kept for compatibility with your app
      createdAt: Date.now(),
    };
    await dbSet(newUserRef, userObj);
    const uid = newUserRef.key;
    const stored = { id: uid, username, createdAt: userObj.createdAt };

    await persistUser(stored);
    return stored;
  };

  // login(username, password) or login({username, password})
  const login = async (a1, a2) => {
    const { username, password } = normalizeCredentials(a1, a2);
    if (!username || !password) throw new Error("username and password required");

    const usersRef = ref(rtdb, "users");
    const snap = await get(usersRef);
    const users = snap && snap.val() ? snap.val() : {};
    const found = Object.entries(users).find(([k, v]) => v.username === username && v.password === password);
    if (!found) throw new Error("Incorrect username/password");
    const [uid, userRec] = found;
    const stored = { id: uid, username: userRec.username, createdAt: userRec.createdAt };
    await persistUser(stored);
    return stored;
  };

  const logout = async () => {
    if (user && user.id) {
      try {
        // remove onesignal player id (best-effort)
        try {
          await removePlayerIdForUser(user.id);
        } catch (e) {}

        // clear presence and listeners
        try {
          if (typeof user.__presenceCleanup === "function") {
            try { user.__presenceCleanup(); } catch (e) {}
          } else {
            await dbSet(ref(rtdb, `status/${user.id}`), false);
          }
        } catch (e) {}
      } catch (e) {
        console.warn("logout cleanup error", e);
      }
    }
    persistUser(null);
    localStorage.removeItem("lastChat");
  };

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
    // eslint-disable-next-line
  }, []);

  const value = { user, register, login, logout, initializing };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
