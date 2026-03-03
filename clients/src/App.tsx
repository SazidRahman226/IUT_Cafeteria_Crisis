import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, LoginRole } from "./types";
import { AUTH_URL } from "./config/constants";
import { apiFetch } from "./utils/api";
import { AdminDashboard } from "./pages/Admin/AdminDashboard";
import { KitchenDashboard } from "./pages/Kitchen/KitchenDashboard";
import { StudentDashboard } from "./pages/Student/StudentDashboard";
import { LoginScreen } from "./pages/Login/LoginScreen";

// ==========================================
// Root App
// ==========================================
export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const s = localStorage.getItem("cafeteria_user");
    return s ? JSON.parse(s) : null;
  });
  const [token, setToken] = useState(
    () => localStorage.getItem("cafeteria_token") || "",
  );
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const handleLogin = async (
    studentId: string,
    password: string,
    selectedRole: LoginRole,
  ) => {
    setLoginLoading(true);
    setLoginError("");
    try {
      const data = await apiFetch(`${AUTH_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, password }),
      });
      const userRole = data.user.role as string;
      const allowed: Record<LoginRole, string[]> = {
        student: ["student"],
        staff: ["staff", "admin"],
        admin: ["admin"],
      };
      if (!allowed[selectedRole].includes(userRole)) {
        const labels: Record<LoginRole, string> = {
          student: "Student",
          staff: "Staff",
          admin: "Admin",
        };
        setLoginError(
          `Access denied. This account is not a ${labels[selectedRole]} account.`,
        );
        return;
      }
      setToken(data.accessToken);
      setUser(data.user);
      localStorage.setItem("cafeteria_token", data.accessToken);
      localStorage.setItem("cafeteria_user", JSON.stringify(data.user));
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };
  const handleLogout = () => {
    setUser(null);
    setToken("");
    localStorage.removeItem("cafeteria_token");
    localStorage.removeItem("cafeteria_user");
  };

  if (!user || !token)
    return (
      <LoginScreen
        onLogin={handleLogin}
        loading={loginLoading}
        error={loginError}
      />
    );
  if (user.role === "admin")
    return <AdminDashboard user={user} token={token} onLogout={handleLogout} />;
  if (user.role === "staff")
    return (
      <KitchenDashboard user={user} token={token} onLogout={handleLogout} />
    );
  return <StudentDashboard user={user} token={token} onLogout={handleLogout} />;
}
