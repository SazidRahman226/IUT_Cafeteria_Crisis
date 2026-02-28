import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

// ==========================================
// Types
// ==========================================
interface User {
    studentId: string;
    name: string;
    role: string;
}

interface MenuItem {
    itemId: string;
    name: string;
    description: string;
    price: number;
    category: string;
    imageUrl: string;
    availableQty: number;
}

interface Order {
    orderId: string;
    studentId: string;
    items: Array<{ itemId: string; name: string; quantity: number; price: number }>;
    totalAmount: number;
    status: string;
    createdAt: string;
}

interface CartItem extends MenuItem {
    quantity: number;
}

type StudentScreen = 'menu' | 'orders';

// ==========================================
// API Config
// ==========================================
const API_BASE = window.location.hostname === 'localhost' && window.location.port === '3000'
    ? '' : '';
const GATEWAY_URL = API_BASE || (window.location.port === '80' || window.location.port === ''
    ? `${window.location.protocol}//${window.location.hostname}:8080` : 'http://localhost:8080');
const AUTH_URL = API_BASE || (window.location.port === '80' || window.location.port === ''
    ? `${window.location.protocol}//${window.location.hostname}:4001` : 'http://localhost:4001');
const WS_URL = window.location.port === '80' || window.location.port === ''
    ? `ws://${window.location.hostname}:4005/ws` : 'ws://localhost:4005/ws';

// ==========================================
// Admin Dashboard Types & Config
// ==========================================
const SERVICES = [
    { name: 'Identity Provider', key: 'identity-provider', port: 4001, color: '#38bdf8' },
    { name: 'Order Gateway', key: 'order-gateway', port: 8080, color: '#a78bfa' },
    { name: 'Stock Service', key: 'stock-service', port: 4002, color: '#34d399' },
    { name: 'Kitchen Service', key: 'kitchen-service', port: 4003, color: '#fb923c' },
    { name: 'Notification Hub', key: 'notification-hub', port: 4005, color: '#f472b6' },
];

const BASE_HOST = window.location.hostname || 'localhost';

function getServiceUrl(port: number) {
    return `http://${BASE_HOST}:${port}`;
}

interface HealthData {
    status: string;
    service: string;
    uptime: number;
    dependencies: Record<string, { status: string; latency?: number }>;
}

interface MetricsData {
    service: string;
    requestCount: number;
    errorCount: number;
    avgLatencyMs: number;
    recentAvgLatencyMs?: number;
    ordersProcessed: number;
    uptime: number;
    connectedClients?: number;
    notificationsSent?: number;
    kitchenProcessingTimeMs?: number;
}

interface ServiceState {
    name: string;
    key: string;
    port: number;
    color: string;
    health: HealthData | null;
    metrics: MetricsData | null;
    isUp: boolean;
    lastCheck: Date;
}

interface LatencyPoint {
    time: string;
    gateway: number;
    identity: number;
    stock: number;
}

