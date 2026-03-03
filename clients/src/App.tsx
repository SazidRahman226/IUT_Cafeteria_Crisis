import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from "recharts";

// ==========================================
// Types
// ==========================================
interface User { studentId: string; name: string; role: string }
interface MenuItem { itemId: string; name: string; description: string; price: number; category: string; imageUrl: string; availableQty: number }
interface Order { orderId: string; studentId: string; items: Array<{ itemId: string; name: string; quantity: number; price: number }>; totalAmount: number; status: string; createdAt: string }
interface CartItem extends MenuItem { quantity: number }
type StudentScreen = "menu" | "orders";
interface HealthData { status: string; service: string; uptime: number; dependencies: Record<string, { status: string; latency?: number }> }
interface MetricsData { service: string; requestCount: number; errorCount: number; avgLatencyMs: number; recentAvgLatencyMs?: number; ordersProcessed: number; uptime: number; connectedClients?: number; notificationsSent?: number; kitchenProcessingTimeMs?: number; totalRevenue?: number }
interface ServiceState { name: string; key: string; port: number; color: string; health: HealthData | null; metrics: MetricsData | null; isUp: boolean; lastCheck: Date }
interface LatencyPoint { time: string; gateway: number; identity: number; stock: number; kitchen: number; notification: number }

// ==========================================
// Config
// ==========================================
const BASE_HOST = import.meta.env.VITE_API_HOST || "localhost";
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || `http://${BASE_HOST}:8080`;
const AUTH_URL = import.meta.env.VITE_AUTH_URL || `http://${BASE_HOST}:4001`;
const WS_URL = import.meta.env.VITE_WS_URL || `ws://${BASE_HOST}:4005/ws`;

const SERVICES = [
  { name: "Identity Provider", key: "identity-provider", port: 4001, color: "#38bdf8", envVar: "VITE_IDENTITY_URL" },
  { name: "Order Gateway", key: "order-gateway", port: 8080, color: "#a78bfa", envVar: "VITE_GATEWAY_URL" },
  { name: "Stock Service", key: "stock-service", port: 4002, color: "#34d399", envVar: "VITE_STOCK_URL" },
  { name: "Kitchen Service", key: "kitchen-service", port: 4003, color: "#fb923c", envVar: "VITE_KITCHEN_URL" },
  { name: "Notification Hub", key: "notification-hub", port: 4005, color: "#f472b6", envVar: "VITE_NOTIFICATION_URL" },
];

function getServiceUrl(port: number) { 
  const service = SERVICES.find(s => s.port === port);
  if (service && import.meta.env[service.envVar]) {
    return import.meta.env[service.envVar];
  }
  return `${window.location.protocol}//${BASE_HOST}:${port}`; 
}
function formatUptime(s: number): string { if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m`; return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; }
function parsePrometheusMetrics(text: string, service: string): MetricsData {
  const gv = (n: string) => { const m = text.match(new RegExp(`${n}\\{[^}]*\\}\\s+(\\d+\\.?\\d*)`)); return m ? parseFloat(m[1]) : 0; };
  return { service, requestCount: gv("requests_total"), errorCount: gv("errors_total"), avgLatencyMs: gv("avg_latency_ms"), ordersProcessed: gv("orders_processed_total"), uptime: gv("uptime_seconds") };
}
async function apiFetch(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, opts);
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error?.message || "Request failed");
  return data;
}

// ==========================================
// Animation presets
// ==========================================
const stagger = { animate: { transition: { staggerChildren: 0.08 } } };
const fadeUp = { initial: { opacity: 0, y: 30 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
const fadeIn = { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.4 } };
const scaleIn = { initial: { opacity: 0, scale: 0.8 }, animate: { opacity: 1, scale: 1 }, transition: { type: "spring", stiffness: 200, damping: 20 } };
const slideRight = { initial: { opacity: 0, x: 60 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -60 }, transition: { duration: 0.4 } };

// ==========================================
// Root App
// ==========================================
export default function App() {
  const [user, setUser] = useState<User | null>(() => { const s = localStorage.getItem("cafeteria_user"); return s ? JSON.parse(s) : null; });
  const [token, setToken] = useState(() => localStorage.getItem("cafeteria_token") || "");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const handleLogin = async (studentId: string, password: string) => {
    setLoginLoading(true); setLoginError("");
    try {
      const data = await apiFetch(`${AUTH_URL}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId, password }) });
      setToken(data.accessToken); setUser(data.user);
      localStorage.setItem("cafeteria_token", data.accessToken);
      localStorage.setItem("cafeteria_user", JSON.stringify(data.user));
    } catch (err: any) { setLoginError(err.message); }
    finally { setLoginLoading(false); }
  };
  const handleLogout = () => { setUser(null); setToken(""); localStorage.removeItem("cafeteria_token"); localStorage.removeItem("cafeteria_user"); };

  if (!user || !token) return <LoginScreen onLogin={handleLogin} loading={loginLoading} error={loginError} />;
  if (user.role === "admin") return <AdminDashboard user={user} token={token} onLogout={handleLogout} />;
  return <StudentDashboard user={user} token={token} onLogout={handleLogout} />;
}

