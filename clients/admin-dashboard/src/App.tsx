import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

// ==========================================
// Config
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
// App
// ==========================================
export default function App() {
    const [services, setServices] = useState<ServiceState[]>(
        SERVICES.map(s => ({ ...s, health: null, metrics: null, isUp: false, lastCheck: new Date() }))
    );
    const [latencyHistory, setLatencyHistory] = useState<LatencyPoint[]>([]);
    const [ordersHistory, setOrdersHistory] = useState<{ time: string; orders: number }[]>([]);
    const [gatewayAlert, setGatewayAlert] = useState(false);
    const [token, setToken] = useState(() => localStorage.getItem('admin_token') || '');
    const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('admin_token'));
    const [chaosLog, setChaosLog] = useState<string[]>([]);
    const [killedServices, setKilledServices] = useState<Record<string, { killedAt: number; recovered: boolean }>>({});
    const [chaosTimers, setChaosTimers] = useState<Record<string, number>>({});

    // ==========================================
    // Chaos recovery detection + downtime timers
    // ==========================================
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

    // Detect recovery: service was killed but is now back up
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

    // ==========================================
    // Admin Login
    // ==========================================
    const handleLogin = async (id: string, pw: string) => {
        try {
            const res = await fetch(`${getServiceUrl(4001)}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId: id, password: pw }),
            });
            const data = await res.json();
            if (res.ok && data.user.role === 'admin') {
                setToken(data.accessToken);
                localStorage.setItem('admin_token', data.accessToken);
                setIsLoggedIn(true);
            } else if (res.ok) {
                alert('Admin access required');
            } else {
                alert(data.error?.message || 'Login failed');
            }
        } catch {
            alert('Identity Provider unreachable');
        }
    };

    // ==========================================
    // Polling
    // ==========================================
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
                    // try Prometheus text format
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

        // Latency history
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

        // Gateway latency alert
        const recentLatency = gw?.metrics?.recentAvgLatencyMs || gw?.metrics?.avgLatencyMs || 0;
        setGatewayAlert(recentLatency > 1000);

    }, []);

    useEffect(() => {
        if (!isLoggedIn) return;
        pollServices();
        const interval = setInterval(pollServices, 5000);
        return () => clearInterval(interval);
    }, [isLoggedIn, pollServices]);

    // ==========================================
    // Chaos
    // ==========================================
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
            // Force immediate re-poll after 2s to show DOWN faster
            setTimeout(pollServices, 2000);
            setTimeout(pollServices, 5000);
            setTimeout(pollServices, 8000);
        } catch {
            const msg = `⚠️ Could not reach ${svc.name}`;
            setChaosLog(prev => [msg, ...prev].slice(0, 20));
        }
    };

    // ==========================================
    // Render
    // ==========================================
    if (!isLoggedIn) {
        return <AdminLogin onLogin={handleLogin} />;
    }

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
                        <button onClick={() => { setIsLoggedIn(false); setToken(''); localStorage.removeItem('admin_token'); }}
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
                        {services.map((svc, i) => {
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
                                className={`glass-card p-5 text-center relative overflow-hidden border-2 ${
                                    wasKilled && !svc.isUp ? 'border-red-500/70' : justRecovered ? 'border-green-500/50' : 'border-transparent'
                                }`}
                            >
                                {/* Status glow / kill flash */}
                                <div className={`absolute inset-0 transition-all duration-500 ${
                                    wasKilled && !svc.isUp ? 'bg-red-500 opacity-20 animate-pulse' :
                                    justRecovered ? 'bg-green-500 opacity-10' :
                                    svc.isUp ? 'bg-green-500 opacity-5' : 'bg-red-500 opacity-10'
                                }`} />

                                {/* Kill skull overlay */}
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

                                {/* Recovery celebration overlay */}
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
                                <p className={`text-xs font-medium ${
                                    wasKilled && !svc.isUp ? 'text-red-400' :
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
                    {/* Latency Chart */}
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

                    {/* Orders Chart */}
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
                            const isRecovering = chaosInfo && !chaosInfo.recovered && svc.isUp;

                            return (
                            <button
                                key={svc.key}
                                onClick={() => killService(svc)}
                                disabled={!svc.isUp || isKilledAndDown}
                                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all relative overflow-hidden ${
                                    isKilledAndDown
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
                                    {isKilledAndDown ? '💀 Killed' : isRecovering ? '🔄 Recovering' : `☠️ Kill ${svc.name.split(' ').pop()}`}
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
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                        log.includes('✅') ? 'bg-green-400' : log.includes('💀') ? 'bg-red-500' : 'bg-yellow-500'
                                    }`} />
                                    <p className={`text-xs font-mono ${
                                        log.includes('✅') ? 'text-green-400' : log.includes('💀') ? 'text-red-400' : 'text-yellow-400'
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
// Admin Login
// ==========================================
function AdminLogin({ onLogin }: { onLogin: (id: string, pw: string) => void }) {
    const [id, setId] = useState('');
    const [pw, setPw] = useState('');

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-card p-8 w-full max-w-md"
            >
                <div className="text-center mb-6">
                    <div className="text-5xl mb-3">🛡️</div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
                        Admin Dashboard
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">IUT Cafeteria Crisis Control</p>
                </div>
                <form onSubmit={e => { e.preventDefault(); onLogin(id, pw); }} className="space-y-4">
                    <input
                        type="text" value={id} onChange={e => setId(e.target.value)}
                        placeholder="Admin ID (admin1)"
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:border-purple-500 focus:outline-none"
                    />
                    <input
                        type="password" value={pw} onChange={e => setPw(e.target.value)}
                        placeholder="Password (password123)"
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:border-purple-500 focus:outline-none"
                    />
                    <button type="submit"
                        className="w-full py-3 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-xl text-white font-semibold hover:shadow-lg hover:shadow-purple-500/20 transition">
                        Access Dashboard
                    </button>
                </form>
            </motion.div>
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