// ==========================================
// Main App — Unified Login + Role-based Dashboard
// ==========================================
export default function App() {
    const [user, setUser] = useState<User | null>(() => {
        const saved = localStorage.getItem('cafeteria_user');
        return saved ? JSON.parse(saved) : null;
    });
    const [token, setToken] = useState<string>(() => localStorage.getItem('cafeteria_token') || '');
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState('');

    const handleLogin = async (studentId: string, password: string) => {
        setLoginLoading(true);
        setLoginError('');
        try {
            const res = await fetch(`${AUTH_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId, password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || 'Login failed');

            setToken(data.accessToken);
            setUser(data.user);
            localStorage.setItem('cafeteria_token', data.accessToken);
            localStorage.setItem('cafeteria_user', JSON.stringify(data.user));
        } catch (err: any) {
            setLoginError(err.message);
        } finally {
            setLoginLoading(false);
        }
    };

    const handleLogout = () => {
        setUser(null);
        setToken('');
        localStorage.removeItem('cafeteria_token');
        localStorage.removeItem('cafeteria_user');
    };

    // Not logged in — show unified login
    if (!user || !token) {
        return <LoginScreen onLogin={handleLogin} loading={loginLoading} error={loginError} />;
    }

    // Logged in — route by role
    if (user.role === 'admin') {
        return <AdminDashboard user={user} token={token} onLogout={handleLogout} />;
    }

    return <StudentDashboard user={user} token={token} onLogout={handleLogout} />;
}

// ==========================================
// Unified Login Screen
// ==========================================
function LoginScreen({ onLogin, loading, error }: {
    onLogin: (id: string, pw: string) => void;
    loading: boolean;
    error: string;
}) {
    const [studentId, setStudentId] = useState('');
    const [password, setPassword] = useState('');

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.5 }}
            className="min-h-screen flex items-center justify-center p-4"
        >
            <div className="glass-card p-8 w-full max-w-md">
                <motion.div
                    initial={{ y: -20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="text-center mb-8"
                >
                    <div className="text-5xl mb-4">🍽️</div>
                    <h1 className="text-3xl font-bold gradient-text">IUT Cafeteria</h1>
                    <p className="text-gray-400 mt-2">DevSprint 2026</p>
                </motion.div>

                <motion.form
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    onSubmit={(e) => { e.preventDefault(); onLogin(studentId, password); }}
                    className="space-y-4"
                >
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">User ID</label>
                        <input
                            type="text"
                            value={studentId}
                            onChange={e => setStudentId(e.target.value)}
                            className="input-field w-full px-4 py-3 rounded-xl"
                            placeholder="e.g. student1 or admin1"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="input-field w-full px-4 py-3 rounded-xl"
                            placeholder="••••••••"
                            required
                        />
                    </div>

                    {error && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
                            {error}
                        </motion.div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary w-full py-3 rounded-xl text-white font-semibold disabled:opacity-50"
                    >
                        {loading ? (
                            <span className="flex items-center justify-center gap-2">
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Signing in...
                            </span>
                        ) : 'Sign In'}
                    </button>

                    <p className="text-center text-gray-500 text-xs mt-4">
                        Student: student1 / password123 &bull; Admin: admin1 / password123
                    </p>
                </motion.form>
            </div>
        </motion.div>
    );
}

// ==========================================
// Student Dashboard
// ==========================================
function StudentDashboard({ user, token, onLogout }: { user: User; token: string; onLogout: () => void }) {
    const [screen, setScreen] = useState<StudentScreen>('menu');
    const [menu, setMenu] = useState<MenuItem[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [wsConnected, setWsConnected] = useState(false);
    const [notification, setNotification] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const wsRef = useRef<WebSocket | null>(null);

    // WebSocket Connection
    const connectWebSocket = useCallback((accessToken: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        const ws = new WebSocket(`${WS_URL}?token=${accessToken}`);
        wsRef.current = ws;

        ws.onopen = () => {
            setWsConnected(true);
            console.log('WebSocket connected');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'ORDER_STATUS_UPDATE') {
                    setOrders(prev => prev.map(o =>
                        o.orderId === data.orderId ? { ...o, status: data.status } : o
                    ));
                    setNotification(`Order ${data.orderId.slice(0, 8)}... → ${data.status}`);
                    setTimeout(() => setNotification(''), 4000);
                }
            } catch (e) {
                console.error('WS parse error:', e);
            }
        };

        ws.onclose = () => {
            setWsConnected(false);
            console.log('WebSocket disconnected, reconnecting in 3s...');
            setTimeout(() => connectWebSocket(accessToken), 3000);
        };

        ws.onerror = () => {
            setWsConnected(false);
        };
    }, []);

    useEffect(() => {
        connectWebSocket(token);
        fetchMenu();
        return () => { wsRef.current?.close(); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleLogout = () => {
        wsRef.current?.close();
        setCart([]);
        setOrders([]);
        onLogout();
    };

    // Menu
    const fetchMenu = async () => {
        try {
            const res = await fetch(`${GATEWAY_URL}/api/menu`);
            if (res.ok) {
                const data = await res.json();
                setMenu(data);
            }
        } catch (err) {
            console.error('Failed to fetch menu:', err);
        }
    };

    // Cart
    const addToCart = (item: MenuItem) => {
        setCart(prev => {
            const existing = prev.find(c => c.itemId === item.itemId);
            if (existing) {
                return prev.map(c => c.itemId === item.itemId ? { ...c, quantity: c.quantity + 1 } : c);
            }
            return [...prev, { ...item, quantity: 1 }];
        });
    };

    const removeFromCart = (itemId: string) => {
        setCart(prev => prev.filter(c => c.itemId !== itemId));
        setError('');
    };

    const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // Place Order
    const placeOrder = async () => {
        if (cart.length === 0) return;
        setLoading(true);
        setError('');
        try {
            const idempotencyKey = crypto.randomUUID();
            const res = await fetch(`${GATEWAY_URL}/api/orders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Idempotency-Key': idempotencyKey,
                },
                body: JSON.stringify({
                    items: cart.map(c => ({
                        itemId: c.itemId,
                        name: c.name,
                        quantity: c.quantity,
                        price: c.price,
                    })),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || 'Order failed');

            setOrders(prev => [data, ...prev]);
            setCart([]);
            setNotification('Order placed successfully! 🎉');
            setTimeout(() => setNotification(''), 3000);
            setScreen('orders');
            fetchMenu();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Fetch Orders
    const fetchOrders = async () => {
        try {
            const res = await fetch(`${GATEWAY_URL}/api/orders`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setOrders(data);
            }
        } catch (err) {
            console.error('Failed to fetch orders:', err);
        }
    };

    useEffect(() => {
        if (screen === 'orders') fetchOrders();
    }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="min-h-screen">
            {/* Notification Toast */}
            <AnimatePresence>
                {notification && (
                    <motion.div
                        initial={{ opacity: 0, y: -50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -50 }}
                        className="fixed top-4 right-4 z-50 glass-card px-6 py-3 text-sm font-medium text-white shadow-lg"
                    >
                        {notification}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* WebSocket Indicator */}
            <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 glass px-3 py-1.5 rounded-full text-xs">
                <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400 status-pulse' : 'bg-red-400 animate-pulse'}`} />
                {wsConnected ? 'Live' : 'Reconnecting...'}
            </div>

            <AnimatePresence mode="wait">
                {screen === 'menu' && (
                    <MenuScreen
                        key="menu"
                        user={user}
                        menu={menu}
                        cart={cart}
                        cartTotal={cartTotal}
                        onAddToCart={addToCart}
                        onRemoveFromCart={removeFromCart}
                        onPlaceOrder={placeOrder}
                        onGoOrders={() => setScreen('orders')}
                        onLogout={handleLogout}
                        loading={loading}
                        error={error}
                    />
                )}
                {screen === 'orders' && (
                    <OrdersScreen
                        key="orders"
                        user={user}
                        orders={orders}
                        onGoMenu={() => setScreen('menu')}
                        onLogout={handleLogout}
                        onRefresh={fetchOrders}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

// ==========================================
// Menu Screen
// ==========================================
function MenuScreen({ user, menu, cart, cartTotal, onAddToCart, onRemoveFromCart, onPlaceOrder, onGoOrders, onLogout, loading, error }: {
    user: User;
    menu: MenuItem[];
    cart: CartItem[];
    cartTotal: number;
    onAddToCart: (item: MenuItem) => void;
    onRemoveFromCart: (id: string) => void;
    onPlaceOrder: () => void;
    onGoOrders: () => void;
    onLogout: () => void;
    loading: boolean;
    error: string;
}) {
    const categories = [...new Set(menu.map(m => m.category))];

    return (
        <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="min-h-screen"
        >
            {/* Header */}
            <header className="glass sticky top-0 z-40 px-6 py-4">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">🍽️</span>
                        <div>
                            <h1 className="text-lg font-bold gradient-text">IUT Cafeteria</h1>
                            <p className="text-xs text-gray-400">Welcome, {user.name}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={onGoOrders}
                            className="glass px-4 py-2 rounded-xl text-sm hover:bg-white/10 transition">
                            📋 My Orders
                        </button>
                        <button onClick={onLogout}
                            className="glass px-4 py-2 rounded-xl text-sm hover:bg-white/10 transition text-red-400">
                            Logout
                        </button>
                    </div>
                </div>
            </header>

            <div className="max-w-7xl mx-auto p-6 flex gap-6">
                {/* Menu Items */}
                <div className="flex-1">
                    <h2 className="text-2xl font-bold mb-6">Today's Menu</h2>
                    {categories.map(cat => (
                        <div key={cat} className="mb-8">
                            <h3 className="text-lg font-semibold text-primary-400 mb-4">{cat}</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {menu.filter(m => m.category === cat).map(item => (
                                    <motion.div
                                        key={item.itemId}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        className="glass-card p-4 flex items-center gap-4 cursor-pointer"
                                        onClick={() => item.availableQty > 0 && onAddToCart(item)}
                                    >
                                        <div className="text-4xl">{item.imageUrl}</div>
                                        <div className="flex-1">
                                            <h4 className="font-semibold">{item.name}</h4>
                                            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                                            <div className="flex items-center justify-between mt-2">
                                                <span className="text-primary-400 font-bold">৳{item.price}</span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${item.availableQty > 10 ? 'bg-green-500/20 text-green-400'
                                                        : item.availableQty > 0 ? 'bg-yellow-500/20 text-yellow-400'
                                                            : 'bg-red-500/20 text-red-400'
                                                    }`}>
                                                    {item.availableQty > 0 ? `${item.availableQty} left` : 'Sold Out'}
                                                </span>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Cart Sidebar */}
                <div className="w-80 shrink-0">
                    <div className="glass-card p-5 sticky top-24">
                        <h3 className="text-lg font-bold mb-4">🛒 Cart ({cart.length})</h3>
                        {cart.length === 0 ? (
                            <p className="text-gray-500 text-sm text-center py-8">Your cart is empty</p>
                        ) : (
                            <>
                                <div className="space-y-3 max-h-64 overflow-y-auto mb-4">
                                    {cart.map(item => (
                                        <div key={item.itemId} className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span>{item.imageUrl}</span>
                                                <div>
                                                    <p className="text-sm font-medium">{item.name}</p>
                                                    <p className="text-xs text-gray-400">x{item.quantity} • ৳{item.price * item.quantity}</p>
                                                </div>
                                            </div>
                                            <button onClick={() => onRemoveFromCart(item.itemId)}
                                                className="text-red-400 hover:text-red-300 text-xs">✕</button>
                                        </div>
                                    ))}
                                </div>
                                <div className="border-t border-white/10 pt-4">
                                    <div className="flex justify-between font-bold mb-4">
                                        <span>Total</span>
                                        <span className="gradient-text">৳{cartTotal}</span>
                                    </div>

                                    {error && (
                                        <p className="text-red-400 text-xs mb-3">{error}</p>
                                    )}

                                    <button
                                        onClick={onPlaceOrder}
                                        disabled={loading}
                                        className="btn-primary w-full py-3 rounded-xl text-white font-semibold disabled:opacity-50"
                                    >
                                        {loading ? 'Placing...' : 'Place Order'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

// ==========================================
// Orders Screen
// ==========================================
function OrdersScreen({ user, orders, onGoMenu, onLogout, onRefresh }: {
    user: User;
    orders: Order[];
    onGoMenu: () => void;
    onLogout: () => void;
    onRefresh: () => void;
}) {
    const statusSteps = ['PENDING', 'STOCK_VERIFIED', 'IN_KITCHEN', 'READY'];
    const statusLabels: Record<string, string> = {
        PENDING: '⏳ Pending',
        STOCK_VERIFIED: '✅ Stock Verified',
        PENDING_QUEUE: '📤 Queuing',
        IN_KITCHEN: '👨‍🍳 In Kitchen',
        READY: '🎉 Ready!',
        FAILED: '❌ Failed',
    };
    const statusColors: Record<string, string> = {
        PENDING: 'text-yellow-400',
        STOCK_VERIFIED: 'text-blue-400',
        PENDING_QUEUE: 'text-orange-400',
        IN_KITCHEN: 'text-purple-400',
        READY: 'text-green-400',
        FAILED: 'text-red-400',
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="min-h-screen"
        >
            {/* Header */}
            <header className="glass sticky top-0 z-40 px-6 py-4">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onGoMenu} className="text-gray-400 hover:text-white transition">← Back</button>
                        <h1 className="text-lg font-bold gradient-text">My Orders</h1>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={onRefresh}
                            className="glass px-4 py-2 rounded-xl text-sm hover:bg-white/10 transition">🔄 Refresh</button>
                        <button onClick={onLogout}
                            className="glass px-4 py-2 rounded-xl text-sm hover:bg-white/10 transition text-red-400">Logout</button>
                    </div>
                </div>
            </header>

            <div className="max-w-5xl mx-auto p-6">
                {orders.length === 0 ? (
                    <div className="text-center py-20 text-gray-500">
                        <div className="text-5xl mb-4">📦</div>
                        <p>No orders yet. Go grab something delicious!</p>
                        <button onClick={onGoMenu} className="btn-primary px-6 py-2 rounded-xl mt-4 text-white">Browse Menu</button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {orders.map((order, idx) => (
                            <motion.div
                                key={order.orderId}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.1 }}
                                className="glass-card p-5"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <p className="text-xs text-gray-500">Order #{order.orderId.slice(0, 8)}</p>
                                        <p className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleString()}</p>
                                    </div>
                                    <motion.span
                                        key={order.status}
                                        initial={{ scale: 0.8, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        className={`text-sm font-semibold ${statusColors[order.status] || 'text-gray-400'}`}
                                    >
                                        {statusLabels[order.status] || order.status}
                                    </motion.span>
                                </div>

                                {/* Status Timeline */}
                                <div className="flex items-center gap-1 mb-4">
                                    {statusSteps.map((step, i) => {
                                        const currentIdx = statusSteps.indexOf(order.status);
                                        const isActive = i <= currentIdx;
                                        const isCurrent = step === order.status;
                                        return (
                                            <div key={step} className="flex items-center flex-1">
                                                <motion.div
                                                    animate={isCurrent ? { scale: [1, 1.3, 1] } : {}}
                                                    transition={{ repeat: isCurrent ? Infinity : 0, duration: 1.5 }}
                                                    className={`w-3 h-3 rounded-full shrink-0 ${isActive ? 'bg-primary-400' : 'bg-gray-700'
                                                        } ${isCurrent ? 'ring-2 ring-primary-400/50' : ''}`}
                                                />
                                                {i < statusSteps.length - 1 && (
                                                    <div className={`h-0.5 flex-1 mx-1 ${isActive ? 'bg-primary-400' : 'bg-gray-700'}`} />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="flex justify-between text-[10px] text-gray-500 mb-4">
                                    <span>Pending</span>
                                    <span>Verified</span>
                                    <span>Kitchen</span>
                                    <span>Ready</span>
                                </div>

                                {/* Order Items */}
                                <div className="space-y-1 border-t border-white/5 pt-3">
                                    {order.items.map((item, j) => (
                                        <div key={j} className="flex justify-between text-sm">
                                            <span className="text-gray-300">{item.name || item.itemId} x{item.quantity}</span>
                                            <span className="text-gray-400">৳{(item.price || 0) * item.quantity}</span>
                                        </div>
                                    ))}
                                    <div className="flex justify-between font-bold pt-2 border-t border-white/5">
                                        <span>Total</span>
                                        <span className="gradient-text">৳{order.totalAmount}</span>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </motion.div>
    );
}

// ==========================================
// Admin Dashboard
// ==========================================
function AdminDashboard({ user, token, onLogout }: { user: User; token: string; onLogout: () => void }) {
    const [services, setServices] = useState<ServiceState[]>(
        SERVICES.map(s => ({ ...s, health: null, metrics: null, isUp: false, lastCheck: new Date() }))
    );
    const [latencyHistory, setLatencyHistory] = useState<LatencyPoint[]>([]);
    const [ordersHistory, setOrdersHistory] = useState<{ time: string; orders: number }[]>([]);
    const [gatewayAlert, setGatewayAlert] = useState(false);
    const [chaosLog, setChaosLog] = useState<string[]>([]);
    const [killedServices, setKilledServices] = useState<Record<string, { killedAt: number; recovered: boolean }>>({});
    const [chaosTimers, setChaosTimers] = useState<Record<string, number>>({});

    // Chaos recovery detection + downtime timers
    useEffect(() => {
        const interval = setInterval(() => {
            setChaosTimers(() => {
                const timers: Record<string, number> = {};
                for (const [key, info] of Object.entries(killedServices)) {
                    if (!info.recovered) {
                        timers[key] = Math.floor((Date.now() - info.killedAt) / 1000);
                    }
                }
                return timers;
            });
        }, 500);
        return () => clearInterval(interval);
    }, [killedServices]);

    // Detect recovery
    useEffect(() => {
        for (const svc of services) {
            const info = killedServices[svc.key];
            if (info && !info.recovered && svc.isUp) {
                const downtime = Math.floor((Date.now() - info.killedAt) / 1000);
                setKilledServices(prev => ({ ...prev, [svc.key]: { ...prev[svc.key], recovered: true } }));
                const msg = `✅ ${svc.name} recovered after ${downtime}s downtime`;
                setChaosLog(prev => [msg, ...prev].slice(0, 20));
            }
        }
    }, [services, killedServices]);

    // Polling
    const pollServices = useCallback(async () => {
        const updated = await Promise.all(
            SERVICES.map(async (svc) => {
                let health: HealthData | null = null;
                let metrics: MetricsData | null = null;
                let isUp = false;

                try {
                    const hRes = await fetch(`${getServiceUrl(svc.port)}/health`, { signal: AbortSignal.timeout(3000) });
                    if (hRes.ok) {
                        health = await hRes.json();
                        isUp = health?.status === 'ok';
                    }
                } catch { }

                try {
                    const mRes = await fetch(`${getServiceUrl(svc.port)}/metrics/json`, { signal: AbortSignal.timeout(3000) });
                    if (mRes.ok) {
                        metrics = await mRes.json();
                    }
                } catch {
                    try {
                        const mRes = await fetch(`${getServiceUrl(svc.port)}/metrics`, { signal: AbortSignal.timeout(3000) });
                        if (mRes.ok) {
                            const text = await mRes.text();
                            metrics = parsePrometheusMetrics(text, svc.key);
                        }
                    } catch { }
                }

                return { ...svc, health, metrics, isUp, lastCheck: new Date() };
            })
        );

        setServices(updated);

        const now = new Date().toLocaleTimeString();
        const gw = updated.find(s => s.key === 'order-gateway');
        const id = updated.find(s => s.key === 'identity-provider');
        const st = updated.find(s => s.key === 'stock-service');

        setLatencyHistory(prev => {
            const next = [...prev, {
                time: now,
                gateway: gw?.metrics?.avgLatencyMs || 0,
                identity: id?.metrics?.avgLatencyMs || 0,
                stock: st?.metrics?.avgLatencyMs || 0,
            }];
            return next.slice(-30);
        });

        setOrdersHistory(prev => {
            const totalOrders = updated.reduce((sum, s) => sum + (s.metrics?.ordersProcessed || 0), 0);
            const next = [...prev, { time: now, orders: totalOrders }];
            return next.slice(-30);
        });

        const recentLatency = gw?.metrics?.recentAvgLatencyMs || gw?.metrics?.avgLatencyMs || 0;
        setGatewayAlert(recentLatency > 1000);
    }, []);

    useEffect(() => {
        pollServices();
        const interval = setInterval(pollServices, 5000);
        return () => clearInterval(interval);
    }, [pollServices]);

    // Chaos
    const killService = async (svc: ServiceState) => {
        try {
            await fetch(`${getServiceUrl(svc.port)}/chaos/kill`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
            });
            const msg = `💀 ${svc.name} killed at ${new Date().toLocaleTimeString()}`;
            setChaosLog(prev => [msg, ...prev].slice(0, 20));
            setKilledServices(prev => ({ ...prev, [svc.key]: { killedAt: Date.now(), recovered: false } }));
            setTimeout(pollServices, 2000);
            setTimeout(pollServices, 5000);
            setTimeout(pollServices, 8000);
        } catch {
            const msg = `⚠️ Could not reach ${svc.name}`;
            setChaosLog(prev => [msg, ...prev].slice(0, 20));
        }
    };

    const totalRequests = services.reduce((s, svc) => s + (svc.metrics?.requestCount || 0), 0);
    const totalErrors = services.reduce((s, svc) => s + (svc.metrics?.errorCount || 0), 0);
    const totalOrders = services.reduce((s, svc) => s + (svc.metrics?.ordersProcessed || 0), 0);
    const healthyCount = services.filter(s => s.isUp).length;

    return (
        <div className="min-h-screen p-6">
            {/* Gateway Latency Alert */}
            <AnimatePresence>
                {gatewayAlert && (
                    <motion.div
                        initial={{ opacity: 0, y: -30 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -30 }}
                        className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 backdrop-blur px-6 py-3 rounded-xl text-white font-semibold shadow-lg shadow-red-500/30 flex items-center gap-2"
                    >
                        <span className="animate-pulse">⚠️</span>
                        Gateway avg response &gt; 1s over last 30s!
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Header */}
            <header className="max-w-7xl mx-auto mb-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
                            🛡️ Admin Dashboard
                        </h1>
                        <p className="text-gray-500 text-sm mt-1">DevSprint 2026 — IUT Cafeteria Crisis Control</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                        <div className="glass-card px-4 py-2">
                            <span className="text-gray-400">Services: </span>
                            <span className={healthyCount === 5 ? 'text-green-400' : 'text-yellow-400'}>
                                {healthyCount}/5
                            </span>
                        </div>
                        <span className="text-gray-400">Welcome, {user.name}</span>
                        <button onClick={onLogout}
                            className="text-red-400 hover:text-red-300 transition">Logout</button>
                    </div>
                </div>
            </header>

            <div className="max-w-7xl mx-auto space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-4 gap-4">
                    {[
                        { label: 'Total Requests', value: totalRequests, icon: '📊', color: 'cyan' },
                        { label: 'Total Orders', value: totalOrders, icon: '📦', color: 'purple' },
                        { label: 'Total Errors', value: totalErrors, icon: '❌', color: 'red' },
                        { label: 'Healthy', value: `${healthyCount}/5`, icon: '💚', color: 'green' },
                    ].map((stat, i) => (
                        <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="glass-card p-4"
                        >
                            <div className="text-2xl mb-1">{stat.icon}</div>
                            <p className="text-2xl font-bold">{stat.value}</p>
                            <p className="text-xs text-gray-500">{stat.label}</p>
                        </motion.div>
                    ))}
                </div>

                {/* Health Grid */}
                <div>
                    <h2 className="text-xl font-bold mb-4">Service Health Grid</h2>
                    <div className="grid grid-cols-5 gap-4">
                        {services.map((svc) => {
                            const chaosInfo = killedServices[svc.key];
                            const wasKilled = chaosInfo && !chaosInfo.recovered;
                            const justRecovered = chaosInfo?.recovered && (Date.now() - chaosInfo.killedAt) < 60000;
                            const downSeconds = chaosTimers[svc.key] || 0;

                            return (
                                <motion.div
                                    key={svc.key}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{
                                        opacity: 1,
                                        scale: wasKilled && !svc.isUp ? [1, 0.97, 1] : 1,
                                        borderColor: wasKilled && !svc.isUp ? 'rgba(239,68,68,0.7)' : justRecovered ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.05)',
                                    }}
                                    transition={{
                                        scale: { repeat: wasKilled && !svc.isUp ? Infinity : 0, duration: 1.5 },
                                        borderColor: { duration: 0.5 },
                                    }}
                                    className={`glass-card p-5 text-center relative overflow-hidden border-2 ${wasKilled && !svc.isUp ? 'border-red-500/70' : justRecovered ? 'border-green-500/50' : 'border-transparent'
                                        }`}
                                >
                                    <div className={`absolute inset-0 transition-all duration-500 ${wasKilled && !svc.isUp ? 'bg-red-500 opacity-20 animate-pulse' :
                                            justRecovered ? 'bg-green-500 opacity-10' :
                                                svc.isUp ? 'bg-green-500 opacity-5' : 'bg-red-500 opacity-10'
                                        }`} />

                                    <AnimatePresence>
                                        {wasKilled && !svc.isUp && (
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.5 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.5 }}
                                                className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10"
                                            >
                                                <span className="text-4xl mb-2">💀</span>
                                                <span className="text-red-400 text-xs font-bold uppercase tracking-wider">Service Killed</span>
                                                <span className="text-red-300 text-lg font-mono font-bold mt-1">{downSeconds}s</span>
                                                <span className="text-gray-500 text-[10px] mt-1">waiting for recovery...</span>
                                                <div className="mt-2 flex gap-1">
                                                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                                                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: '400ms' }} />
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    <AnimatePresence>
                                        {justRecovered && svc.isUp && (
                                            <motion.div
                                                initial={{ opacity: 1, scale: 1 }}
                                                animate={{ opacity: 0 }}
                                                transition={{ delay: 3, duration: 1 }}
                                                className="absolute top-1 right-1 z-10"
                                            >
                                                <span className="text-xs bg-green-500/30 text-green-300 px-2 py-0.5 rounded-full font-bold">
                                                    ✅ Recovered
                                                </span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    <div className={`w-4 h-4 rounded-full mx-auto mb-3 transition-all duration-300 ${svc.isUp ? 'bg-green-400 shadow-lg shadow-green-400/50' : 'bg-red-500 shadow-lg shadow-red-500/50 animate-pulse'
                                        }`} />
                                    <h3 className="font-semibold text-sm mb-1">{svc.name}</h3>
                                    <p className={`text-xs font-medium ${wasKilled && !svc.isUp ? 'text-red-400' :
                                            svc.isUp ? 'text-green-400' : 'text-red-400'
                                        }`}>
                                        {wasKilled && !svc.isUp ? 'KILLED' : svc.isUp ? 'HEALTHY' : 'DOWN'}
                                    </p>
                                    {svc.metrics && (
                                        <div className="mt-2 space-y-1 text-xs text-gray-400">
                                            <p>Reqs: {svc.metrics.requestCount}</p>
                                            <p>Latency: {Math.round(svc.metrics.avgLatencyMs)}ms</p>
                                            <p>Uptime: {formatUptime(svc.metrics.uptime)}</p>
                                        </div>
                                    )}
                                    {svc.health?.dependencies && (
                                        <div className="mt-2 flex flex-wrap gap-1 justify-center">
                                            {Object.entries(svc.health.dependencies).map(([dep, info]) => (
                                                <span key={dep} className={`text-[10px] px-1.5 py-0.5 rounded ${info.status === 'ok' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                                                    }`}>
                                                    {dep}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-2 gap-6">
                    <div className="glass-card p-5">
                        <h3 className="font-bold mb-4">📈 Service Latency (ms)</h3>
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={latencyHistory}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 10 }} />
                                <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
                                <Tooltip
                                    contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                    labelStyle={{ color: '#e2e8f0' }}
                                />
                                <Line type="monotone" dataKey="gateway" stroke="#a78bfa" strokeWidth={2} dot={false} name="Gateway" />
                                <Line type="monotone" dataKey="identity" stroke="#38bdf8" strokeWidth={2} dot={false} name="Identity" />
                                <Line type="monotone" dataKey="stock" stroke="#34d399" strokeWidth={2} dot={false} name="Stock" />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="glass-card p-5">
                        <h3 className="font-bold mb-4">📦 Total Orders Processed</h3>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={ordersHistory}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 10 }} />
                                <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
                                <Tooltip
                                    contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                    labelStyle={{ color: '#e2e8f0' }}
                                />
                                <Bar dataKey="orders" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Chaos Controls */}
                <div className="glass-card p-5">
                    <h3 className="font-bold mb-1 text-lg">💥 Chaos Engineering — Kill Services</h3>
                    <p className="text-xs text-gray-500 mb-4">
                        Kill a service to simulate a crash. Watch the health grid turn red, see the downtime counter, then observe Docker auto-restart it.
                    </p>
                    <div className="grid grid-cols-5 gap-3 mb-4">
                        {services.map(svc => {
                            const chaosInfo = killedServices[svc.key];
                            const isKilledAndDown = chaosInfo && !chaosInfo.recovered && !svc.isUp;

                            return (
                                <button
                                    key={svc.key}
                                    onClick={() => killService(svc)}
                                    disabled={!svc.isUp || !!isKilledAndDown}
                                    className={`px-4 py-3 rounded-xl text-sm font-medium transition-all relative overflow-hidden ${isKilledAndDown
                                            ? 'bg-red-900/40 border border-red-500/50 text-red-300 cursor-not-allowed'
                                            : svc.isUp
                                                ? 'bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 hover:shadow-lg hover:shadow-red-500/20'
                                                : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                        }`}
                                >
                                    {isKilledAndDown && (
                                        <span className="absolute inset-0 bg-red-500/10 animate-pulse" />
                                    )}
                                    <span className="relative z-10">
                                        {isKilledAndDown ? '💀 Killed' : `☠️ Kill ${svc.name.split(' ').pop()}`}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Chaos Event Timeline */}
                    {chaosLog.length > 0 && (
                        <div className="bg-black/40 rounded-xl p-4 max-h-48 overflow-y-auto border border-white/5">
                            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2 font-bold">Event Timeline</p>
                            {chaosLog.map((log, i) => (
                                <motion.div
                                    key={`${log}-${i}`}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className={`flex items-center gap-2 py-1.5 ${i === 0 ? '' : 'border-t border-white/5'}`}
                                >
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.includes('✅') ? 'bg-green-400' : log.includes('💀') ? 'bg-red-500' : 'bg-yellow-500'
                                        }`} />
                                    <p className={`text-xs font-mono ${log.includes('✅') ? 'text-green-400' : log.includes('💀') ? 'text-red-400' : 'text-yellow-400'
                                        }`}>{log}</p>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Detailed Metrics Table */}
                <div className="glass-card p-5">
                    <h3 className="font-bold mb-4">📋 Detailed Metrics</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-gray-500 border-b border-white/10">
                                    <th className="pb-3">Service</th>
                                    <th className="pb-3">Status</th>
                                    <th className="pb-3">Requests</th>
                                    <th className="pb-3">Errors</th>
                                    <th className="pb-3">Avg Latency</th>
                                    <th className="pb-3">Orders</th>
                                    <th className="pb-3">Uptime</th>
                                    <th className="pb-3">Extra</th>
                                </tr>
                            </thead>
                            <tbody>
                                {services.map(svc => (
                                    <tr key={svc.key} className="border-b border-white/5">
                                        <td className="py-3 font-medium">{svc.name}</td>
                                        <td className="py-3">
                                            <span className={`px-2 py-1 rounded-full text-xs ${svc.isUp ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                                                }`}>
                                                {svc.isUp ? 'UP' : 'DOWN'}
                                            </span>
                                        </td>
                                        <td className="py-3">{svc.metrics?.requestCount || 0}</td>
                                        <td className="py-3 text-red-400">{svc.metrics?.errorCount || 0}</td>
                                        <td className="py-3">{Math.round(svc.metrics?.avgLatencyMs || 0)}ms</td>
                                        <td className="py-3">{svc.metrics?.ordersProcessed || '—'}</td>
                                        <td className="py-3 text-gray-400">{formatUptime(svc.metrics?.uptime || 0)}</td>
                                        <td className="py-3 text-gray-500 text-xs">
                                            {svc.metrics?.connectedClients !== undefined && `WS: ${svc.metrics.connectedClients}`}
                                            {svc.metrics?.kitchenProcessingTimeMs !== undefined && `Cook: ${svc.metrics.kitchenProcessingTimeMs}ms`}
                                            {svc.metrics?.notificationsSent !== undefined && `Sent: ${svc.metrics.notificationsSent}`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ==========================================
// Helpers
// ==========================================
function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function parsePrometheusMetrics(text: string, service: string): MetricsData {
    const getValue = (name: string): number => {
        const match = text.match(new RegExp(`${name}\\{[^}]*\\}\\s+(\\d+\\.?\\d*)`));
        return match ? parseFloat(match[1]) : 0;
    };
    return {
        service,
        requestCount: getValue('requests_total'),
        errorCount: getValue('errors_total'),
        avgLatencyMs: getValue('avg_latency_ms'),
        ordersProcessed: getValue('orders_processed_total'),
        uptime: getValue('uptime_seconds'),
    };
}
