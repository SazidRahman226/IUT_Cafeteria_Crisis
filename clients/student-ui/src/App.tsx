import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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

type Screen = 'login' | 'menu' | 'orders';

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
// Main App
// ==========================================
export default function App() {
    const [screen, setScreen] = useState<Screen>(() => localStorage.getItem('student_token') ? 'menu' : 'login');
    const [user, setUser] = useState<User | null>(() => {
        const saved = localStorage.getItem('student_user');
        return saved ? JSON.parse(saved) : null;
    });
    const [token, setToken] = useState<string>(() => localStorage.getItem('student_token') || '');
    const [menu, setMenu] = useState<MenuItem[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [wsConnected, setWsConnected] = useState(false);
    const [notification, setNotification] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const wsRef = useRef<WebSocket | null>(null);

    // ==========================================
    // WebSocket Connection
    // ==========================================
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

    // Restore session on refresh
    useEffect(() => {
        const savedToken = localStorage.getItem('student_token');
        if (savedToken && user) {
            connectWebSocket(savedToken);
            fetchMenu(savedToken);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ==========================================
    // Auth
    // ==========================================
    const handleLogin = async (studentId: string, password: string) => {
        setLoading(true);
        setError('');
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
            localStorage.setItem('student_token', data.accessToken);
            localStorage.setItem('student_user', JSON.stringify(data.user));
            setScreen('menu');
            connectWebSocket(data.accessToken);
            fetchMenu(data.accessToken);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        wsRef.current?.close();
        setUser(null);
        setToken('');
        localStorage.removeItem('student_token');
        localStorage.removeItem('student_user');
        setCart([]);
        setOrders([]);
        setScreen('login');
    };

    // ==========================================
    // Menu
    // ==========================================
    const fetchMenu = async (accessToken?: string) => {
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

    // ==========================================
    // Cart
    // ==========================================
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

    // ==========================================
    // Place Order
    // ==========================================
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
            fetchMenu(token);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // ==========================================
    // Fetch Orders
    // ==========================================
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
        if (screen === 'orders' && token) fetchOrders();
    }, [screen]);

    // ==========================================
    // Render
    // ==========================================
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
            {user && (
                <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 glass px-3 py-1.5 rounded-full text-xs">
                    <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400 status-pulse' : 'bg-red-400 animate-pulse'}`} />
                    {wsConnected ? 'Live' : 'Reconnecting...'}
                </div>
            )}

            <AnimatePresence mode="wait">
                {screen === 'login' && (
                    <LoginScreen key="login" onLogin={handleLogin} loading={loading} error={error} />
                )}
                {screen === 'menu' && (
                    <MenuScreen
                        key="menu"
                        user={user!}
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
                        user={user!}
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
// Login Screen
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
                    <p className="text-gray-400 mt-2">DevSprint 2026 — Student Portal</p>
                </motion.div>

                <motion.form
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    onSubmit={(e) => { e.preventDefault(); onLogin(studentId, password); }}
                    className="space-y-4"
                >
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Student ID</label>
                        <input
                            type="text"
                            value={studentId}
                            onChange={e => setStudentId(e.target.value)}
                            className="input-field w-full px-4 py-3 rounded-xl"
                            placeholder="e.g. student1"
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
                        Demo: student1 / password123 • admin1 / password123
                    </p>
                </motion.form>
            </div>
        </motion.div>
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
