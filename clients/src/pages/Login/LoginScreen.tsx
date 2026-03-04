import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LoginRole } from "../../types";

const ROLE_CONFIG: Record<
  LoginRole,
  {
    icon: string;
    title: string;
    subtitle: string;
    placeholder: string;
    idLabel: string;
    accent: string;
    btnClass: string;
    demo: { id: string; label: string; emoji: string }[];
  }
> = {
  student: {
    icon: "🍽️",
    title: "IUT Cafeteria",
    subtitle: "Order your favourite meals",
    placeholder: "student1",
    idLabel: "Student ID",
    accent: "bg-blue-600",
    btnClass: "btn-primary",
    demo: [
      { id: "student1", label: "student1", emoji: "👩‍🎓" },
      { id: "student2", label: "student2", emoji: "👨‍🎓" },
    ],
  },
  staff: {
    icon: "👨‍🍳",
    title: "Kitchen Staff",
    subtitle: "Manage orders & delivery",
    placeholder: "staff1",
    idLabel: "Staff ID",
    accent: "bg-amber-600",
    btnClass: "btn-orange",
    demo: [{ id: "staff1", label: "staff1", emoji: "👨‍🍳" }],
  },
  admin: {
    icon: "🛡️",
    title: "Admin Panel",
    subtitle: "System monitoring & control",
    placeholder: "admin1",
    idLabel: "Admin ID",
    accent: "bg-indigo-600",
    btnClass: "btn-indigo",
    demo: [{ id: "admin1", label: "admin1", emoji: "🛡️" }],
  },
};

export function LoginScreen({
  onLogin,
  loading,
  error,
}: {
  onLogin: (id: string, pw: string, role: LoginRole) => void;
  loading: boolean;
  error: string;
}) {
  const [activeRole, setActiveRole] = useState<LoginRole>("student");
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const cfg = ROLE_CONFIG[activeRole];

  const roleTabs: { key: LoginRole; label: string }[] = [
    { key: "student", label: "Student" },
    { key: "staff", label: "Staff" },
    { key: "admin", label: "Admin" },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{ x: [0, 100, 0], y: [0, -50, 0] }}
          transition={{ duration: 20, repeat: Infinity }}
          className="absolute top-20 left-20 w-72 h-72 bg-blue-600/20 rounded-full blur-3xl"
        />
        <motion.div
          animate={{ x: [0, -80, 0], y: [0, 60, 0] }}
          transition={{ duration: 25, repeat: Infinity }}
          className="absolute bottom-20 right-20 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl"
        />
        <motion.div
          animate={{ x: [0, 50, 0], y: [0, -80, 0] }}
          transition={{ duration: 18, repeat: Infinity }}
          className="absolute top-1/2 left-1/2 w-64 h-64 bg-amber-600/10 rounded-full blur-3xl"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, type: "spring" }}
        className="card p-6 sm:p-10 w-full max-w-md relative z-10"
      >
        {/* Role Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-slate-800 mb-8">
          {roleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveRole(tab.key);
                setStudentId("");
                setPassword("");
              }}
              className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-300 ${
                activeRole === tab.key
                  ? `${cfg.accent} text-white shadow-lg`
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Title */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-center mb-8"
        >
          <motion.div
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="text-5xl sm:text-6xl mb-4 inline-block"
          >
            {cfg.icon}
          </motion.div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            {cfg.title}
          </h1>
          <p className="text-slate-400 text-sm mt-2">{cfg.subtitle}</p>
        </motion.div>

        <motion.form
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          onSubmit={(e) => {
            e.preventDefault();
            onLogin(studentId, password, activeRole);
          }}
          className="space-y-5"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
              {cfg.idLabel}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg">
                👤
              </span>
              <input
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="input-field w-full pl-11 pr-4 py-3.5 rounded-xl"
                placeholder={cfg.placeholder}
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg">
                🔒
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field w-full pl-11 pr-4 py-3.5 rounded-xl"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-red-900/40 border border-red-700 text-red-300 rounded-xl px-4 py-3 text-sm flex items-center gap-2"
              >
                <span>⚠️</span>
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            whileHover={{
              scale: 1.02,
              boxShadow: "0 8px 30px rgba(37, 99, 235, 0.3)",
            }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={loading}
            className={`${cfg.btnClass} w-full py-4 rounded-xl text-white font-bold text-lg disabled:opacity-50 transition-all`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                />
                Signing in...
              </span>
            ) : (
              "Sign In →"
            )}
          </motion.button>

          <div className="flex items-center gap-3 pt-2">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-slate-500 text-xs">DEMO ACCOUNTS</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>
          <div className="flex gap-2">
            {cfg.demo.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setStudentId(d.id);
                  setPassword("password123");
                }}
                className="flex-1 bg-slate-800 border border-slate-700 px-3 py-2.5 rounded-xl text-xs text-slate-300 hover:bg-slate-700 transition-all"
              >
                {d.emoji} {d.label}
              </button>
            ))}
          </div>
        </motion.form>
      </motion.div>
    </div>
  );
}