// ==========================================
// LOGIN SCREEN — Polished glass card
// ==========================================
function LoginScreen({ onLogin, loading, error }: { onLogin: (id: string, pw: string) => void; loading: boolean; error: string }) {
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div animate={{ x: [0, 100, 0], y: [0, -50, 0] }} transition={{ duration: 20, repeat: Infinity }} className="absolute top-20 left-20 w-72 h-72 bg-purple-600/20 rounded-full blur-3xl" />
        <motion.div animate={{ x: [0, -80, 0], y: [0, 60, 0] }} transition={{ duration: 25, repeat: Infinity }} className="absolute bottom-20 right-20 w-96 h-96 bg-cyan-600/15 rounded-full blur-3xl" />
        <motion.div animate={{ x: [0, 50, 0], y: [0, -80, 0] }} transition={{ duration: 18, repeat: Infinity }} className="absolute top-1/2 left-1/2 w-64 h-64 bg-pink-600/10 rounded-full blur-3xl" />
      </div>

      <motion.div initial={{ opacity: 0, y: 40, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.7, type: "spring" }} className="glass-card p-10 w-full max-w-md relative z-10">
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="text-center mb-8">
          <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} className="text-6xl mb-4 inline-block">🍽️</motion.div>
          <h1 className="text-4xl font-extrabold gradient-text tracking-tight">IUT Cafeteria</h1>
        </motion.div>

        <motion.form initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}
          onSubmit={(e) => { e.preventDefault(); onLogin(studentId, password); }} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">User ID</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">👤</span>
              <input type="text" value={studentId} onChange={(e) => setStudentId(e.target.value)} className="input-field w-full pl-11 pr-4 py-3.5 rounded-xl" placeholder="student1 or admin1" required />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Password</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">🔒</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-field w-full pl-11 pr-4 py-3.5 rounded-xl" placeholder="••••••••" required />
            </div>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="bg-red-500/15 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
                <span>⚠️</span>{error}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button type="submit" disabled={loading} whileHover={{ scale: 1.02, boxShadow: "0 8px 30px rgba(14, 165, 233, 0.4)" }} whileTap={{ scale: 0.98 }}
            className="btn-primary w-full py-4 rounded-xl text-white font-bold text-lg disabled:opacity-50 relative overflow-hidden">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full" />
                Signing in...
              </span>
            ) : "Sign In →"}
          </motion.button>

          <div className="flex items-center gap-3 pt-2">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-gray-600 text-xs">DEMO ACCOUNTS</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setStudentId("student1"); setPassword("password123"); }}
              className="flex-1 glass px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-all">👨‍🎓 student1</button>
            <button type="button" onClick={() => { setStudentId("student2"); setPassword("password123"); }}
              className="flex-1 glass px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-all">👨‍🎓 student2</button>
            <button type="button" onClick={() => { setStudentId("admin1"); setPassword("password123"); }}
              className="flex-1 glass px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-all">🛡️ admin1</button>
          </div>
        </motion.form>
      </motion.div>
    </div>
  );
}

