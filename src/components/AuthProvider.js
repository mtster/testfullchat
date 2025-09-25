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
} from "firebase/database";
import { obtainFcmToken, removeFcmToken, onForegroundMessage } from "../firebase";

const AuthContext = createContext();
export function useAuth() {
  return useContext(AuthContext);
}

function persistUser(user) {
  if (user) {
    localStorage.setItem("user", JSON.stringify(user));
  } else {
    localStorage.removeItem("user");
  }
}

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
    let currentToken = null;

    async function setupPresenceAndFcm(u) {
      if (!u || !u.id) return;

      // presence: set to true and set an onDisconnect removal
      try {
        presenceRef = ref(rtdb, `presence/${u.id}`);
        await set(presenceRef, true);
        disconnecter = onDisconnect(presenceRef);
        // schedule removal on disconnect
        try {
          disconnecter.remove();
        } catch (err) {
          console.warn("onDisconnect.remove() failed:", err && err.message);
        }
      } catch (err) {
        console.warn("presence setup failed:", err && err.message);
      }

      // update presence on visibility changes
      const setAway = () => {
        try { set(ref(rtdb, `presence/${u.id}`), false); } catch(_) {}
      };
      const setHere = () => {
        try { set(ref(rtdb, `presence/${u.id}`), true); } catch(_) {}
      };
      window.addEventListener("beforeunload", setAway);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") setHere();
        else setAway();
      });

      // try to obtain FCM token and store it
      try {
        const token = await obtainFcmToken();
        if (token) {
          currentToken = token;
          try {
            await set(ref(rtdb, `fcmTokens/${u.id}/${token}`), true);
            console.debug("Stored fcm token for user:", u.id);
          } catch (err) {
            console.warn("storing fcm token failed:", err && err.message);
          }
        } else {
          console.debug("No FCM token obtained or permission denied.");
        }
      } catch (err) {
        console.warn("obtainFcmToken error:", err && err.message);
      }

      // foreground messages: we intentionally ignore showing native notifications while app visible
      try {
        onForegroundMessage((payload) => {
          console.debug("Foreground push received (ignored)", payload);
        });
      } catch (err) {
        // no-op
      }
    }

    if (user) {
      setupPresenceAndFcm(user);
    }

    return () => {
      // cleanup
      try {
        if (user && user.id) {
          set(ref(rtdb, `presence/${user.id}`), false).catch(()=>{});
        }
      } catch (err) {}

      if (currentToken && user && user.id) {
        try {
          removeFcmToken(currentToken).catch(()=>{});
        } catch (err) {}
        try {
          set(ref(rtdb, `fcmTokens/${user.id}/${currentToken}`), null).catch(()=>{});
        } catch (err) {}
      }
    };
  }, [user]);

  const register = async ({ username, password }) => {
    if (!username || !username.trim()) throw new Error("username required");
    if (!password) throw new Error("password required");
    const usersRef = ref(rtdb, "users");
    const q = query(usersRef, orderByChild("username"), equalTo(username));
    const snap = await get(q);
    if (snap && snap.exists()) throw new Error("Username already taken");
    const newUserRef = push(usersRef);
    const userObj = { id: newUserRef.key, username: username, password: password };
    await set(newUserRef, userObj);
    persistUser(userObj);
    setUser(userObj);
    return userObj;
  };

  const login = async ({ username, password }) => {
    if (!username || !password) throw new Error("username & password required");
    const usersRef = ref(rtdb, "users");
    const q = query(usersRef, orderByChild("username"), equalTo(username));
    const snap = await get(q);
    const val = (snap && snap.val()) || {};
    const found = Object.entries(val).map(([k,v]) => ({ ...v })).find(u => u.username === username && u.password === password);
    if (!found) throw new Error("Invalid username/password.");
    persistUser(found);
    setUser(found);
    return found;
  };

  const logout = async () => {
    try {
      if (user && user.id) {
        await set(ref(rtdb, `presence/${user.id}`), false);
        const tokensSnap = await get(ref(rtdb, `fcmTokens/${user.id}`));
        const tokens = (tokensSnap && tokensSnap.val()) || {};
        for (const t of Object.keys(tokens)) {
          await set(ref(rtdb, `fcmTokens/${user.id}/${t}`), null);
        }
      }
    } catch (err) {
      console.warn("logout cleanup failed:", err && err.message);
    }
    persistUser(null);
    setUser(null);
    localStorage.removeItem("lastChat");
  };

  const value = { user, register, login, logout, initializing };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
