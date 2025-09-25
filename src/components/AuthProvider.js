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
  onValue,
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

  // presence & FCM token management
  useEffect(() => {
    let presenceRef = null;
    let disconnected = null;
    let currentToken = null;

    async function setupPresenceAndFcm(u) {
      if (!u) return;
      // presence
      try {
        presenceRef = ref(rtdb, `presence/${u.id}`);
        await set(presenceRef, true);
        // ensure presence is removed on disconnect
        disconnected = onDisconnect(presenceRef);
        disconnected.remove();
      } catch (err) {
        console.warn("presence setup failed", err);
      }

      // keep presence updated when page unloads/visibility changes
      const setAway = () => {
        try { set(presenceRef, false); } catch(_) {}
      };
      const setHere = () => {
        try { set(presenceRef, true); } catch(_) {}
      };
      window.addEventListener("beforeunload", setAway);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") setHere();
        else setAway();
      });

      // FCM token obtain
      try {
        const token = await obtainFcmToken();
        if (token) {
          currentToken = token;
          try {
            const tokenRef = ref(rtdb, `fcmTokens/${u.id}/${token}`);
            await set(tokenRef, true);
          } catch (err) {
            console.warn("storing fcm token failed", err);
          }
        }
      } catch (err) {
        console.warn("obtainFcmToken failed", err);
      }

      // foreground message handling: we don't show native notification while app is visible.
      try {
        onForegroundMessage((payload) => {
          // ignore by default (the app is open). You can add in-app UI alerts here if desired.
          console.debug("Foreground push received (ignored)", payload);
        });
      } catch (err) {}
    }

    if (user) {
      setupPresenceAndFcm(user);
    }

    return () => {
      // cleanup on logout / unmount
      if (presenceRef && user) {
        try { set(ref(rtdb, `presence/${user.id}`), false); } catch(_) {}
      }
      if (currentToken && user) {
        try { removeFcmToken(currentToken); } catch(_) {}
        try { set(ref(rtdb, `fcmTokens/${user.id}/${currentToken}`), null); } catch(_) {}
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
    // remove presence and FCM tokens for this user
    try {
      if (user && user.id) {
        await set(ref(rtdb, `presence/${user.id}`), false);
        // remove all fcm tokens under this user (client-side best-effort)
        const tokensSnap = await get(ref(rtdb, `fcmTokens/${user.id}`));
        const tokens = (tokensSnap && tokensSnap.val()) || {};
        for (const t of Object.keys(tokens)) {
          await set(ref(rtdb, `fcmTokens/${user.id}/${t}`), null);
        }
      }
    } catch (err) {
      console.warn("logout cleanup failed", err);
    }
    persistUser(null);
    setUser(null);
    localStorage.removeItem("lastChat");
  };

  const value = { user, register, login, logout, initializing };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
