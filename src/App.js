// src/App.js
import React from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import AuthProvider, { useAuth } from "./components/AuthProvider";
import Login from "./components/Login";
import Register from "./components/Register";
import ChatList from "./components/ChatList";
import ChatView from "./components/ChatView";
// Header intentionally not injected here to avoid duplicate header rows

function PrivateRoute({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    // Resume last chat if user returns, but only when on entry-ish routes
    // (avoid redirecting when user is already viewing a chat or other internal pages)
    if (!user) return;

    const entryPaths = ["/", "/login", "/register"];
    if (!entryPaths.includes(location.pathname)) {
      return;
    }

    const lastChat = localStorage.getItem("lastChat");
    if (lastChat) {
      navigate(`/chats/${lastChat}`, { replace: true });
    } else {
      navigate("/chats", { replace: true });
    }
  }, [user, navigate, location.pathname]);

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/chats" /> : <Navigate to="/login" />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Main chat list page: only the ChatList (full page) */}
      <Route
        path="/chats"
        element={
          <PrivateRoute>
            <ChatList />
          </PrivateRoute>
        }
      />

      {/* Full-page chat view: dedicated page for one chat */}
      <Route
        path="/chats/:chatId"
        element={
          <PrivateRoute>
            <ChatView />
          </PrivateRoute>
        }
      />

      <Route path="*" element={<div style={{ padding: 30 }}>404 - Not Found</div>} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
