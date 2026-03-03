import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, StudentScreen, CartItem, Order, MenuItem } from "../../types";
import { GATEWAY_URL, WS_URL } from "../../config/constants";
import { apiFetch } from "../../utils/api";
import { fadeUp, stagger, slideRight, fadeIn } from "../../styles/animations";

export function StudentDashboard({
  user,
  token,
  onLogout,
}: {
  user: User;
  token: string;
  onLogout: () => void;
}) {
  const [screen, setScreen] = useState<StudentScreen>("menu");
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [notification, setNotification] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  const connectWebSocket = useCallback((accessToken: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(`${WS_URL}?token=${accessToken}`);
    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "ORDER_STATUS_UPDATE") {
          setOrders((prev) =>
            prev.map((o) =>
              o.orderId === data.orderId
                ? {
                    ...o,
                    status: data.status,
                    ...(data.otp
                      ? { otp: data.otp, otpExpiresAt: data.otpExpiresAt }
                      : {}),
                  }
                : o,
            ),
          );
          const label =
            data.status === "READY"
              ? "Your order is READY! Show the OTP to staff."
              : `Order ${data.orderId.slice(0, 8)}... → ${data.status}`;
          setNotification(label);
          setTimeout(() => setNotification(""), 5000);
        }
      } catch (e) {
        console.error(e);
      }
    };
    ws.onclose = () => {
      setWsConnected(false);
      setTimeout(() => connectWebSocket(accessToken), 3000);
    };
    ws.onerror = () => setWsConnected(false);
  }, []);

  const fetchMenu = useCallback(async () => {
    try {
      setMenu(await apiFetch(`${GATEWAY_URL}/api/menu`));
    } catch {}
  }, []);
  const fetchOrders = useCallback(async () => {
    try {
      setOrders(
        await apiFetch(`${GATEWAY_URL}/api/orders`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
    } catch {}
  }, [token]);

  useEffect(() => {
    connectWebSocket(token);
    fetchMenu();
    return () => wsRef.current?.close();
  }, [connectWebSocket, fetchMenu, token]);
  useEffect(() => {
    if (screen === "orders") fetchOrders();
  }, [screen, fetchOrders]);

  const addToCart = (item: MenuItem) =>
    setCart((prev) =>
      prev.find((c) => c.itemId === item.itemId)
        ? prev.map((c) =>
            c.itemId === item.itemId ? { ...c, quantity: c.quantity + 1 } : c,
          )
        : [...prev, { ...item, quantity: 1 }],
    );
  const updateCartQty = (itemId: string, delta: number) =>
    setCart((prev) =>
      prev
        .map((c) =>
          c.itemId === itemId
            ? { ...c, quantity: Math.max(0, c.quantity + delta) }
            : c,
        )
        .filter((c) => c.quantity > 0),
    );
  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((c) => c.itemId !== id));
    setError("");
  };
  const cartTotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  const placeOrder = async () => {
    if (!cart.length) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch(`${GATEWAY_URL}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          items: cart.map(({ itemId, name, quantity, price }) => ({
            itemId,
            name,
            quantity,
            price,
          })),
        }),
      });
      setOrders((prev) => [data, ...prev]);
      setCart([]);
      setNotification("Order placed successfully!");
      setTimeout(() => setNotification(""), 3000);
      setScreen("orders");
      fetchMenu();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -50, x: "-50%" }}
            className="fixed top-4 left-1/2 z-50 card shadow-2xl border border-green-600 px-6 py-3 rounded-xl text-sm font-medium text-white"
          >
            <span className="mr-2">✅</span>
            {notification}
          </motion.div>
        )}
      </AnimatePresence>

      {/* WebSocket Indicator */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1 }}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-full text-xs"
      >
        <div
          className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]" : "bg-red-400 animate-pulse"}`}
        />
        {wsConnected ? "Live" : "Reconnecting..."}
      </motion.div>

      <AnimatePresence mode="wait">
        {screen === "menu" ? (
          <MenuScreen
            key="menu"
            user={user}
            menu={menu}
            cart={cart}
            cartTotal={cartTotal}
            onAddToCart={addToCart}
            onRemoveFromCart={removeFromCart}
            onUpdateQty={updateCartQty}
            onPlaceOrder={placeOrder}
            onGoOrders={() => setScreen("orders")}
            onLogout={() => {
              wsRef.current?.close();
              onLogout();
            }}
            loading={loading}
            error={error}
          />
        ) : (
          <OrdersScreen
            key="orders"
            orders={orders}
            token={token}
            onGoMenu={() => setScreen("menu")}
            onLogout={() => {
              wsRef.current?.close();
              onLogout();
            }}
            onRefresh={fetchOrders}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ==========================================
// MENU SCREEN
// ==========================================
function MenuScreen({
  user,
  menu,
  cart,
  cartTotal,
  onAddToCart,
  onRemoveFromCart,
  onUpdateQty,
  onPlaceOrder,
  onGoOrders,
  onLogout,
  loading,
  error,
}: any) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const categories = useMemo(
    () =>
      ["All", ...new Set(menu.map((m: MenuItem) => m.category))] as string[],
    [menu],
  );

  const filteredMenu = useMemo(() => {
    let items = menu as MenuItem[];
    if (activeCategory !== "All")
      items = items.filter((m) => m.category === activeCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q),
      );
    }
    return items;
  }, [menu, activeCategory, searchQuery]);

  return (
    <motion.div {...slideRight} className="min-h-screen">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="text-3xl"
            >
              🍽️
            </motion.div>
            <div>
              <h1 className="text-xl font-extrabold text-white tracking-tight">
                IUT Cafeteria
              </h1>
              <p className="text-xs text-slate-400">
                Welcome,{" "}
                <span className="text-blue-400 font-semibold">{user.name}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative hidden md:block">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm">
                🔍
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search menu..."
                className="input-field pl-9 pr-4 py-2 rounded-xl w-56 text-sm"
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onGoOrders}
              className="bg-slate-700 border border-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-slate-600 transition-all font-medium flex items-center gap-2"
            >
              📋 My Orders
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onLogout}
              className="bg-red-900/50 border border-red-700 px-4 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-900/70 transition-all"
            >
              ↪ Logout
            </motion.button>
          </div>
        </div>
      </header>

      {/* Mobile Search */}
      <div className="md:hidden px-6 pt-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm">
            🔍
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search menu..."
            className="input-field pl-9 pr-4 py-2 rounded-xl w-full text-sm"
          />
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 flex gap-6">
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Category Tabs */}
          <motion.div
            {...fadeUp}
            className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide"
          >
            {categories.map((cat) => (
              <motion.button
                key={cat}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setActiveCategory(cat)}
                className={`px-5 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-300 ${
                  activeCategory === cat
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25"
                    : "bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700"
                }`}
              >
                {cat === "All" ? "🌴 All" : cat}
              </motion.button>
            ))}
          </motion.div>

          {/* Food Grid */}
          <motion.div
            variants={stagger}
            initial="initial"
            animate="animate"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            <AnimatePresence mode="popLayout">
              {filteredMenu.map((item: MenuItem) => (
                <motion.div
                  key={item.itemId}
                  variants={fadeUp}
                  layout
                  whileHover={{ y: -6, transition: { duration: 0.2 } }}
                  className={`food-card card overflow-hidden group relative ${item.isEnabled === false ? "opacity-60" : "cursor-pointer"}`}
                  onClick={() =>
                    item.isEnabled !== false &&
                    item.availableQty > 0 &&
                    onAddToCart(item)
                  }
                >
                  {/* Stock Badge */}
                  <div className="absolute top-3 right-3 z-10">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                        item.isEnabled === false
                          ? "bg-slate-700 text-slate-400"
                          : item.availableQty > 20
                            ? "bg-green-900/60 text-green-400"
                            : item.availableQty > 0
                              ? "bg-yellow-900/60 text-yellow-400"
                              : "bg-red-900/60 text-red-400"
                      }`}
                    >
                      {item.isEnabled === false
                        ? "Unavailable"
                        : item.availableQty > 0
                          ? `${item.availableQty} left`
                          : "Sold Out"}
                    </span>
                  </div>
                  {item.isEnabled === false && (
                    <div className="absolute inset-0 bg-black/40 z-[5] rounded-xl flex items-end">
                      <div className="w-full p-4 text-center">
                        <p className="text-xs text-red-400 font-medium">
                          {item.disabledReason || "Currently unavailable"}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Food Image */}
                  <div className="p-6 pb-2 flex justify-center relative">
                    <motion.span className="text-7xl block drop-shadow-2xl group-hover:scale-110 transition-transform duration-300">
                      {item.imageUrl}
                    </motion.span>
                  </div>

                  {/* Info */}
                  <div className="p-4 pt-2">
                    <h4 className="font-bold text-lg text-white mb-1">
                      {item.name}
                    </h4>
                    <p className="text-xs text-slate-400 line-clamp-2 mb-3 leading-relaxed">
                      {item.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-extrabold text-blue-400">
                        ৳{item.price}
                      </span>
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        disabled={
                          item.availableQty <= 0 || item.isEnabled === false
                        }
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                          item.isEnabled === false || item.availableQty <= 0
                            ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                            : "bg-blue-600 text-white hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-600/20"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          item.isEnabled !== false &&
                            item.availableQty > 0 &&
                            onAddToCart(item);
                        }}
                      >
                        + Add
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>

          {filteredMenu.length === 0 && (
            <motion.div
              {...fadeIn}
              className="text-center py-20 text-slate-500"
            >
              <div className="text-5xl mb-4">🔍</div>
              <p className="text-lg">No items found</p>
              <p className="text-sm mt-1">Try a different search or category</p>
            </motion.div>
          )}
        </div>

        {/* Cart Sidebar */}
        <div className="w-80 shrink-0 hidden lg:block">
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="card p-5 sticky top-24"
          >
            <h3 className="text-xl font-extrabold mb-4 flex items-center gap-2 text-white">
              🛒 <span>Cart</span>
              {cart.length > 0 && (
                <span className="ml-auto bg-blue-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                  {cart.length}
                </span>
              )}
            </h3>
            {cart.length === 0 ? (
              <div className="text-center py-10">
                <div className="text-4xl mb-3 opacity-40">🛒</div>
                <p className="text-slate-500 text-sm">Your cart is empty</p>
              </div>
            ) : (
              <>
                <div className="space-y-2 max-h-72 overflow-y-auto mb-4">
                  <AnimatePresence>
                    {cart.map((item: CartItem) => (
                      <motion.div
                        key={item.itemId}
                        layout
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="flex items-center gap-3 bg-slate-800 rounded-xl p-3 border border-slate-700"
                      >
                        <span className="text-xl">{item.imageUrl}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">
                            {item.name}
                          </p>
                          <p className="text-xs text-blue-400 font-bold">
                            ৳{item.price * item.quantity}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onUpdateQty(item.itemId, -1)}
                            className="w-6 h-6 rounded bg-slate-700 text-xs flex items-center justify-center hover:bg-slate-600 transition"
                          >
                            −
                          </button>
                          <span className="text-sm font-bold w-6 text-center">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => onUpdateQty(item.itemId, 1)}
                            className="w-6 h-6 rounded bg-slate-700 text-xs flex items-center justify-center hover:bg-slate-600 transition"
                          >
                            +
                          </button>
                        </div>
                        <button
                          onClick={() => onRemoveFromCart(item.itemId)}
                          className="text-red-400 hover:text-red-300 text-sm ml-1"
                        >
                          ✕
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 font-medium">Total</span>
                    <span className="text-2xl font-extrabold text-white">
                      ৳{cartTotal}
                    </span>
                  </div>
                  {error && (
                    <p className="text-red-400 text-xs bg-red-900/30 rounded-xl p-2">
                      {error}
                    </p>
                  )}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onPlaceOrder}
                    disabled={loading}
                    className="btn-primary w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50 text-base"
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
                          className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                        />
                        Placing...
                      </span>
                    ) : (
                      `Place Order • ৳${cartTotal}`
                    )}
                  </motion.button>
                </div>
              </>
            )}
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

// ==========================================
// OTP COUNTDOWN TIMER
// ==========================================
function OtpCountdown({
  expiresAt,
  onExpired,
}: {
  expiresAt: string;
  onExpired: () => void;
}) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const calc = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
      setRemaining(diff);
      if (diff <= 0) onExpired();
    };
    calc();
    const i = setInterval(calc, 1000);
    return () => clearInterval(i);
  }, [expiresAt, onExpired]);
  if (!expiresAt || remaining <= 0) return null;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const pct = Math.min(100, (remaining / 120) * 100);
  return (
    <div className="mt-2">
      <div className="w-full h-1.5 rounded-full bg-slate-700 overflow-hidden mb-1">
        <div
          className={`h-full rounded-full transition-all duration-500 ${remaining > 60 ? "bg-green-500" : remaining > 30 ? "bg-yellow-500" : "bg-red-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p
        className={`text-xs font-mono text-center ${remaining > 60 ? "text-green-400" : remaining > 30 ? "text-yellow-400" : "text-red-400"}`}
      >
        {mins}:{secs.toString().padStart(2, "0")} remaining
      </p>
    </div>
  );
}

// ==========================================
// ORDERS SCREEN
// ==========================================
function OrdersScreen({ orders, onGoMenu, onLogout, onRefresh, token }: any) {
  const statusSteps = [
    "PENDING",
    "STOCK_VERIFIED",
    "IN_KITCHEN",
    "READY",
    "DELIVERED",
  ];
  const statusLabels: Record<string, string> = {
    PENDING: "⏳ Pending",
    STOCK_VERIFIED: "✅ Verified",
    PENDING_QUEUE: "📑 Queuing",
    IN_KITCHEN: "👨🍳 Cooking",
    READY: "🎉 Ready!",
    DELIVERED: "📦 Delivered",
    FAILED: "❌ Failed",
  };
  const statusColors: Record<string, string> = {
    PENDING: "text-yellow-400",
    STOCK_VERIFIED: "text-blue-400",
    PENDING_QUEUE: "text-orange-400",
    IN_KITCHEN: "text-purple-400",
    READY: "text-green-400",
    DELIVERED: "text-emerald-400",
    FAILED: "text-red-400",
  };
  const [otpData, setOtpData] = useState<
    Record<string, { otp: string; expiresAt: string }>
  >({});
  const [otpLoading, setOtpLoading] = useState<Record<string, boolean>>({});

  const fetchOtp = async (orderId: string) => {
    setOtpLoading((p) => ({ ...p, [orderId]: true }));
    try {
      const data = await apiFetch(`${GATEWAY_URL}/api/orders/${orderId}/otp`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setOtpData((p) => ({
        ...p,
        [orderId]: { otp: data.otpCode, expiresAt: data.expiresAt },
      }));
    } catch (err: any) {
      console.error("Fetch OTP:", err.message);
    } finally {
      setOtpLoading((p) => ({ ...p, [orderId]: false }));
    }
  };

  const clearOtp = useCallback((orderId: string) => {
    setOtpData((p) => {
      const n = { ...p };
      delete n[orderId];
      return n;
    });
  }, []);

  return (
    <motion.div {...slideRight} className="min-h-screen">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ x: -3 }}
              onClick={onGoMenu}
              className="text-slate-400 hover:text-white transition font-medium"
            >
              ← Back to Menu
            </motion.button>
            <div className="w-px h-6 bg-slate-700" />
            <h1 className="text-lg font-extrabold text-white">My Orders</h1>
          </div>
          <div className="flex gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onRefresh}
              className="bg-slate-700 border border-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-slate-600 transition-all font-medium"
            >
              🔄 Refresh
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onLogout}
              className="bg-red-900/50 border border-red-700 px-4 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-900/70 transition-all"
            >
              ↪ Logout
            </motion.button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-6">
        {orders.length === 0 ? (
          <motion.div {...fadeUp} className="text-center py-20 text-slate-500">
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-6xl mb-4"
            >
              📦
            </motion.div>
            <p className="text-lg font-semibold">No orders yet</p>
            <p className="text-sm mt-1 mb-4">Go grab something delicious!</p>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onGoMenu}
              className="btn-primary px-8 py-3 rounded-xl text-white font-bold"
            >
              Browse Menu
            </motion.button>
          </motion.div>
        ) : (
          <motion.div
            variants={stagger}
            initial="initial"
            animate="animate"
            className="space-y-4"
          >
            {orders.map((order: Order) => (
              <motion.div
                key={order.orderId}
                variants={fadeUp}
                className="card p-5 hover:border-blue-600/20 transition-colors"
              >
                <div className="flex justify-between mb-4">
                  <div>
                    <p className="text-xs text-slate-500 font-mono">
                      Order #{order.orderId.slice(0, 8)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(order.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <motion.span
                    key={order.status}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`text-sm font-bold ${statusColors[order.status] || "text-slate-400"}`}
                  >
                    {statusLabels[order.status] || order.status}
                  </motion.span>
                </div>
                {/* Status Timeline */}
                <div className="flex items-center gap-1 mb-2">
                  {statusSteps.map((step, i) => {
                    const currentIdx = statusSteps.indexOf(order.status);
                    const isActive = i <= currentIdx;
                    const isCurrent = i === currentIdx;
                    return (
                      <div key={step} className="flex items-center flex-1">
                        <motion.div
                          animate={
                            isCurrent
                              ? {
                                  scale: [1, 1.4, 1],
                                  boxShadow: [
                                    "0 0 0px rgba(59,130,246,0)",
                                    "0 0 12px rgba(59,130,246,0.6)",
                                    "0 0 0px rgba(59,130,246,0)",
                                  ],
                                }
                              : {}
                          }
                          transition={{
                            repeat: isCurrent ? Infinity : 0,
                            duration: 1.5,
                          }}
                          className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all ${isActive ? "bg-blue-500" : "bg-slate-700"}`}
                        />
                        {i < statusSteps.length - 1 && (
                          <div
                            className={`h-0.5 flex-1 mx-1 rounded transition-all ${isActive ? "bg-blue-500" : "bg-slate-700"}`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mb-4">
                  <span>Pending</span>
                  <span>Verified</span>
                  <span>Kitchen</span>
                  <span>Ready</span>
                  <span>Delivered</span>
                </div>
                {/* OTP Display for READY orders */}
                {order.status === "READY" && (
                  <div className="mb-4 p-4 rounded-xl bg-green-900/20 border border-green-700">
                    <div className="text-center">
                      {otpLoading[order.orderId] ? (
                        <div className="py-2">
                          <motion.span
                            animate={{ rotate: 360 }}
                            transition={{
                              duration: 1,
                              repeat: Infinity,
                              ease: "linear",
                            }}
                            className="inline-block w-5 h-5 border-2 border-green-400/30 border-t-green-400 rounded-full"
                          />
                          <p className="text-sm text-slate-400 mt-2">
                            Generating OTP...
                          </p>
                        </div>
                      ) : otpData[order.orderId] ? (
                        <>
                          <p className="text-xs text-green-400 font-semibold mb-2">
                            Show this OTP to kitchen staff
                          </p>
                          <p className="text-4xl font-mono font-extrabold text-green-400 tracking-[0.3em] mb-1">
                            {otpData[order.orderId].otp}
                          </p>
                          <OtpCountdown
                            expiresAt={otpData[order.orderId].expiresAt}
                            onExpired={() => clearOtp(order.orderId)}
                          />
                        </>
                      ) : (
                        <div className="py-1">
                          <p className="text-xs text-slate-400 mb-3">
                            Generate a one-time password for pickup
                          </p>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => fetchOtp(order.orderId)}
                            className="btn-green px-5 py-2 rounded-xl text-sm font-bold text-white"
                          >
                            Show OTP
                          </motion.button>
                          <p className="text-[10px] text-slate-500 mt-2">
                            Valid for 2 minutes after generation
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {order.status === "DELIVERED" && (
                  <div className="mb-4 p-3 rounded-xl bg-emerald-900/20 border border-emerald-700 text-center">
                    <p className="text-sm text-emerald-400 font-semibold">
                      ✅ Order delivered successfully
                    </p>
                  </div>
                )}
                <div className="space-y-1 border-t border-slate-700 pt-3">
                  {order.items.map((item, j) => (
                    <div key={j} className="flex justify-between text-sm">
                      <span className="text-slate-300">
                        {item.name}{" "}
                        <span className="text-slate-500">x{item.quantity}</span>
                      </span>
                      <span className="text-slate-400 font-medium">
                        ৳{item.price * item.quantity}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold pt-2 border-t border-slate-700 mt-2">
                    <span>Total</span>
                    <span className="text-white text-lg">
                      ৳{order.totalAmount}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
