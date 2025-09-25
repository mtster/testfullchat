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
} from "firebase/database";

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
      const raw = localStorage.getItem("user");
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  });
  const [initializing, setInitializing] = useState(false);

  useEffect(() => {
    // no-op for now; app is using simple rtdb auth
  }, []);

  const register = async (username, password) => {
    // basic uniqueness check
    const usersRef = ref(rtdb, 'users');
    const snapshot = await get(usersRef);
    const existing = snapshot && snapshot.val() ? snapshot.val() : {};
    for (const k of Object.keys(existing)) {
      const u = existing[k];
      if (u && u.username === username) {
        throw new Error("Username already exists");
      }
    }
    // create user
    const newUserRef = push(usersRef);
    const uid = newUserRef.key;
    const userObj = { id: uid, username, password };
    await set(newUserRef, userObj);
    persistUser(userObj);
    setUser(userObj);
    return userObj;
  };

  const login = async (username, password) => {
    const usersRef = ref(rtdb, 'users');
    const snapshot = await get(usersRef);
    const existing = snapshot && snapshot.val() ? snapshot.val() : {};
    for (const k of Object.keys(existing)) {
      const u = existing[k];
      if (u && u.username === username && u.password === password) {
        persistUser(u);
        setUser(u);
        return u;
      }
    }
    throw new Error("Invalid username/password.");
  };

  const logout = () => {
    persistUser(null);
    localStorage.removeItem("lastChat");
    setUser(null);
  };

  const value = { user, register, login, logout, initializing };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
