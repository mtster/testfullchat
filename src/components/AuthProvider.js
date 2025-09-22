// src/components/AuthProvider.js
import { rtdb } from "../firebase";
import React, { createContext, useContext, useState, useEffect } from "react";
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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  // use the already-initialized rtdb instance
  const rdb = rtdb;

  useEffect(() => {
    // try to load stored user from localStorage
    try {
      const raw = localStorage.getItem("frbs_user");
      if (raw) {
        setUser(JSON.parse(raw));
      }
    } catch (e) {
      console.error("Failed reading stored user", e);
    }
    setInitializing(false);
  }, []);

  const register = async ({ username, password }) => {
    if (!username || !password) {
      throw new Error("username and password required");
    }
    const usersRef = ref(rdb, "users");
    // check whether username exists
    const q = query(usersRef, orderByChild("username"), equalTo(username));
    const snap = await get(q);
    if (snap && snap.exists()) {
      throw new Error("username taken");
    }
    // create user
    const newUserRef = push(usersRef);
    const userId = newUserRef.key;
    const userObj = { id: userId, username, password, createdAt: Date.now() };
    await set(newUserRef, userObj);
    localStorage.setItem("frbs_user", JSON.stringify(userObj));
    setUser(userObj);
    return userObj;
  };

  const login = async ({ username, password }) => {
    if (!username || !password) {
      throw new Error("username and password required");
    }
    const usersRef = ref(rdb, "users");
    const q = query(usersRef, orderByChild("username"), equalTo(username));
    const snap = await get(q);
    if (!snap || !snap.exists()) {
      throw new Error("user not found");
    }
    // find the user object with matching password
    let found = null;
    snap.forEach((child) => {
      const val = child.val();
      if (val.username === username && val.password === password) {
        found = val;
      }
    });
    if (!found) throw new Error("invalid credentials");
    localStorage.setItem("frbs_user", JSON.stringify(found));
    setUser(found);
    return found;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("frbs_user");
    localStorage.removeItem("lastChat");
  };

  const value = { user, register, login, logout, initializing };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthProvider;