// ==========================================
// STUDENT DASHBOARD
// ==========================================
function StudentDashboard({ user, token, onLogout }: { user: User; token: string; onLogout: () => void }) {
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
          setOrders((prev) => prev.map((o) => o.orderId === data.orderId ? { ...o, status: data.status } : o));
          setNotification(`Order ${data.orderId.slice(0, 8)}... → ${data.status}`);
          setTimeout(() => setNotification(""), 4000);
        }
      } catch (e) { console.error(e); }
    };
    ws.onclose = () => { setWsConnected(false); setTimeout(() => connectWebSocket(accessToken), 3000); };
    ws.onerror = () => setWsConnected(false);
  }, []);

  const fetchMenu = useCallback(async () => { try { setMenu(await apiFetch(`${GATEWAY_URL}/api/menu`)); } catch { } }, []);
  const fetchOrders = useCallback(async () => { try { setOrders(await apiFetch(`${GATEWAY_URL}/api/orders`, { headers: { Authorization: `Bearer ${token}` } })); } catch { } }, [token]);

  useEffect(() => { connectWebSocket(token); fetchMenu(); return () => wsRef.current?.close(); }, [connectWebSocket, fetchMenu, token]);
  useEffect(() => { if (screen === "orders") fetchOrders(); }, [screen, fetchOrders]);

  const addToCart = (item: MenuItem) => setCart((prev) => prev.find((c) => c.itemId === item.itemId) ? prev.map((c) => c.itemId === item.itemId ? { ...c, quantity: c.quantity + 1 } : c) : [...prev, { ...item, quantity: 1 }]);
  const updateCartQty = (itemId: string, delta: number) => setCart((prev) => prev.map((c) => c.itemId === itemId ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter((c) => c.quantity > 0));
  const removeFromCart = (id: string) => { setCart((prev) => prev.filter((c) => c.itemId !== id)); setError(""); };
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const placeOrder = async () => {
    if (!cart.length) return;
    setLoading(true); setError("");
    try {
      const data = await apiFetch(`${GATEWAY_URL}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ items: cart.map(({ itemId, name, quantity, price }) => ({ itemId, name, quantity, price })) }),
      });
      setOrders((prev) => [data, ...prev]); setCart([]);
      setNotification("Order placed successfully! 🎉"); setTimeout(() => setNotification(""), 3000);
      setScreen("orders"); fetchMenu();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen">
      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div initial={{ opacity: 0, y: -50, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: -50, x: "-50%" }}
            className="fixed top-4 left-1/2 z-50 glass-card px-6 py-3 text-sm font-medium text-white shadow-2xl border border-green-500/30">
            <span className="mr-2">✨</span>{notification}
          </motion.div>
        )}
      </AnimatePresence>

      {/* WebSocket Indicator */}
      <motion.div initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1 }}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 glass px-3 py-1.5 rounded-full text-xs backdrop-blur-xl">
        <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]" : "bg-red-400 animate-pulse"}`} />
        {wsConnected ? "Live" : "Reconnecting..."}
      </motion.div>

      <AnimatePresence mode="wait">
        {screen === "menu" ? (
          <MenuScreen key="menu" user={user} menu={menu} cart={cart} cartTotal={cartTotal}
            onAddToCart={addToCart} onRemoveFromCart={removeFromCart} onUpdateQty={updateCartQty}
            onPlaceOrder={placeOrder} onGoOrders={() => setScreen("orders")}
            onLogout={() => { wsRef.current?.close(); onLogout(); }} loading={loading} error={error} />
        ) : (
          <OrdersScreen key="orders" orders={orders} onGoMenu={() => setScreen("menu")}
            onLogout={() => { wsRef.current?.close(); onLogout(); }} onRefresh={fetchOrders} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ==========================================
// MENU SCREEN — Category tabs, search, card grid
// ==========================================
function MenuScreen({ user, menu, cart, cartTotal, onAddToCart, onRemoveFromCart, onUpdateQty, onPlaceOrder, onGoOrders, onLogout, loading, error }: any) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const categories = useMemo(() => ["All", ...new Set(menu.map((m: MenuItem) => m.category))] as string[], [menu]);

  const filteredMenu = useMemo(() => {
    let items = menu as MenuItem[];
    if (activeCategory !== "All") items = items.filter((m) => m.category === activeCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
    }
    return items;
  }, [menu, activeCategory, searchQuery]);

  return (
    <motion.div {...slideRight} className="min-h-screen">
      {/* Header */}
      <header className="glass sticky top-0 z-40 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} className="text-3xl">🍽️</motion.div>
            <div>
              <h1 className="text-xl font-extrabold gradient-text tracking-tight">IUT Cafeteria</h1>
              <p className="text-xs text-gray-400">Welcome back, <span className="text-green-400 font-semibold">{user.name}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Search Bar */}
            <div className="relative hidden md:block">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search menu..." className="input-field pl-9 pr-4 py-2.5 rounded-xl w-64 text-sm" />
            </div>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onGoOrders}
              className="glass px-4 py-2.5 rounded-xl text-sm hover:bg-white/10 transition-all flex items-center gap-2 font-medium">
              📋 <span className="hidden sm:inline">My Orders</span>
            </motion.button>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onLogout}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all">
              <span>↪</span> Logout
            </motion.button>
          </div>
        </div>
      </header>

      {/* Mobile Search */}
      <div className="md:hidden px-6 pt-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search menu..." className="input-field pl-9 pr-4 py-2.5 rounded-xl w-full text-sm" />
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 flex gap-6">
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Category Tabs */}
          <motion.div {...fadeUp} className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide">
            {categories.map((cat) => (
              <motion.button key={cat} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => setActiveCategory(cat)}
                className={`px-5 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-300 ${
                  activeCategory === cat
                    ? "bg-gradient-to-r from-cyan-500 to-purple-600 text-white shadow-lg shadow-purple-500/25"
                    : "glass text-gray-400 hover:text-white hover:bg-white/10"
                }`}>
                {cat === "All" && "🍴 "}{cat}
              </motion.button>
            ))}
          </motion.div>

          {/* Food Grid */}
          <motion.div variants={stagger} initial="initial" animate="animate" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <AnimatePresence mode="popLayout">
              {filteredMenu.map((item: MenuItem) => (
                <motion.div key={item.itemId} variants={fadeUp} layout
                  whileHover={{ y: -6, transition: { duration: 0.2 } }}
                  className="food-card glass-card overflow-hidden cursor-pointer group relative"
                  onClick={() => item.availableQty > 0 && onAddToCart(item)}>

                  {/* Stock Badge */}
                  <div className="absolute top-3 right-3 z-10">
                    <span className={`text-xs px-3 py-1 rounded-full font-bold ${
                      item.availableQty > 20 ? "bg-green-500/25 text-green-400 border border-green-500/30"
                      : item.availableQty > 0 ? "bg-yellow-500/25 text-yellow-400 border border-yellow-500/30"
                      : "bg-red-500/25 text-red-400 border border-red-500/30"
                    }`}>
                      {item.availableQty > 0 ? `${item.availableQty} left` : "Sold Out"}
                    </span>
                  </div>

                  {/* Food Image */}
                  <div className="p-6 pb-2 flex justify-center">
                    <motion.span className="text-7xl block drop-shadow-2xl group-hover:scale-110 transition-transform duration-300">{item.imageUrl}</motion.span>
                  </div>

                  {/* Info */}
                  <div className="p-5 pt-2">
                    <h4 className="font-bold text-lg gradient-text mb-1">{item.name}</h4>
                    <p className="text-xs text-gray-400 line-clamp-2 mb-3 leading-relaxed">{item.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-extrabold text-cyan-400">৳{item.price}</span>
                      <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                        disabled={item.availableQty <= 0}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                          item.availableQty > 0
                            ? "bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:bg-purple-500/30 hover:shadow-lg hover:shadow-purple-500/20"
                            : "bg-gray-800 text-gray-600 cursor-not-allowed"
                        }`}
                        onClick={(e) => { e.stopPropagation(); item.availableQty > 0 && onAddToCart(item); }}>
                        + Add
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>

          {filteredMenu.length === 0 && (
            <motion.div {...fadeIn} className="text-center py-20 text-gray-500">
              <div className="text-5xl mb-4">🔍</div>
              <p className="text-lg">No items found</p>
              <p className="text-sm mt-1">Try a different search or category</p>
            </motion.div>
          )}
        </div>

        {/* Cart Sidebar */}
        <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
          className="w-80 shrink-0 hidden lg:block">
          <div className="glass-card p-5 sticky top-24">
            <h3 className="text-xl font-extrabold mb-4 flex items-center gap-2">
              🛒 <span className="gradient-text">Cart</span>
              {cart.length > 0 && (
                <span className="ml-auto bg-purple-500/30 text-purple-300 text-xs font-bold px-2.5 py-1 rounded-full">{cart.length}</span>
              )}
            </h3>
            {cart.length === 0 ? (
              <div className="text-center py-10">
                <div className="text-4xl mb-3 opacity-40">🛒</div>
                <p className="text-gray-500 text-sm">Your cart is empty</p>
                <p className="text-gray-600 text-xs mt-1">Click items to add them</p>
              </div>
            ) : (
              <>
                <div className="space-y-3 max-h-72 overflow-y-auto mb-4 pr-1">
                  {cart.map((item: CartItem) => (
                    <motion.div key={item.itemId} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      className="flex items-center gap-3 glass rounded-xl p-3">
                      <span className="text-2xl">{item.imageUrl}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{item.name}</p>
                        <p className="text-xs text-cyan-400 font-bold">৳{item.price * item.quantity}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => onUpdateQty(item.itemId, -1)} className="w-6 h-6 rounded-md bg-white/10 text-xs flex items-center justify-center hover:bg-white/20 transition">−</button>
                        <span className="text-sm font-bold w-6 text-center">{item.quantity}</span>
                        <button onClick={() => onUpdateQty(item.itemId, 1)} className="w-6 h-6 rounded-md bg-white/10 text-xs flex items-center justify-center hover:bg-white/20 transition">+</button>
                      </div>
                      <button onClick={() => onRemoveFromCart(item.itemId)} className="text-red-400 hover:text-red-300 text-sm ml-1 transition">✕</button>
                    </motion.div>
                  ))}
                </div>
                <div className="border-t border-white/10 pt-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 font-medium">Total</span>
                    <span className="text-2xl font-extrabold gradient-text">৳{cartTotal}</span>
                  </div>
                  {error && <p className="text-red-400 text-xs bg-red-500/10 rounded-lg p-2">{error}</p>}
                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    onClick={onPlaceOrder} disabled={loading}
                    className="btn-primary w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50 text-base">
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                        Placing...
                      </span>
                    ) : `Place Order • ৳${cartTotal}`}
                  </motion.button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ==========================================
// ORDERS SCREEN
// ==========================================
function OrdersScreen({ orders, onGoMenu, onLogout, onRefresh }: any) {
  const statusSteps = ["PENDING", "STOCK_VERIFIED", "IN_KITCHEN", "READY"];
  const statusLabels: Record<string, string> = { PENDING: "⏳ Pending", STOCK_VERIFIED: "✅ Verified", PENDING_QUEUE: "📤 Queuing", IN_KITCHEN: "👨‍🍳 Cooking", READY: "🎉 Ready!", FAILED: "❌ Failed" };
  const statusColors: Record<string, string> = { PENDING: "text-yellow-400", STOCK_VERIFIED: "text-blue-400", PENDING_QUEUE: "text-orange-400", IN_KITCHEN: "text-purple-400", READY: "text-green-400", FAILED: "text-red-400" };

  return (
    <motion.div {...slideRight} className="min-h-screen">
      <header className="glass sticky top-0 z-40 border-b border-white/5">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.button whileHover={{ x: -3 }} onClick={onGoMenu} className="text-gray-400 hover:text-white transition flex items-center gap-1 font-medium">
              <span>←</span> Back to Menu
            </motion.button>
            <div className="w-px h-6 bg-white/10" />
            <h1 className="text-lg font-extrabold gradient-text">My Orders</h1>
          </div>
          <div className="flex gap-3">
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onRefresh}
              className="glass px-4 py-2 rounded-xl text-sm hover:bg-white/10 transition font-medium">🔄 Refresh</motion.button>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onLogout}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all">
              <span>↪</span> Logout
            </motion.button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-6">
        {orders.length === 0 ? (
          <motion.div {...fadeUp} className="text-center py-20 text-gray-500">
            <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 2, repeat: Infinity }} className="text-6xl mb-4">📦</motion.div>
            <p className="text-lg font-semibold">No orders yet</p>
            <p className="text-sm mt-1 mb-4">Go grab something delicious!</p>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onGoMenu}
              className="btn-primary px-8 py-3 rounded-xl text-white font-bold">Browse Menu</motion.button>
          </motion.div>
        ) : (
          <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">
            {orders.map((order: Order, idx: number) => (
              <motion.div key={order.orderId} variants={fadeUp} className="glass-card p-5 hover:border-purple-500/20 transition-colors">
                <div className="flex justify-between mb-4">
                  <div>
                    <p className="text-xs text-gray-500 font-mono">Order #{order.orderId.slice(0, 8)}</p>
                    <p className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleString()}</p>
                  </div>
                  <motion.span key={order.status} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    className={`text-sm font-bold ${statusColors[order.status] || "text-gray-400"}`}>
                    {statusLabels[order.status] || order.status}
                  </motion.span>
                </div>
                {/* Status Timeline */}
                <div className="flex items-center gap-1 mb-2">
                  {statusSteps.map((step, i) => {
                    const currentIdx = statusSteps.indexOf(order.status);
                    const isActive = i <= currentIdx;
                    const isCurrent = step === order.status;
                    return (
                      <div key={step} className="flex items-center flex-1">
                        <motion.div animate={isCurrent ? { scale: [1, 1.4, 1], boxShadow: ["0 0 0 rgba(56,189,248,0)", "0 0 12px rgba(56,189,248,0.6)", "0 0 0 rgba(56,189,248,0)"] } : {}}
                          transition={{ repeat: isCurrent ? Infinity : 0, duration: 1.5 }}
                          className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all ${isActive ? "bg-gradient-to-r from-cyan-400 to-purple-500" : "bg-gray-700"}`} />
                        {i < statusSteps.length - 1 && <div className={`h-0.5 flex-1 mx-1 rounded transition-all ${isActive ? "bg-gradient-to-r from-cyan-400 to-purple-500" : "bg-gray-700"}`} />}
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-4 px-0.5">
                  <span>Pending</span><span>Verified</span><span>Kitchen</span><span>Ready</span>
                </div>
                <div className="space-y-1 border-t border-white/5 pt-3">
                  {order.items.map((item, j) => (
                    <div key={j} className="flex justify-between text-sm">
                      <span className="text-gray-300">{item.name} <span className="text-gray-500">x{item.quantity}</span></span>
                      <span className="text-gray-400 font-medium">৳{item.price * item.quantity}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold pt-2 border-t border-white/5 mt-2">
                    <span>Total</span><span className="gradient-text text-lg">৳{order.totalAmount}</span>
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

// ==========================================
// ADMIN DASHBOARD — Modernized
// ==========================================
function AdminDashboard({ user, token, onLogout }: { user: User; token: string; onLogout: () => void }) {
  const [services, setServices] = useState<ServiceState[]>(SERVICES.map((s) => ({ ...s, health: null, metrics: null, isUp: false, lastCheck: new Date() })));
  const [latencyHistory, setLatencyHistory] = useState<LatencyPoint[]>([]);
  const [ordersHistory, setOrdersHistory] = useState<{ time: string; orders: number }[]>([]);
  const [gatewayAlert, setGatewayAlert] = useState(false);
  const [chaosLog, setChaosLog] = useState<string[]>([]);
  const [killedServices, setKilledServices] = useState<Record<string, { killedAt: number; recovered: boolean }>>({});
  const [chaosTimers, setChaosTimers] = useState<Record<string, number>>({});
  const [revenue, setRevenue] = useState(0);
  const [ordersProcessed, setOrdersProcessed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setChaosTimers(() => {
        const t: Record<string, number> = {};
        for (const [key, info] of Object.entries(killedServices)) { if (!info.recovered) t[key] = Math.floor((Date.now() - info.killedAt) / 1000); }
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
        setKilledServices((p) => ({ ...p, [svc.key]: { ...p[svc.key], recovered: true } }));
        setChaosLog((p) => [`✅ ${svc.name} recovered after ${dt}s downtime`, ...p].slice(0, 20));
      }
    }
  }, [services, killedServices]);

  const pollServices = useCallback(async () => {
    const updated = await Promise.all(SERVICES.map(async (svc) => {
      let health = null, metrics = null, isUp = false;
      try { const h = await fetch(`${getServiceUrl(svc.port)}/health`, { signal: AbortSignal.timeout(3000) }); if (h.ok) { health = await h.json(); isUp = health.status === "ok"; } } catch { }
      try { const m = await fetch(`${getServiceUrl(svc.port)}/metrics/json`, { signal: AbortSignal.timeout(3000) }); if (m.ok) metrics = await m.json(); } catch { try { const m = await fetch(`${getServiceUrl(svc.port)}/metrics`, { signal: AbortSignal.timeout(3000) }); if (m.ok) metrics = parsePrometheusMetrics(await m.text(), svc.key); } catch { } }
      return { ...svc, health, metrics, isUp, lastCheck: new Date() };
    }));
    setServices(updated);
    const now = new Date().toLocaleTimeString();
    const gw = updated.find((s) => s.key === "order-gateway"), id = updated.find((s) => s.key === "identity-provider"), st = updated.find((s) => s.key === "stock-service"), kt = updated.find((s) => s.key === "kitchen-service"), nh = updated.find((s) => s.key === "notification-hub");
    setLatencyHistory((p) => [...p, { time: now, gateway: gw?.metrics?.avgLatencyMs || 0, identity: id?.metrics?.avgLatencyMs || 0, stock: st?.metrics?.avgLatencyMs || 0, kitchen: kt?.metrics?.avgLatencyMs || 0, notification: nh?.metrics?.avgLatencyMs || 0 }].slice(-30));
    setOrdersHistory((p) => [...p, { time: now, orders: updated.reduce((s, x) => s + (x.metrics?.ordersProcessed || 0), 0) }].slice(-30));
    setGatewayAlert((gw?.metrics?.recentAvgLatencyMs || gw?.metrics?.avgLatencyMs || 0) > 1000);
  }, []);

  const fetchStatsSafe = useCallback(async () => {
    try { 
      const gw = SERVICES.find((s) => s.key === "order-gateway"); 
      if (!gw) return; 
      const [revRes, countRes] = await Promise.all([
        fetch(`${getServiceUrl(gw.port)}/api/orders/revenue`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${getServiceUrl(gw.port)}/api/orders/orderCount`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (revRes.ok) setRevenue((await revRes.json()).totalRevenue || 0); 
      if (countRes.ok) setOrdersProcessed((await countRes.json()).count || 0);
    } catch { }
  }, [token]);

  useEffect(() => { pollServices(); fetchStatsSafe(); const i = setInterval(() => { pollServices(); fetchStatsSafe(); }, 5000); return () => clearInterval(i); }, [pollServices, fetchStatsSafe]);

  const killService = async (svc: ServiceState) => {
    try {
      await fetch(`${getServiceUrl(svc.port)}/chaos/kill`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } });
      setChaosLog((p) => [`💀 ${svc.name} killed at ${new Date().toLocaleTimeString()}`, ...p].slice(0, 20));
      setKilledServices((p) => ({ ...p, [svc.key]: { killedAt: Date.now(), recovered: false } }));
      [2000, 5000, 8000].forEach((d) => setTimeout(pollServices, d));
    } catch { setChaosLog((p) => [`⚠️ Could not reach ${svc.name}`, ...p].slice(0, 20)); }
  };

  const healthyCount = services.filter((s) => s.isUp).length;
  const totalRequests = services.reduce((s, svc) => s + (svc.metrics?.requestCount || 0), 0);
  const totalErrors = services.reduce((s, svc) => s + (svc.metrics?.errorCount || 0), 0);

  const statCards = [
    { label: "Total Requests", value: totalRequests, icon: "📊", borderColor: "border-cyan-500/40", bgColor: "bg-cyan-500/5", glowColor: "shadow-cyan-500/10" },
    { label: "Total Orders", value: ordersProcessed, icon: "📦", borderColor: "border-purple-500/40", bgColor: "bg-purple-500/5", glowColor: "shadow-purple-500/10" },
    { label: "Total Errors", value: totalErrors, icon: "❌", borderColor: "border-red-500/40", bgColor: "bg-red-500/5", glowColor: "shadow-red-500/10" },
    { label: "Services Up", value: `${healthyCount}/5`, icon: "💚", borderColor: "border-green-500/40", bgColor: "bg-green-500/5", glowColor: "shadow-green-500/10" },
    { label: "Total Revenue", value: `৳${revenue}`, icon: "💰", borderColor: "border-yellow-500/40", bgColor: "bg-yellow-500/5", glowColor: "shadow-yellow-500/10" },
  ];

  return (
    <div className="min-h-screen">
      {/* Gateway Alert */}
      <AnimatePresence>
        {gatewayAlert && (
          <motion.div initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 backdrop-blur px-6 py-3 rounded-xl text-white font-semibold shadow-lg shadow-red-500/30 flex items-center gap-2">
            <span className="animate-pulse">⚠️</span>Gateway avg response &gt; 1s!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="glass border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">🛡️</span>
              <div>
                <h1 className="text-2xl font-extrabold bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-500 bg-clip-text text-transparent">Admin Dashboard</h1>
                <p className="text-gray-500 text-xs mt-0.5">DevSprint 2026 — IUT Cafeteria Crisis Control</p>
              </div>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-4 text-sm">
            <div className="glass-card px-4 py-2 flex items-center gap-2">
              <span className="text-gray-400">Services:</span>
              <span className={`font-bold ${healthyCount === 5 ? "text-green-400" : "text-yellow-400"}`}>{healthyCount}/5</span>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <span className="text-gray-400 flex items-center gap-2">👋 <span className="font-semibold text-gray-300">System Admin</span></span>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onLogout}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all">
              ↪ Logout
            </motion.button>
          </motion.div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Summary Stats with colored borders */}
        <motion.div variants={stagger} initial="initial" animate="animate" className="grid grid-cols-5 gap-4">
          {statCards.map((stat) => (
            <motion.div key={stat.label} variants={scaleIn}
              className={`glass-card p-5 border-2 ${stat.borderColor} ${stat.bgColor} shadow-lg ${stat.glowColor} hover:scale-[1.03] transition-transform`}>
              <div className="text-3xl mb-2">{stat.icon}</div>
              <p className="text-2xl font-extrabold">{stat.value}</p>
              <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Health Grid */}
        <motion.div {...fadeUp}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]" />
            <h2 className="text-xl font-extrabold">Service Health Grid</h2>
          </div>
          <div className="grid grid-cols-5 gap-4">
            {services.map((svc) => {
              const chaosInfo = killedServices[svc.key];
              const wasKilled = chaosInfo && !chaosInfo.recovered;
              const justRecovered = chaosInfo?.recovered && Date.now() - chaosInfo.killedAt < 60000;
              const isDown = wasKilled && !svc.isUp;
              return (
                <motion.div key={svc.key} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: isDown ? [1, 0.97, 1] : 1 }}
                  transition={{ scale: { repeat: isDown ? Infinity : 0, duration: 1.5 } }}
                  className={`glass-card p-5 text-center relative overflow-hidden border-2 transition-colors ${
                    isDown ? "border-red-500/70" : justRecovered ? "border-green-500/50" : "border-white/5 hover:border-white/15"
                  }`}>
                  <div className={`absolute inset-0 transition-all duration-500 ${isDown ? "bg-red-500 opacity-20 animate-pulse" : justRecovered ? "bg-green-500 opacity-10" : svc.isUp ? "bg-green-500 opacity-[0.03]" : "bg-red-500 opacity-10"}`} />
                  <AnimatePresence>
                    {isDown && (
                      <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }}
                        className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-10">
                        <span className="text-4xl mb-2">💀</span>
                        <span className="text-red-400 text-xs font-bold uppercase tracking-wider">Service Killed</span>
                        <span className="text-red-300 text-xl font-mono font-bold mt-1">{chaosTimers[svc.key] || 0}s</span>
                        <div className="mt-2 flex gap-1">
                          {[0, 200, 400].map((d) => <span key={d} className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {justRecovered && svc.isUp && (
                    <motion.div initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: 3, duration: 1 }} className="absolute top-2 right-2 z-10">
                      <span className="text-[10px] bg-green-500/30 text-green-300 px-2 py-0.5 rounded-full font-bold">✅ Recovered</span>
                    </motion.div>
                  )}
                  <div className={`w-4 h-4 rounded-full mx-auto mb-3 transition-all ${svc.isUp ? "bg-green-400 shadow-[0_0_12px_rgba(74,222,128,0.6)]" : "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)] animate-pulse"}`} />
                  <h3 className="font-bold text-sm mb-1">{svc.name}</h3>
                  <p className={`text-xs font-bold uppercase tracking-wider ${isDown ? "text-red-400" : svc.isUp ? "text-green-400" : "text-red-400"}`}>
                    {isDown ? "KILLED" : svc.isUp ? "HEALTHY" : "DOWN"}
                  </p>
                  {svc.metrics && (
                    <div className="mt-3 space-y-1 text-xs text-gray-400">
                      <p>Reqs: {svc.metrics.requestCount}</p>
                      <p>Latency: {Math.round(svc.metrics.avgLatencyMs)}ms</p>
                      <p>Uptime: {formatUptime(svc.metrics.uptime)}</p>
                    </div>
                  )}
                  {svc.health?.dependencies && (
                    <div className="mt-3 flex flex-wrap gap-1 justify-center">
                      {Object.entries(svc.health.dependencies).map(([dep, info]) => (
                        <span key={dep} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${info.status === "ok" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{dep}</span>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* Charts */}
        <div className="grid grid-cols-2 gap-6">
          <motion.div {...fadeUp} className="glass-card p-5">
            <h3 className="font-bold mb-4 flex items-center gap-2">📈 Service Latency <span className="text-xs text-gray-500 font-normal">(ms)</span></h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={latencyHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: "#4b5563", fontSize: 10 }} />
                <YAxis tick={{ fill: "#4b5563", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#1e1b4b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px" }} labelStyle={{ color: "#e2e8f0" }} />
                <Line type="monotone" dataKey="gateway" stroke="#a78bfa" strokeWidth={2} dot={false} name="Gateway" />
                <Line type="monotone" dataKey="identity" stroke="#38bdf8" strokeWidth={2} dot={false} name="Identity" />
                <Line type="monotone" dataKey="stock" stroke="#34d399" strokeWidth={2} dot={false} name="Stock" />
                <Line type="monotone" dataKey="kitchen" stroke="#fb923c" strokeWidth={2} dot={false} name="Kitchen" />
                <Line type="monotone" dataKey="notification" stroke="#f472b6" strokeWidth={2} dot={false} name="Notification" />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>
          <motion.div {...fadeUp} className="glass-card p-5">
            <h3 className="font-bold mb-4 flex items-center gap-2">📦 Orders Processed</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={ordersHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: "#4b5563", fontSize: 10 }} />
                <YAxis tick={{ fill: "#4b5563", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#1e1b4b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px" }} labelStyle={{ color: "#e2e8f0" }} />
                <Bar dataKey="orders" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* Chaos Engineering */}
        <motion.div {...fadeUp} className="glass-card p-6 border-2 border-red-500/15 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-red-900/10 to-transparent pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="font-extrabold text-xl">💥 Chaos Engineering</h3>
              <span className="bg-red-500/20 text-red-400 text-[10px] font-extrabold uppercase tracking-widest px-3 py-1 rounded-full border border-red-500/30">Danger Zone</span>
            </div>
            <p className="text-xs text-gray-500 mb-5">Kill a service to simulate a crash. Watch recovery in real-time.</p>
            <div className="grid grid-cols-5 gap-3 mb-5">
              {services.map((svc) => {
                const isKilled = killedServices[svc.key] && !killedServices[svc.key].recovered && !svc.isUp;
                return (
                  <motion.button key={svc.key} whileHover={svc.isUp && !isKilled ? { scale: 1.03 } : {}} whileTap={svc.isUp && !isKilled ? { scale: 0.97 } : {}}
                    onClick={() => killService(svc)} disabled={!svc.isUp || !!isKilled}
                    className={`px-4 py-3.5 rounded-xl text-sm font-bold transition-all relative overflow-hidden ${
                      isKilled ? "bg-red-900/30 border-2 border-red-500/40 text-red-300 cursor-not-allowed"
                      : svc.isUp ? "bg-red-500/10 border-2 border-red-500/25 text-red-400 hover:bg-red-500/20 hover:shadow-lg hover:shadow-red-500/20 hover:border-red-500/50"
                      : "bg-gray-800/50 border-2 border-gray-700/30 text-gray-600 cursor-not-allowed"
                    }`}>
                    {isKilled && <span className="absolute inset-0 bg-red-500/10 animate-pulse" />}
                    <span className="relative z-10 flex items-center justify-center gap-1.5">
                      {isKilled ? "💀" : "☠️"} {isKilled ? "Killed" : `Kill ${svc.name}`}
                    </span>
                  </motion.button>
                );
              })}
            </div>
            {chaosLog.length > 0 && (
              <div className="bg-black/40 rounded-xl p-4 max-h-48 overflow-y-auto border border-white/5">
                <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-2 font-bold">Event Timeline</p>
                {chaosLog.map((log, i) => (
                  <motion.div key={`${log}-${i}`} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                    className={`flex items-center gap-2 py-1.5 ${i > 0 ? "border-t border-white/5" : ""}`}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${log.includes("✅") ? "bg-green-400" : log.includes("💀") ? "bg-red-500" : "bg-yellow-500"}`} />
                    <p className={`text-xs font-mono ${log.includes("✅") ? "text-green-400" : log.includes("💀") ? "text-red-400" : "text-yellow-400"}`}>{log}</p>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* Detailed Metrics Table */}
        <motion.div {...fadeUp} className="glass-card p-5">
          <h3 className="font-extrabold text-lg mb-4 flex items-center gap-2">📋 Detailed Metrics</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-gray-500 border-b border-white/10 uppercase text-xs tracking-wider">
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
                  <tr key={svc.key} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 font-semibold">{svc.name}</td>
                    <td className="py-3.5">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${svc.isUp ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        {svc.isUp ? "UP" : "DOWN"}
                      </span>
                    </td>
                    <td className="py-3.5 font-medium">{svc.metrics?.requestCount || 0}</td>
                    <td className="py-3.5 text-red-400 font-medium">{svc.metrics?.errorCount || 0}</td>
                    <td className="py-3.5 font-medium">{Math.round(svc.metrics?.avgLatencyMs || 0)}ms</td>
                    <td className="py-3.5 font-medium">{svc.metrics?.ordersProcessed || "—"}</td>
                    <td className="py-3.5 text-gray-400">{formatUptime(svc.metrics?.uptime || 0)}</td>
                    <td className="py-3.5 text-gray-500 text-xs">
                      {svc.metrics?.connectedClients !== undefined && `WS: ${svc.metrics.connectedClients}`}
                      {svc.metrics?.kitchenProcessingTimeMs !== undefined && `Cook: ${svc.metrics.kitchenProcessingTimeMs}ms`}
                      {svc.metrics?.notificationsSent !== undefined && `Sent: ${svc.metrics.notificationsSent}`}
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
