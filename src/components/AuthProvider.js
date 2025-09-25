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

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  function persistUser(u) {
    if (!u) {
      localStorage.removeItem("frbs_user");
      setUser(null);
      return;
    }
    const normalized = { id: u.id, username: u.username };
    localStorage.setItem("frbs_user", JSON.stringify(normalized));
    setUser(normalized);
  }

  useEffect(() => {
    let mounted = true;
    (async function restoreUser() {
      try {
        const raw = localStorage.getItem("frbs_user");
        if (!raw) {
          if (mounted) setInitializing(false);
          return;
        }
        const parsed = JSON.parse(raw);
        // If parsed has an id and username, use it
        if (parsed && parsed.id && parsed.username) {
          if (mounted) persistUser(parsed);
          return;
        }
        // If parsed missing id but has username, try to resolve id from DB
        if (parsed && parsed.username) {
          try {
            const usersRef = ref(rtdb, "users");
            const q = query(usersRef, orderByChild("username"), equalTo(parsed.username));
            const snap = await get(q);
            if (snap && snap.exists()) {
              // pick the first matching user
              let found = null;
              snap.forEach((child) => {
                const v = child.val();
                if (!found && v && v.username === parsed.username) {
                  found = { id: child.key, username: v.username };
                }
              });
              if (found) {
                if (mounted) persistUser(found);
                return;
              }
            }
            // if not found, clear local stored value
            localStorage.removeItem("frbs_user");
          } catch (e) {
            console.warn("[AuthProvider] restoreUser lookup failed", e);
          }
        }
      } catch (e) {
        console.warn("[AuthProvider] restoreUser parse failed", e);
      } finally {
        if (mounted) setInitializing(false);
      }
    })();
    return () => (mounted = false);
  }, []);

  const register = async ({ username, password }) => {
    username = (username || "").trim();
    password = (password || "").trim();
    if (!username || !password) {
      throw new Error("Username and password are required.");
    }

    const usersRef = ref(rtdb, "users");
    const q = query(usersRef, orderByChild("username"), equalTo(username));
    const snap = await get(q);
    if (snap && snap.exists()) {
      throw new Error("User already exists.");
    }

    const newUserRef = push(usersRef);
    const uid = newUserRef.key;
    const payload = { username, password, createdAt: Date.now() };
    await set(newUserRef, payload);

    // --- OneSignal: attach current device playerId to newly created user (best-effort) ---
    (async function attachPlayerId(){
      try{
        const waitForPid = async (max=15, delay=1000) => {
          for (let i=0;i<max;i++){
            if (window.OneSignal && typeof window.OneSignal.getUserId === 'function'){
              try{
                const pid = await window.OneSignal.getUserId();
                if (pid) return pid;
              } catch(e){}
            }
            await new Promise(r => setTimeout(r, delay));
          }
          return null;
        };
        const pid = await waitForPid();
        if (pid) {
          await set(ref(rtdb, `users/${uid}/playerId`), pid);
          await set(ref(rtdb, `users/${uid}/playerIdAt`), Date.now());
          console.log("[AuthProvider] wrote playerId for new user:", uid, pid);
        }
      } catch (e) {
        console.warn('[AuthProvider] attachPlayerId failed', e);
      }
    })();

    const created = { id: uid, username };
    persistUser(created);
    return created;
  };

  const login = async ({ username, password }) => {
    username = (username || "").trim();
    password = (password || "").trim();
    if (!username || !password) {
      throw new Error("Username and password are required.");
    }

    const usersRef = ref(rtdb, "users");
    const q = query(usersRef, orderByChild("username"), equalTo(username));
    const snap = await get(q);
    if (!snap || !snap.exists()) {
      throw new Error("User not found.");
    }

    let found = null;
    snap.forEach((child) => {
      const v = child.val();
      if (!found && v && v.username === username && v.password === password) {
        found = { id: child.key, username: v.username };
      }
    });
    if (!found) throw new Error("Invalid username/password.");
    persistUser(found);
    return found;
  };

  const logout = () => {
    persistUser(null);
    localStorage.removeItem("lastChat");
  };

  const value = { user, register, login, logout, initializing };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
