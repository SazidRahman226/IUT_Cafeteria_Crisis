import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { User, ServiceState, LatencyPoint } from "../../types";
import { SERVICES } from "../../config/constants";
import {
  getServiceUrl,
  formatUptime,
  parsePrometheusMetrics,
} from "../../utils/formatters";
import { fadeUp, scaleIn, stagger } from "../../styles/animations";

export function AdminDashboard({
  user,
  token,
  onLogout,
}: {
  user: User;
  token: string;
  onLogout: () => void;
}) {
  const [services, setServices] = useState<ServiceState[]>(
    SERVICES.map((s) => ({
      ...s,
      health: null,
      metrics: null,
      isUp: false,
      lastCheck: new Date(),
    })),
  );
  const [latencyHistory, setLatencyHistory] = useState<LatencyPoint[]>([]);
  const [ordersHistory, setOrdersHistory] = useState<
    { time: string; orders: number }[]
  >([]);
  const [gatewayAlert, setGatewayAlert] = useState(false);
  const [chaosLog, setChaosLog] = useState<string[]>([]);
  const [killedServices, setKilledServices] = useState<
    Record<string, { killedAt: number; recovered: boolean }>
  >({});
  const [chaosTimers, setChaosTimers] = useState<Record<string, number>>({});
  const [revenue, setRevenue] = useState(0);
  const [ordersProcessed, setOrdersProcessed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setChaosTimers(() => {
        const t: Record<string, number> = {};
        for (const [key, info] of Object.entries(killedServices)) {
          if (!info.recovered)
            t[key] = Math.floor((Date.now() - info.killedAt) / 1000);
        }
        return t;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [killedServices]);

  useEffect(() => {
    for (const svc of services) {
      const info = killedServices[svc.key];
      if (info && !info.recovered && svc.isUp) {
        const dt = Math.floor((Date.now() - info.killedAt) / 1000);
        setKilledServices((p) => ({
          ...p,
          [svc.key]: { ...p[svc.key], recovered: true },
        }));
        setChaosLog((p) =>
          [`${svc.name} recovered after ${dt}s downtime`, ...p].slice(0, 20),
        );
      }
    }
  }, [services, killedServices]);

  const pollServices = useCallback(async () => {
    const updated = await Promise.all(
      SERVICES.map(async (svc) => {
        let health = null,
          metrics = null,
          isUp = false;
        try {
          const h = await fetch(`${getServiceUrl(svc.port)}/health`, {
            signal: AbortSignal.timeout(3000),
          });
          if (h.ok) {
            health = await h.json();
            isUp = health.status === "ok";
          }
        } catch {}
        try {
          const m = await fetch(`${getServiceUrl(svc.port)}/metrics/json`, {
            signal: AbortSignal.timeout(3000),
          });
          if (m.ok) metrics = await m.json();
        } catch {
          try {
            const m = await fetch(`${getServiceUrl(svc.port)}/metrics`, {
              signal: AbortSignal.timeout(3000),
            });
            if (m.ok) metrics = parsePrometheusMetrics(await m.text(), svc.key);
          } catch {}
        }
        return { ...svc, health, metrics, isUp, lastCheck: new Date() };
      }),
    );
    setServices(updated);
    const now = new Date().toLocaleTimeString();
    const gw = updated.find((s) => s.key === "order-gateway"),
      id = updated.find((s) => s.key === "identity-provider"),
      st = updated.find((s) => s.key === "stock-service"),
      ki = updated.find((s) => s.key === "kitchen-service"),
      no = updated.find((s) => s.key === "notification-hub");
    setLatencyHistory((p) =>
      [
        ...p,
        {
          time: now,
          gateway: gw?.metrics?.avgLatencyMs || 0,
          identity: id?.metrics?.avgLatencyMs || 0,
          stock: st?.metrics?.avgLatencyMs || 0,
          kitchen: ki?.metrics?.avgLatencyMs || 0,
          notification: no?.metrics?.avgLatencyMs || 0,
        },
      ].slice(-30),
    );
    setOrdersHistory((p) =>
      [
        ...p,
        {
          time: now,
          orders: updated.reduce(
            (s, x) => s + (x.metrics?.ordersProcessed || 0),
            0,
          ),
        },
      ].slice(-30),
    );
    setGatewayAlert(
      (gw?.metrics?.recentAvgLatencyMs || gw?.metrics?.avgLatencyMs || 0) >
        1000,
    );
  }, []);

  const fetchStatsSafe = useCallback(async () => {
    try {
      const gw = SERVICES.find((s) => s.key === "order-gateway");
      if (!gw) return;
      const [revRes, countRes] = await Promise.all([
        fetch(`${getServiceUrl(gw.port)}/api/orders/revenue`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${getServiceUrl(gw.port)}/api/orders/orderCount`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (revRes.ok) setRevenue((await revRes.json()).totalRevenue || 0);
      if (countRes.ok) setOrdersProcessed((await countRes.json()).count || 0);
    } catch {}
  }, [token]);

  useEffect(() => {
    pollServices();
    fetchStatsSafe();
    const i = setInterval(() => {
      pollServices();
      fetchStatsSafe();
    }, 5000);
    return () => clearInterval(i);
  }, [pollServices, fetchStatsSafe]);

  const killService = async (svc: ServiceState) => {
    try {
      await fetch(`${getServiceUrl(svc.port)}/chaos/kill`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      setChaosLog((p) =>
        [
          `${svc.name} killed at ${new Date().toLocaleTimeString()}`,
          ...p,
        ].slice(0, 20),
      );
      setKilledServices((p) => ({
        ...p,
        [svc.key]: { killedAt: Date.now(), recovered: false },
      }));
      [2000, 5000, 8000].forEach((d) => setTimeout(pollServices, d));
    } catch {
      setChaosLog((p) => [`Could not reach ${svc.name}`, ...p].slice(0, 20));
    }
  };

  const healthyCount = services.filter((s) => s.isUp).length;
  const totalRequests = services.reduce(
    (s, svc) => s + (svc.metrics?.requestCount || 0),
    0,
  );
  const totalErrors = services.reduce(
    (s, svc) => s + (svc.metrics?.errorCount || 0),
    0,
  );

  const statCards = [
    {
      label: "Total Requests",
      value: totalRequests,
      color: "text-blue-400",
      borderColor: "border-blue-700",
      icon: "📊",
    },
    {
      label: "Total Orders",
      value: ordersProcessed,
      color: "text-purple-400",
      borderColor: "border-purple-700",
      icon: "📦",
    },
    {
      label: "Total Errors",
      value: totalErrors,
      color: "text-red-400",
      borderColor: "border-red-700",
      icon: "❌",
    },
    {
      label: "Services Up",
      value: `${healthyCount}/5`,
      color: healthyCount === 5 ? "text-green-400" : "text-yellow-400",
      borderColor:
        healthyCount === 5 ? "border-green-700" : "border-yellow-700",
      icon: "🟢",
    },
    {
      label: "Total Revenue",
      value: `৳${revenue}`,
      color: "text-amber-400",
      borderColor: "border-amber-700",
      icon: "💰",
    },
  ];

  return (
    <div className="min-h-screen">
      {/* Gateway Alert */}
      <AnimatePresence>
        {gatewayAlert && (
          <motion.div
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-700 px-6 py-3 rounded-xl text-white font-semibold shadow-xl shadow-red-700/30"
          >
            <span className="animate-pulse mr-2">⚠️</span>Gateway avg response
            &gt; 1s!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-5 flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 sm:gap-4"
          >
            <span className="text-2xl sm:text-3xl">👑</span>
            <div className="w-px h-6 sm:h-8 bg-slate-700 hidden sm:block" />
            <div>
              <h1 className="text-base sm:text-2xl font-extrabold text-white">
                Admin Dashboard
              </h1>
              <p className="text-slate-500 text-[10px] sm:text-xs mt-0.5 hidden sm:block">
                DevSprint 2026 — IUT Cafeteria Crisis Control
              </p>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 sm:gap-4 text-sm"
          >
            <div className="bg-slate-700 border border-slate-600 px-2 sm:px-4 py-1.5 sm:py-2 rounded-xl flex items-center gap-1 sm:gap-2">
              <span className="text-slate-400 hidden sm:inline">Services:</span>
              <span
                className={`font-bold text-xs sm:text-sm ${healthyCount === 5 ? "text-green-400" : "text-yellow-400"}`}
              >
                {healthyCount}/5
              </span>
            </div>
            <span className="text-slate-400 hidden md:inline">👋 System Admin</span>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onLogout}
              className="bg-red-900/50 border border-red-700 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium text-red-400 hover:bg-red-900/70 transition-all"
            >
              ↪ <span className="hidden sm:inline">Logout</span>
            </motion.button>
          </motion.div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Summary Stats */}
        <motion.div
          variants={stagger}
          initial="initial"
          animate="animate"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4"
        >
          {statCards.map((stat) => (
            <motion.div
              key={stat.label}
              variants={scaleIn}
              className={`card p-3 sm:p-5 border-2 ${stat.borderColor} hover:scale-[1.03] transition-transform`}
            >
              <div className="text-2xl sm:text-3xl mb-1 sm:mb-2">{stat.icon}</div>
              <p className={`text-lg sm:text-2xl font-extrabold ${stat.color}`}>
                {stat.value}
              </p>
              <p className="text-[10px] sm:text-xs text-slate-500 mt-1">{stat.label}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Health Grid */}
        <motion.div {...fadeUp}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-2.5 h-2.5 bg-blue-400 rounded-full shadow-[0_0_10px_rgba(96,165,250,0.6)]" />
            <h2 className="text-xl font-extrabold text-white">
              Service Health Grid
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            {services.map((svc) => {
              const chaosInfo = killedServices[svc.key];
              const wasKilled = chaosInfo && !chaosInfo.recovered;
              const isDown = wasKilled && !svc.isUp;
              const justRecovered =
                chaosInfo && chaosInfo.recovered && svc.isUp;
              return (
                <motion.div
                  key={svc.key}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: isDown ? [1, 0.97, 1] : 1 }}
                  transition={{
                    scale: { repeat: isDown ? Infinity : 0, duration: 1.5 },
                  }}
                  className={`card p-5 text-center relative overflow-hidden border-2 ${
                    isDown
                      ? "border-red-600"
                      : justRecovered
                        ? "border-green-500"
                        : svc.isUp
                          ? "border-green-700"
                          : "border-red-700"
                  }`}
                >
                  {/* Killed Overlay */}
                  <AnimatePresence>
                    {isDown && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-10"
                      >
                        <span className="text-4xl mb-2">💀</span>
                        <span className="text-red-400 text-xs font-bold uppercase tracking-wider">
                          Service Killed
                        </span>
                        <span className="text-red-300 text-xl font-mono font-bold mt-1">
                          {chaosTimers[svc.key] || 0}s
                        </span>
                        <div className="flex gap-1 mt-2">
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce"
                            style={{ animationDelay: "0ms" }}
                          />
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce"
                            style={{ animationDelay: "150ms" }}
                          />
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce"
                            style={{ animationDelay: "300ms" }}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* Recovered badge */}
                  {justRecovered && (
                    <motion.div
                      initial={{ opacity: 1 }}
                      animate={{ opacity: 0 }}
                      transition={{ delay: 3, duration: 1 }}
                      className="absolute top-2 right-2 bg-green-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full z-20"
                    >
                      ✅ Recovered
                    </motion.div>
                  )}
                  <div
                    className={`w-4 h-4 rounded-full mx-auto mb-3 transition-all ${svc.isUp ? "bg-green-400 shadow-[0_0_12px_rgba(74,222,128,0.6)]" : "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)] animate-pulse"}`}
                  />
                  <h3 className="font-bold text-sm mb-1 text-white">
                    {svc.name}
                  </h3>
                  <p
                    className={`text-xs font-bold uppercase ${isDown ? "text-red-400" : svc.isUp ? "text-green-400" : "text-red-400"}`}
                  >
                    {isDown ? "KILLED" : svc.isUp ? "HEALTHY" : "DOWN"}
                  </p>
                  {svc.metrics && (
                    <div className="mt-3 space-y-1 text-xs text-slate-400">
                      <p>Reqs: {svc.metrics.requestCount}</p>
                      <p>Latency: {Math.round(svc.metrics.avgLatencyMs)}ms</p>
                      <p>Uptime: {formatUptime(svc.metrics.uptime)}</p>
                    </div>
                  )}
                  {svc.health?.dependencies && (
                    <div className="mt-3 flex flex-wrap gap-1 justify-center">
                      {Object.entries(svc.health.dependencies).map(
                        ([dep, info]) => (
                          <span
                            key={dep}
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${info.status === "ok" ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"}`}
                          >
                            {dep}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <motion.div {...fadeUp} className="card p-5">
            <h3 className="font-bold mb-4 text-white">
              📈 Service Latency (ms)
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={latencyHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#64748b", fontSize: 10 }}
                />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "12px",
                    color: "#e2e8f0",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="gateway"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={false}
                  name="Gateway"
                />
                <Line
                  type="monotone"
                  dataKey="identity"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="Identity"
                />
                <Line
                  type="monotone"
                  dataKey="stock"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  name="Stock"
                />
                <Line
                  type="monotone"
                  dataKey="kitchen"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  name="Kitchen"
                />
                <Line
                  type="monotone"
                  dataKey="notification"
                  stroke="#ec4899"
                  strokeWidth={2}
                  dot={false}
                  name="Notification"
                />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>
          <motion.div {...fadeUp} className="card p-5">
            <h3 className="font-bold mb-4 text-white">📦 Orders Processed</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={ordersHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#64748b", fontSize: 10 }}
                />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "12px",
                    color: "#e2e8f0",
                  }}
                />
                <Bar dataKey="orders" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* Chaos Engineering */}
        <motion.div {...fadeUp} className="card p-6 border-2 border-red-800">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-2xl">💣</span>
            <h3 className="font-extrabold text-xl text-white">
              Chaos Engineering
            </h3>
            <span className="bg-red-900/50 text-red-400 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full border border-red-700">
              Danger Zone
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-5">
            Kill a service to simulate a crash. Watch recovery in real-time.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
            {services.map((svc) => {
              const isKilled =
                killedServices[svc.key] &&
                !killedServices[svc.key].recovered &&
                !svc.isUp;
              return (
                <motion.button
                  key={svc.key}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => killService(svc)}
                  disabled={!svc.isUp || !!isKilled}
                  className={`relative px-3 sm:px-4 py-2.5 sm:py-3.5 rounded-xl text-xs sm:text-sm font-bold transition-all border-2 ${
                    isKilled
                      ? "bg-red-900/40 border-red-700 text-red-400 cursor-not-allowed"
                      : svc.isUp
                        ? "bg-red-900/30 border-red-700 text-red-400 hover:bg-red-900/50 hover:shadow-lg hover:shadow-red-600/20"
                        : "bg-slate-800 border-slate-700 text-slate-600 cursor-not-allowed"
                  }`}
                >
                  {isKilled && (
                    <div className="absolute inset-0 bg-red-900/20 rounded-xl animate-pulse" />
                  )}
                  <span className="relative z-10">
                    {isKilled ? "💀 Killed" : `☠️ Kill ${svc.name}`}
                  </span>
                </motion.button>
              );
            })}
          </div>
          {chaosLog.length > 0 && (
            <div className="bg-black/40 rounded-xl p-4 max-h-48 overflow-y-auto border border-slate-700">
              <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-2 font-bold">
                Event Timeline
              </p>
              {chaosLog.map((log, i) => (
                <motion.div
                  key={`${log}-${i}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex items-center gap-2 py-1.5 ${i > 0 ? "border-t border-slate-700" : ""}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${log.includes("recovered") ? "bg-green-500" : log.includes("killed") || log.includes("Killed") ? "bg-red-500" : "bg-yellow-500"}`}
                  />
                  <p
                    className={`text-xs font-mono ${log.includes("recovered") ? "text-green-400" : log.includes("killed") || log.includes("Killed") ? "text-red-400" : "text-yellow-400"}`}
                  >
                    {log}
                  </p>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Metrics Table */}
        <motion.div {...fadeUp} className="card p-5">
          <h3 className="font-extrabold text-lg mb-4 text-white">
            📊 Detailed Metrics
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700 uppercase text-xs tracking-wider">
                  <th className="pb-3 font-semibold">Service</th>
                  <th className="pb-3 font-semibold">Status</th>
                  <th className="pb-3 font-semibold">Requests</th>
                  <th className="pb-3 font-semibold">Errors</th>
                  <th className="pb-3 font-semibold">Latency</th>
                  <th className="pb-3 font-semibold">Orders</th>
                  <th className="pb-3 font-semibold">Uptime</th>
                  <th className="pb-3 font-semibold">Extra</th>
                </tr>
              </thead>
              <tbody>
                {services.map((svc) => (
                  <tr
                    key={svc.key}
                    className="border-b border-slate-700/50 hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="py-3.5 font-bold text-white">{svc.name}</td>
                    <td className="py-3.5">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${svc.isUp ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"}`}
                      >
                        {svc.isUp ? "UP" : "DOWN"}
                      </span>
                    </td>
                    <td className="py-3.5 font-medium">
                      {svc.metrics?.requestCount || 0}
                    </td>
                    <td className="py-3.5 text-red-400 font-medium">
                      {svc.metrics?.errorCount || 0}
                    </td>
                    <td className="py-3.5 font-medium">
                      {Math.round(svc.metrics?.avgLatencyMs || 0)}ms
                    </td>
                    <td className="py-3.5 font-medium">
                      {svc.metrics?.ordersProcessed || "—"}
                    </td>
                    <td className="py-3.5 text-slate-400">
                      {formatUptime(svc.metrics?.uptime || 0)}
                    </td>
                    <td className="py-3.5 text-slate-500 text-xs">
                      {svc.metrics?.connectedClients !== undefined &&
                        `WS: ${svc.metrics.connectedClients}`}
                      {svc.metrics?.kitchenProcessingTimeMs !== undefined &&
                        `Cook: ${svc.metrics.kitchenProcessingTimeMs}ms`}
                      {svc.metrics?.notificationsSent !== undefined &&
                        `Sent: ${svc.metrics.notificationsSent}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
