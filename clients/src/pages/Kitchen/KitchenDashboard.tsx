import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Order, KitchenPage, MenuItem } from "../../types";
import { GATEWAY_URL, WS_URL, STOCK_URL } from "../../config/constants";
import { apiFetch } from "../../utils/api";
import { fadeUp, stagger, fadeIn, scaleIn } from "../../styles/animations";
import { OtpCountdown } from "../../components/common/OtpCountdown";

export function KitchenDashboard({
  user,
  token,
  onLogout,
}: {
  user: User;
  token: string;
  onLogout: () => void;
}) {
  const [page, setPage] = useState<KitchenPage>("orders");
  const [notification, setNotification] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    wsRef.current = ws;
    ws.onmessage = () => {
      setNotification("New order update received!");
      setTimeout(() => setNotification(""), 3000);
    };
    ws.onclose = () =>
      setTimeout(() => {
        try {
          wsRef.current = new WebSocket(`${WS_URL}?token=${token}`);
        } catch {}
      }, 3000);
    return () => ws.close();
  }, [token]);

  const navItems: { key: KitchenPage; label: string; emoji: string }[] = [
    { key: "orders", label: "Orders", emoji: "📋" },
    { key: "verify", label: "Verify & Deliver", emoji: "✅" },
    { key: "items", label: "Item Management", emoji: "📦" },
    { key: "delivered", label: "Delivered History", emoji: "📊" },
  ];

  return (
    <div className="min-h-screen">
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -50, x: "-50%" }}
            className="fixed top-4 left-1/2 z-50 card shadow-2xl border border-amber-600 px-6 py-3 rounded-xl text-sm font-medium text-white"
          >
            <span className="mr-2">🔔</span>
            {notification}
          </motion.div>
        )}
      </AnimatePresence>

      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="text-3xl"
            >
              👨‍🍳
            </motion.div>
            <div>
              <h1 className="text-xl font-extrabold text-white tracking-tight">
                Kitchen Dashboard
              </h1>
              <p className="text-xs text-slate-400">
                Staff:{" "}
                <span className="text-amber-400 font-semibold">
                  {user.name}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {navItems.map((item) => (
              <motion.button
                key={item.key}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setPage(item.key)}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
                  page === item.key
                    ? "bg-amber-600 text-white shadow-lg shadow-amber-600/25"
                    : "bg-slate-700 border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-600"
                }`}
              >
                {item.emoji} {item.label}
              </motion.button>
            ))}
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onLogout}
            className="bg-red-900/50 border border-red-700 px-4 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-900/70 transition-all"
          >
            ↪ Logout
          </motion.button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {page === "orders" && (
            <KitchenOrdersPage key="orders" token={token} />
          )}
          {page === "verify" && (
            <VerifyDeliveryPage key="verify" token={token} />
          )}
          {page === "items" && <ItemManagementPage key="items" token={token} />}
          {page === "delivered" && (
            <DeliveredPage key="delivered" token={token} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==========================================
// KITCHEN — ORDERS PAGE
// ==========================================
function KitchenOrdersPage({ token }: { token: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [actionMsg, setActionMsg] = useState<{
    id: string;
    msg: string;
    ok: boolean;
  } | null>(null);
  const [deliverOtp, setDeliverOtp] = useState<Record<string, string>>({});
  const [showDeliverInput, setShowDeliverInput] = useState<
    Record<string, boolean>
  >({});

  const fetchOrders = useCallback(async () => {
    try {
      const data = await apiFetch(`${GATEWAY_URL}/api/staff/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setOrders(data);
    } catch (err: any) {
      console.error("Fetch orders failed:", err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchOrders();
    const i = setInterval(fetchOrders, 5000);
    return () => clearInterval(i);
  }, [fetchOrders]);

  const markReady = async (orderId: string) => {
    setActionLoading((p) => ({ ...p, [orderId]: true }));
    try {
      await apiFetch(`${GATEWAY_URL}/api/staff/orders/${orderId}/ready`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setActionMsg({ id: orderId, msg: "Order marked as Ready!", ok: true });
      fetchOrders();
    } catch (err: any) {
      setActionMsg({ id: orderId, msg: err.message, ok: false });
    } finally {
      setActionLoading((p) => ({ ...p, [orderId]: false }));
      setTimeout(() => setActionMsg(null), 3000);
    }
  };

  const deliverOrder = async (orderId: string) => {
    const otp = deliverOtp[orderId];
    if (!otp) return;
    setActionLoading((p) => ({ ...p, [orderId]: true }));
    try {
      await apiFetch(`${GATEWAY_URL}/api/orders/${orderId}/verify-delivery`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ otp }),
      });
      setActionMsg({
        id: orderId,
        msg: "Order delivered successfully!",
        ok: true,
      });
      setDeliverOtp((p) => {
        const n = { ...p };
        delete n[orderId];
        return n;
      });
      setShowDeliverInput((p) => {
        const n = { ...p };
        delete n[orderId];
        return n;
      });
      fetchOrders();
    } catch (err: any) {
      setActionMsg({ id: orderId, msg: err.message, ok: false });
    } finally {
      setActionLoading((p) => ({ ...p, [orderId]: false }));
      setTimeout(() => setActionMsg(null), 4000);
    }
  };

  const tabs = ["ALL", "IN_KITCHEN", "READY", "DELIVERED"];
  const tabLabels: Record<string, string> = {
    ALL: "All",
    IN_KITCHEN: "In Kitchen",
    READY: "Ready",
    DELIVERED: "Delivered",
  };
  const statusColors: Record<string, string> = {
    PENDING: "bg-yellow-900/40 text-yellow-400 border-yellow-700",
    STOCK_VERIFIED: "bg-blue-900/40 text-blue-400 border-blue-700",
    IN_KITCHEN: "bg-purple-900/40 text-purple-400 border-purple-700",
    READY: "bg-green-900/40 text-green-400 border-green-700",
    DELIVERED: "bg-emerald-900/40 text-emerald-400 border-emerald-700",
    FAILED: "bg-red-900/40 text-red-400 border-red-700",
  };
  const filteredOrders =
    activeTab === "ALL" ? orders : orders.filter((o) => o.status === activeTab);

  return (
    <motion.div {...fadeIn}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-extrabold text-white">Order Management</h2>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={fetchOrders}
          className="bg-slate-700 border border-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-slate-600 transition-all font-medium"
        >
          🔄 Refresh
        </motion.button>
      </div>
      <div className="flex gap-2 mb-6">
        {tabs.map((tab) => (
          <motion.button
            key={tab}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${activeTab === tab ? "bg-amber-600 text-white shadow-lg shadow-amber-600/25" : "bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700"}`}
          >
            {tabLabels[tab] || tab}
            <span className="ml-2 text-xs opacity-70">
              (
              {tab === "ALL"
                ? orders.length
                : orders.filter((o) => o.status === tab).length}
              )
            </span>
          </motion.button>
        ))}
      </div>
      {loading ? (
        <div className="text-center py-20 text-slate-400">
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="inline-block w-8 h-8 border-2 border-slate-600 border-t-amber-400 rounded-full"
          />
          <p className="mt-4">Loading orders...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <motion.div {...fadeUp} className="text-center py-20 text-slate-500">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-lg font-semibold">No orders found</p>
        </motion.div>
      ) : (
        <motion.div
          variants={stagger}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {filteredOrders.map((order) => (
            <motion.div
              key={order.orderId}
              variants={fadeUp as any}
              whileHover={{ y: -4 }}
              className="card p-5 hover:border-amber-600/20 transition-colors"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-mono text-xs text-slate-500">
                    #{order.orderId.slice(0, 8)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Student: {order.studentId}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold border ${statusColors[order.status] || "bg-slate-700 text-slate-400"}`}
                >
                  {order.status}
                </span>
              </div>
              <div className="space-y-1 mb-3">
                {order.items.map((item, j) => (
                  <div key={j} className="flex justify-between text-sm">
                    <span className="text-slate-300">
                      {item.name}{" "}
                      <span className="text-slate-500">x{item.quantity}</span>
                    </span>
                    <span className="text-slate-400">
                      ৳{item.price * item.quantity}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-slate-700">
                <span className="text-xs text-slate-500">
                  {new Date(order.createdAt).toLocaleString()}
                </span>
                <span className="font-bold text-white">
                  ৳{order.totalAmount}
                </span>
              </div>

              {/* Action Message */}
              <AnimatePresence>
                {actionMsg && actionMsg.id === order.orderId && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`mt-3 rounded-xl px-3 py-2 text-xs font-medium ${actionMsg.ok ? "bg-green-900/30 border border-green-700 text-green-400" : "bg-red-900/30 border border-red-700 text-red-400"}`}
                  >
                    {actionMsg.ok ? "✅ " : "❌ "}
                    {actionMsg.msg}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Mark Ready Button for IN_KITCHEN orders */}
              {order.status === "IN_KITCHEN" && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => markReady(order.orderId)}
                  disabled={actionLoading[order.orderId]}
                  className="mt-3 w-full btn-green py-3 rounded-xl text-white font-bold text-sm disabled:opacity-50"
                >
                  {actionLoading[order.orderId] ? (
                    <span className="flex items-center justify-center gap-2">
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                        className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                      />
                      Processing...
                    </span>
                  ) : (
                    "✅ Mark as Ready"
                  )}
                </motion.button>
              )}

              {/* Deliver Button for READY orders */}
              {order.status === "READY" && (
                <div className="mt-3 space-y-2">
                  {!showDeliverInput[order.orderId] ? (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() =>
                        setShowDeliverInput((p) => ({
                          ...p,
                          [order.orderId]: true,
                        }))
                      }
                      className="w-full bg-indigo-600 hover:bg-indigo-500 py-3 rounded-xl text-white font-bold text-sm transition-all"
                    >
                      📦 Deliver Order
                    </motion.button>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="space-y-2"
                    >
                      <input
                        type="text"
                        value={deliverOtp[order.orderId] || ""}
                        onChange={(e) =>
                          setDeliverOtp((p) => ({
                            ...p,
                            [order.orderId]: e.target.value,
                          }))
                        }
                        className="input-field w-full px-4 py-2.5 rounded-xl text-center text-lg font-mono tracking-[0.4em]"
                        placeholder="Enter OTP"
                        maxLength={6}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setShowDeliverInput((p) => ({
                              ...p,
                              [order.orderId]: false,
                            }));
                            setDeliverOtp((p) => {
                              const n = { ...p };
                              delete n[order.orderId];
                              return n;
                            });
                          }}
                          className="flex-1 bg-slate-700 border border-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-600 transition-all"
                        >
                          Cancel
                        </button>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => deliverOrder(order.orderId)}
                          disabled={
                            actionLoading[order.orderId] ||
                            !deliverOtp[order.orderId]
                          }
                          className="flex-1 btn-green py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-50"
                        >
                          {actionLoading[order.orderId] ? (
                            <span className="flex items-center justify-center gap-2">
                              <motion.span
                                animate={{ rotate: 360 }}
                                transition={{
                                  duration: 1,
                                  repeat: Infinity,
                                  ease: "linear",
                                }}
                                className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                              />
                            </span>
                          ) : (
                            "✅ Verify & Deliver"
                          )}
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}

// ==========================================
// KITCHEN — VERIFY & DELIVER PAGE
// ==========================================
function VerifyDeliveryPage({ token }: { token: string }) {
  const [orderId, setOrderId] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [readyOrders, setReadyOrders] = useState<Order[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOrders = useMemo(() => {
    if (!orderId.trim()) return readyOrders;
    const q = orderId.toLowerCase();
    return readyOrders.filter(
      (o) =>
        o.orderId.toLowerCase().includes(q) ||
        o.studentId.toLowerCase().includes(q) ||
        o.items.some((i) => i.name.toLowerCase().includes(q)),
    );
  }, [orderId, readyOrders]);

  const fetchReadyOrders = useCallback(async () => {
    try {
      const data = await apiFetch(
        `${GATEWAY_URL}/api/staff/orders?status=READY`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setReadyOrders(data);
    } catch {}
  }, [token]);

  useEffect(() => {
    fetchReadyOrders();
    const i = setInterval(fetchReadyOrders, 5000);
    return () => clearInterval(i);
  }, [fetchReadyOrders]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId || !otp) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await apiFetch(
        `${GATEWAY_URL}/api/orders/${orderId}/verify-delivery`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ otp }),
        },
      );
      setResult({
        success: true,
        message: `Order ${data.orderId} delivered successfully to ${data.studentId}! Amount: ৳${data.totalAmount}`,
      });
      setOrderId("");
      setOtp("");
      fetchReadyOrders();
    } catch (err: any) {
      setResult({ success: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const selectOrder = (id: string) => {
    setOrderId(id);
    setShowSuggestions(false);
  };

  return (
    <motion.div {...fadeIn}>
      <h2 className="text-xl font-extrabold text-white mb-6">
        Verify & Deliver
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div {...scaleIn} className="card p-6">
          <h3 className="text-base font-bold mb-4 text-white">
            🔐 OTP Verification
          </h3>
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="relative">
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Order Number
              </label>
              <input
                ref={inputRef}
                type="text"
                value={orderId}
                onChange={(e) => {
                  setOrderId(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                className="input-field w-full px-4 py-3 rounded-xl"
                placeholder="Type order ID, student name or item..."
                required
              />
              <AnimatePresence>
                {showSuggestions && filteredOrders.length > 0 && (
                  <motion.div
                    ref={suggestionsRef}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-600 bg-slate-800 shadow-xl"
                  >
                    {filteredOrders.map((order) => (
                      <div
                        key={order.orderId}
                        onClick={() => selectOrder(order.orderId)}
                        className="px-4 py-2.5 cursor-pointer border-b border-slate-700 last:border-b-0 hover:bg-slate-700 transition-colors"
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-amber-400">
                              #{order.orderId.slice(0, 8)}
                            </span>
                            <span className="text-xs text-slate-500">•</span>
                            <span className="text-xs text-slate-300">
                              {order.studentId}
                            </span>
                          </div>
                          <span className="text-xs font-semibold text-slate-400">
                            ৳{order.totalAmount}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {order.items.map((i) => i.name).join(", ")}
                        </p>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Student OTP
              </label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="input-field w-full px-4 py-3 rounded-xl text-center text-2xl font-mono tracking-[0.5em]"
                placeholder="000000"
                maxLength={6}
                required
              />
            </div>
            <AnimatePresence>
              {result && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`rounded-xl px-4 py-3 text-sm ${result.success ? "bg-green-900/30 border border-green-700 text-green-400" : "bg-red-900/30 border border-red-700 text-red-400"}`}
                >
                  {result.success ? "✅ " : "❌ "}
                  {result.message}
                </motion.div>
              )}
            </AnimatePresence>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={loading}
              className="btn-green w-full py-3.5 rounded-xl text-white font-bold text-base disabled:opacity-50"
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
                  Verifying...
                </span>
              ) : (
                "✅ Verify & Deliver"
              )}
            </motion.button>
          </form>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="card p-6"
        >
          <h3 className="text-base font-bold mb-4 flex items-center gap-2 text-white">
            🟢 Ready Orders{" "}
            <span className="ml-auto text-xs bg-green-900/50 text-green-400 px-2.5 py-1 rounded-full font-bold border border-green-700">
              {readyOrders.length}
            </span>
          </h3>
          {readyOrders.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="text-4xl mb-3"
              >
                📭
              </motion.div>
              <p className="text-sm">No orders ready for delivery</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {readyOrders.map((order) => (
                <motion.div
                  key={order.orderId}
                  whileHover={{ scale: 1.02 }}
                  onClick={() => setOrderId(order.orderId)}
                  className="bg-slate-800 rounded-xl p-3 cursor-pointer hover:bg-slate-700 transition-all border border-slate-700"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-mono text-sm font-bold text-amber-400">
                        #{order.orderId.slice(0, 8)}
                      </p>
                      <p className="text-xs text-slate-400">
                        Student: {order.studentId}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm text-white">
                        ৳{order.totalAmount}
                      </p>
                      <p className="text-xs text-slate-500">
                        {order.items.length} items
                      </p>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {order.items.map((i) => i.name).join(", ")}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

// ==========================================
// KITCHEN — ITEM MANAGEMENT PAGE
// ==========================================
function ItemManagementPage({ token }: { token: string }) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [disableItem, setDisableItem] = useState<MenuItem | null>(null);
  const [disableReason, setDisableReason] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newQty, setNewQty] = useState("");

  const fetchItems = useCallback(async () => {
    try {
      setItems(await apiFetch(`${STOCK_URL}/stock`));
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const showMsg = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(""), 3000);
  };
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch(`${STOCK_URL}/admin/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newName,
          description: newDesc,
          price: parseFloat(newPrice),
          category: newCategory,
          imageUrl: newImageUrl || "🍽️",
          availableQty: parseInt(newQty) || 0,
        }),
      });
      showMsg("Item added successfully!");
      setShowAddForm(false);
      setNewName("");
      setNewDesc("");
      setNewPrice("");
      setNewCategory("");
      setNewImageUrl("");
      setNewQty("");
      fetchItems();
    } catch (err: any) {
      showMsg(`Error: ${err.message}`);
    }
  };
  const handleUpdateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;
    try {
      await apiFetch(`${STOCK_URL}/admin/items/${editItem.itemId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editItem.name,
          description: editItem.description,
          price: editItem.price,
          category: editItem.category,
          imageUrl: editItem.imageUrl,
          availableQty: editItem.availableQty,
        }),
      });
      showMsg("Item updated!");
      setEditItem(null);
      fetchItems();
    } catch (err: any) {
      showMsg(`Error: ${err.message}`);
    }
  };
  const handleDeleteItem = async (itemId: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;
    try {
      await apiFetch(`${STOCK_URL}/admin/items/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      showMsg("Item deleted!");
      fetchItems();
    } catch (err: any) {
      showMsg(`Error: ${err.message}`);
    }
  };
  const handleDisable = async () => {
    if (!disableItem) return;
    try {
      await apiFetch(`${STOCK_URL}/admin/items/${disableItem.itemId}/disable`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: disableReason || "Disabled by staff" }),
      });
      showMsg(`${disableItem.name} disabled!`);
      setDisableItem(null);
      setDisableReason("");
      fetchItems();
    } catch (err: any) {
      showMsg(`Error: ${err.message}`);
    }
  };
  const handleEnable = async (itemId: string) => {
    try {
      await apiFetch(`${STOCK_URL}/admin/items/${itemId}/enable`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      showMsg("Item enabled!");
      fetchItems();
    } catch (err: any) {
      showMsg(`Error: ${err.message}`);
    }
  };

  return (
    <motion.div {...fadeIn}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-extrabold text-white">
          📦 Item Management
        </h2>
        <div className="flex gap-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={fetchItems}
            className="bg-slate-700 border border-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-slate-600 transition-all font-medium"
          >
            🔄 Refresh
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowAddForm(true)}
            className="btn-primary px-5 py-2.5 rounded-xl text-white font-bold text-sm"
          >
            + Add Item
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`mb-4 card px-4 py-3 text-sm font-medium ${actionMsg.startsWith("Error") ? "text-red-400 border-red-700" : "text-green-400 border-green-700"}`}
          >
            {actionMsg.startsWith("Error") ? "❌ " : "✅ "}
            {actionMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Item Modal */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowAddForm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="card p-6 w-full max-w-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-4 text-white">
                ➕ Add New Item
              </h3>
              <form onSubmit={handleAddItem} className="space-y-3">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="input-field w-full px-4 py-2.5 rounded-xl"
                  placeholder="Item Name"
                  required
                />
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="input-field w-full px-4 py-2.5 rounded-xl"
                  placeholder="Description"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    step="0.01"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="input-field w-full px-4 py-2.5 rounded-xl"
                    placeholder="Price (৳)"
                    required
                  />
                  <input
                    type="text"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="input-field w-full px-4 py-2.5 rounded-xl"
                    placeholder="Category"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    className="input-field w-full px-4 py-2.5 rounded-xl"
                    placeholder="Emoji (e.g. 🍔)"
                  />
                  <input
                    type="number"
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    className="input-field w-full px-4 py-2.5 rounded-xl"
                    placeholder="Quantity"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="flex-1 bg-slate-700 border border-slate-600 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-600 transition-all"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    className="flex-1 btn-primary px-4 py-2.5 rounded-xl text-white font-bold text-sm"
                  >
                    Add Item
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Item Modal */}
      <AnimatePresence>
        {editItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setEditItem(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="card p-6 w-full max-w-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-4 text-white">
                ✏️ Edit Item
              </h3>
              <form onSubmit={handleUpdateItem} className="space-y-3">
                <input
                  type="text"
                  value={editItem.name}
                  onChange={(e) =>
                    setEditItem({ ...editItem, name: e.target.value })
                  }
                  className="input-field w-full px-4 py-2.5 rounded-xl"
                  placeholder="Item Name"
                  required
                />
                <input
                  type="text"
                  value={editItem.description}
                  onChange={(e) =>
                    setEditItem({ ...editItem, description: e.target.value })
                  }
                  className="input-field w-full px-4 py-2.5 rounded-xl"
                  placeholder="Description"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    step="0.01"
                    value={editItem.price}
                    onChange={(e) =>
                      setEditItem({
                        ...editItem,
                        price: parseFloat(e.target.value),
                      })
                    }
                    className="input-field w-full px-4 py-2.5 rounded-xl"
                    placeholder="Price"
                    required
                  />
                  <input
                    type="text"
                    value={editItem.category}
                    onChange={(e) =>
                      setEditItem({ ...editItem, category: e.target.value })
                    }
                    className="input-field w-full px-4 py-2.5 rounded-xl"
                    placeholder="Category"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={editItem.imageUrl}
                    onChange={(e) =>
                      setEditItem({ ...editItem, imageUrl: e.target.value })
                    }
                    className="input-field w-full px-4 py-2.5 rounded-xl"
                    placeholder="Emoji"
                  />
                  <input
                    type="number"
                    value={editItem.availableQty}
                    onChange={(e) =>
                      setEditItem({
                        ...editItem,
                        availableQty: parseInt(e.target.value),
                      })
                    }
                    className="input-field w-full px-4 py-2.5 rounded-xl"
                    placeholder="Quantity"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditItem(null)}
                    className="flex-1 bg-slate-700 border border-slate-600 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-600 transition-all"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    className="flex-1 btn-primary px-4 py-2.5 rounded-xl text-white font-bold text-sm"
                  >
                    Save Changes
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Disable Reason Modal */}
      <AnimatePresence>
        {disableItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setDisableItem(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="card p-6 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-2 text-white">
                ⚠️ Disable {disableItem.name}
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                This item will be visible but not orderable.
              </p>
              <input
                type="text"
                value={disableReason}
                onChange={(e) => setDisableReason(e.target.value)}
                className="input-field w-full px-4 py-2.5 rounded-xl mb-4"
                placeholder="Reason (e.g. Machine failure)"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setDisableItem(null)}
                  className="flex-1 bg-slate-700 border border-slate-600 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-600 transition-all"
                >
                  Cancel
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleDisable}
                  className="flex-1 btn-danger px-4 py-2.5 rounded-xl text-white font-bold text-sm"
                >
                  Disable Item
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Items Table */}
      {loading ? (
        <div className="text-center py-20 text-slate-400">
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="inline-block w-8 h-8 border-2 border-slate-600 border-t-blue-400 rounded-full"
          />
          <p className="mt-4">Loading items...</p>
        </div>
      ) : (
        <motion.div {...fadeUp} className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700 uppercase text-xs tracking-wider">
                  <th className="p-4 font-semibold">Item</th>
                  <th className="p-4 font-semibold">Category</th>
                  <th className="p-4 font-semibold">Price</th>
                  <th className="p-4 font-semibold">Stock</th>
                  <th className="p-4 font-semibold">Status</th>
                  <th className="p-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.itemId}
                    className="border-b border-slate-700/50 hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{item.imageUrl}</span>
                        <div>
                          <p className="font-semibold text-white">
                            {item.name}
                          </p>
                          <p className="text-xs text-slate-500 max-w-[200px] truncate">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-slate-400">{item.category}</td>
                    <td className="p-4 font-bold text-amber-400">
                      ৳{item.price}
                    </td>
                    <td className="p-4">
                      <span
                        className={`text-sm font-bold ${item.availableQty > 20 ? "text-green-400" : item.availableQty > 0 ? "text-yellow-400" : "text-red-400"}`}
                      >
                        {item.availableQty}
                      </span>
                    </td>
                    <td className="p-4">
                      {item.isEnabled ? (
                        <span className="text-xs px-3 py-1 rounded-full bg-green-900/40 text-green-400 border border-green-700 font-semibold">
                          Enabled
                        </span>
                      ) : (
                        <div>
                          <span className="text-xs px-3 py-1 rounded-full bg-red-900/40 text-red-400 border border-red-700 font-semibold">
                            Disabled
                          </span>
                          {item.disabledReason && (
                            <p className="text-[10px] text-red-400/60 mt-1">
                              {item.disabledReason}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2 justify-end">
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setEditItem({ ...item })}
                          className="bg-slate-700 border border-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-600 transition-all"
                        >
                          Edit
                        </motion.button>
                        {item.isEnabled ? (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setDisableItem(item)}
                            className="bg-yellow-900/30 border border-yellow-700 text-yellow-400 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-yellow-900/50 transition-all"
                          >
                            Disable
                          </motion.button>
                        ) : (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleEnable(item.itemId)}
                            className="bg-green-900/30 border border-green-700 text-green-400 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-900/50 transition-all"
                          >
                            Enable
                          </motion.button>
                        )}
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleDeleteItem(item.itemId)}
                          className="bg-red-900/30 border border-red-700 text-red-400 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-900/50 transition-all"
                        >
                          Delete
                        </motion.button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

// ==========================================
// KITCHEN — DELIVERED HISTORY PAGE
// ==========================================
function DeliveredPage({ token }: { token: string }) {
  const [delivered, setDelivered] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalRevenue, setTotalRevenue] = useState(0);

  const fetchDelivered = useCallback(async () => {
    try {
      const [deliveredData, revenueData] = await Promise.all([
        apiFetch(`${GATEWAY_URL}/api/staff/delivered`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        apiFetch(`${GATEWAY_URL}/api/revenue/total`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setDelivered(deliveredData);
      setTotalRevenue(revenueData.totalRevenue || 0);
    } catch (err: any) {
      console.error("Fetch delivered failed:", err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDelivered();
  }, [fetchDelivered]);

  return (
    <motion.div {...fadeIn}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-extrabold text-white">
          📊 Delivered History
        </h2>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={fetchDelivered}
          className="bg-slate-700 border border-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-slate-600 transition-all font-medium"
        >
          🔄 Refresh
        </motion.button>
      </div>
      <motion.div
        variants={stagger}
        initial="initial"
        animate="animate"
        className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"
      >
        <motion.div
          variants={scaleIn}
          className="card p-5 border-green-700 hover:scale-[1.03] transition-transform"
        >
          <p className="text-sm text-slate-400 mb-1">💰 Total Revenue</p>
          <p className="text-2xl font-extrabold text-green-400">
            ৳{totalRevenue.toFixed(2)}
          </p>
        </motion.div>
        <motion.div
          variants={scaleIn}
          className="card p-5 border-emerald-700 hover:scale-[1.03] transition-transform"
        >
          <p className="text-sm text-slate-400 mb-1">📦 Total Delivered</p>
          <p className="text-2xl font-extrabold text-white">
            {delivered.length}
          </p>
        </motion.div>
        <motion.div
          variants={scaleIn}
          className="card p-5 border-amber-700 hover:scale-[1.03] transition-transform"
        >
          <p className="text-sm text-slate-400 mb-1">📈 Avg Order Value</p>
          <p className="text-2xl font-extrabold text-white">
            ৳
            {delivered.length > 0
              ? (totalRevenue / delivered.length).toFixed(2)
              : "0"}
          </p>
        </motion.div>
      </motion.div>
      {loading ? (
        <div className="text-center py-20 text-slate-400">
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="inline-block w-8 h-8 border-2 border-slate-600 border-t-green-400 rounded-full"
          />
          <p className="mt-4">Loading...</p>
        </div>
      ) : delivered.length === 0 ? (
        <motion.div
          variants={fadeUp as any}
          className="text-center py-20 text-slate-500"
        >
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-5xl mb-4"
          >
            📭
          </motion.div>
          <p className="text-lg font-semibold">No delivered orders yet</p>
        </motion.div>
      ) : (
        <motion.div variants={fadeUp as any} className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700 uppercase text-xs tracking-wider">
                  <th className="p-4 font-semibold">Order #</th>
                  <th className="p-4 font-semibold">Student ID</th>
                  <th className="p-4 font-semibold">Items</th>
                  <th className="p-4 font-semibold">Revenue</th>
                  <th className="p-4 font-semibold">Delivered At</th>
                </tr>
              </thead>
              <tbody>
                {delivered.map((order) => (
                  <tr
                    key={order.orderId}
                    className="border-b border-slate-700/50 hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="p-4 font-mono text-amber-400 font-bold">
                      #{order.orderId.slice(0, 8)}
                    </td>
                    <td className="p-4 text-slate-300">{order.studentId}</td>
                    <td className="p-4 text-slate-400 text-xs">
                      {order.items
                        .map((i) => `${i.name} x${i.quantity}`)
                        .join(", ")}
                    </td>
                    <td className="p-4 font-bold text-green-400">
                      ৳{order.revenueAmount || order.totalAmount}
                    </td>
                    <td className="p-4 text-slate-500 text-xs">
                      {order.deliveredAt
                        ? new Date(order.deliveredAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
