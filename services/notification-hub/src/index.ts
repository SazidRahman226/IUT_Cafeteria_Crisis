import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

// ==========================================
// Configuration
// ==========================================
const PORT = parseInt(process.env.PORT || '4005');
const JWT_SECRET = process.env.JWT_SECRET || 'devsprint-2026-secret-key';

// ==========================================
// Metrics
// ==========================================
let requestCount = 0;
let errorCount = 0;
let latencies: number[] = [];
let notificationsSent = 0;
const startTime = Date.now();

function recordRequest(latencyMs: number, isError = false) {
    requestCount++;
    latencies.push(latencyMs);
    if (latencies.length > 1000) latencies = latencies.slice(-500);
    if (isError) errorCount++;
}

function getAvgLatency(): number {
    if (latencies.length === 0) return 0;
    return latencies.reduce((a, b) => a + b, 0) / latencies.length;
}

// ==========================================
// Logger
// ==========================================
function log(level: string, message: string, meta?: Record<string, any>) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: 'notification-hub',
        message,
        ...meta,
    }));
}

// ==========================================
// WebSocket Client Tracking
// ==========================================
interface ConnectedClient {
    ws: WebSocket;
    studentId: string;
    connectedAt: Date;
}

const clients = new Map<string, ConnectedClient[]>(); // studentId -> clients[]

function addClient(studentId: string, ws: WebSocket) {
    if (!clients.has(studentId)) {
        clients.set(studentId, []);
    }
    clients.get(studentId)!.push({ ws, studentId, connectedAt: new Date() });
    log('info', 'Client connected', { studentId, totalClients: getTotalClients() });
}

function removeClient(studentId: string, ws: WebSocket) {
    const studentClients = clients.get(studentId);
    if (studentClients) {
        const idx = studentClients.findIndex(c => c.ws === ws);
        if (idx !== -1) studentClients.splice(idx, 1);
        if (studentClients.length === 0) clients.delete(studentId);
    }
    log('info', 'Client disconnected', { studentId, totalClients: getTotalClients() });
}

function getTotalClients(): number {
    let total = 0;
    for (const [, arr] of clients) total += arr.length;
    return total;
}

function sendToStudent(studentId: string, data: any) {
    const studentClients = clients.get(studentId);
    if (!studentClients || studentClients.length === 0) {
        log('debug', 'No connected clients for student', { studentId });
        return 0;
    }

    let sent = 0;
    const message = JSON.stringify(data);
    for (const client of studentClients) {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
            sent++;
        }
    }
    return sent;
}

function broadcast(data: any) {
    const message = JSON.stringify(data);
    let sent = 0;
    for (const [, studentClients] of clients) {
        for (const client of studentClients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(message);
                sent++;
            }
        }
    }
    return sent;
}

// ==========================================
// Express App
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => recordRequest(Date.now() - start, res.statusCode >= 500));
    next();
});

// Root info page
app.get('/', (_req, res) => {
    res.send(`<html><head><title>Notification Hub</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:16px;max-width:500px;box-shadow:0 4px 30px rgba(0,0,0,.3)}h1{color:#f472b6;margin-top:0}a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}code{background:#334155;padding:2px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>🔔 Notification Hub</h1><p>Real-time WebSocket notifications</p><p><b>Endpoints:</b></p><ul><li><a href="/health">/health</a> — Health check</li><li><a href="/metrics">/metrics</a> — Prometheus metrics</li><li><code>POST /notify</code> — Send notification</li><li><code>POST /broadcast</code> — Broadcast to all</li><li><code>ws://localhost:4005/ws</code> — WebSocket</li></ul><p style="color:#64748b;font-size:12px">DevSprint 2026 — IUT Cafeteria Crisis</p></div></body></html>`);
});

// Receive notifications from other services (internal endpoint)
app.post('/notify', (req, res) => {
    const { orderId, studentId, status, timestamp, message } = req.body;

    if (!orderId || !studentId || !status) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'orderId, studentId, status required', traceId: '' },
        });
        return;
    }

    const notification = {
        type: 'ORDER_STATUS_UPDATE',
        orderId,
        studentId,
        status,
        timestamp: timestamp || new Date().toISOString(),
        message: message || `Order status: ${status}`,
    };

    const sent = sendToStudent(studentId, notification);
    notificationsSent++;

    log('info', 'Notification sent', { orderId, studentId, status, clientsNotified: sent });
    res.json({ sent, orderId, status });
});

// Broadcast (admin use)
app.post('/broadcast', (req, res) => {
    const { message, type } = req.body;
    const sent = broadcast({
        type: type || 'SYSTEM_MESSAGE',
        message,
        timestamp: new Date().toISOString(),
    });
    res.json({ sent });
});

// Health
app.get('/health', (_req, res) => {
    const wsOk = wss && wss.clients !== undefined;
    const status = wsOk ? 'ok' : 'down';
    res.status(wsOk ? 200 : 503).json({
        status,
        service: 'notification-hub',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        dependencies: {
            websocket: { status, connectedClients: getTotalClients() },
        },
    });
});

// Metrics
app.get('/metrics', (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const avgLatency = Math.round(getAvgLatency() * 100) / 100;
    const connectedClients = getTotalClients();
    res.set('Content-Type', 'text/plain');
    res.send(
        `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="notification-hub"} ${requestCount}\n` +
        `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="notification-hub"} ${errorCount}\n` +
        `# HELP avg_latency_ms Average latency\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="notification-hub"} ${avgLatency}\n` +
        `# HELP notifications_sent_total Notifications sent\n# TYPE notifications_sent_total counter\nnotifications_sent_total{service="notification-hub"} ${notificationsSent}\n` +
        `# HELP connected_clients Connected WS clients\n# TYPE connected_clients gauge\nconnected_clients{service="notification-hub"} ${connectedClients}\n` +
        `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="notification-hub"} ${uptime}\n`
    );
});

// JSON metrics for admin dashboard
app.get('/metrics/json', (_req, res) => {
    res.json({
        service: 'notification-hub',
        requestCount,
        errorCount,
        avgLatencyMs: Math.round(getAvgLatency() * 100) / 100,
        notificationsSent,
        connectedClients: getTotalClients(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
    });
});

// Chaos endpoint (admin-secured)
app.post('/chaos/kill', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token', traceId: '' } });
        return;
    }
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as any;
        if (decoded.role !== 'admin') {
            res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only', traceId: '' } });
            return;
        }
        log('warn', 'CHAOS: Notification hub kill triggered');
        res.json({ message: 'Service shutting down...' });
        setTimeout(() => process.exit(1), 500);
    } catch {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token', traceId: '' } });
    }
});

// ==========================================
// HTTP + WebSocket Server
// ==========================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
    // Extract token from query string: /ws?token=xxx
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Authentication required. Send token as query param.' }));
        ws.close(4001, 'No token provided');
        return;
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const studentId = decoded.sub;

        addClient(studentId, ws);

        ws.send(JSON.stringify({
            type: 'CONNECTED',
            studentId,
            message: 'Connected to notification hub',
            timestamp: new Date().toISOString(),
        }));

        ws.on('close', () => removeClient(studentId, ws));
        ws.on('error', () => removeClient(studentId, ws));

        // Handle ping/pong for keep-alive
        ws.on('pong', () => { /* client alive */ });

    } catch {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid or expired token' }));
        ws.close(4001, 'Invalid token');
    }
});

// Keep-alive ping every 30s
setInterval(() => {
    for (const [, studentClients] of clients) {
        for (const client of studentClients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.ping();
            }
        }
    }
}, 30000);

// ==========================================
// Start
// ==========================================
server.listen(PORT, '0.0.0.0', () => {
    log('info', `Notification Hub running on port ${PORT}`);
});

export { app, server };
