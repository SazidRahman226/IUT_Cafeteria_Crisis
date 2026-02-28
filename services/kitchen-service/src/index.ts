import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import amqplib from 'amqplib';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const JWT_SECRET = process.env.JWT_SECRET || 'devsprint-2026-secret-key';

// ==========================================
// Configuration
// ==========================================
const PORT = parseInt(process.env.PORT || '4003');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://order-gateway:8080';
const NOTIFICATION_HUB_URL = process.env.NOTIFICATION_HUB_URL || 'http://notification-hub:4005';
const QUEUE_NAME = 'kitchen_orders';

// ==========================================
// Metrics
// ==========================================
let requestCount = 0;
let errorCount = 0;
let latencies: number[] = [];
let ordersProcessed = 0;
let totalCookingTimeMs = 0;
const startTime = Date.now();
const processedOrderIds = new Set<string>(); // dedup

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
        service: 'kitchen-service',
        message,
        ...meta,
    }));
}

// ==========================================
// App
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
    res.send(`<html><head><title>Kitchen Service</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:16px;max-width:500px;box-shadow:0 4px 30px rgba(0,0,0,.3)}h1{color:#fb923c;margin-top:0}a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}code{background:#334155;padding:2px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>👨‍🍳 Kitchen Service</h1><p>Async order processing via RabbitMQ</p><p><b>Endpoints:</b></p><ul><li><a href="/health">/health</a> — Health check</li><li><a href="/metrics">/metrics</a> — Prometheus metrics</li><li><code>POST /chaos/kill</code> — Chaos kill (admin)</li></ul><p style="color:#64748b;font-size:12px">DevSprint 2026 — IUT Cafeteria Crisis</p></div></body></html>`);
});

// Health check
app.get('/health', async (_req, res) => {
    const deps: Record<string, any> = {};
    deps.rabbitmq = rabbitConnected ? { status: 'ok' } : { status: 'down' };

    res.status(rabbitConnected ? 200 : 503).json({
        status: rabbitConnected ? 'ok' : 'down',
        service: 'kitchen-service',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        dependencies: deps,
    });
});

// Metrics
app.get('/metrics', (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const avgLatency = Math.round(getAvgLatency() * 100) / 100;
    const avgCookingTime = ordersProcessed > 0 ? Math.round(totalCookingTimeMs / ordersProcessed) : 0;
    res.set('Content-Type', 'text/plain');
    res.send(
        `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="kitchen-service"} ${requestCount}\n` +
        `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="kitchen-service"} ${errorCount}\n` +
        `# HELP avg_latency_ms Average latency\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="kitchen-service"} ${avgLatency}\n` +
        `# HELP orders_processed_total Orders processed\n# TYPE orders_processed_total counter\norders_processed_total{service="kitchen-service"} ${ordersProcessed}\n` +
        `# HELP kitchen_processing_time_ms Avg cooking time\n# TYPE kitchen_processing_time_ms gauge\nkitchen_processing_time_ms{service="kitchen-service"} ${avgCookingTime}\n` +
        `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="kitchen-service"} ${uptime}\n`
    );
});

// JSON metrics for admin dashboard
app.get('/metrics/json', (_req, res) => {
    const avgCookingTime = ordersProcessed > 0 ? Math.round(totalCookingTimeMs / ordersProcessed) : 0;
    res.json({
        service: 'kitchen-service',
        requestCount,
        errorCount,
        avgLatencyMs: Math.round(getAvgLatency() * 100) / 100,
        ordersProcessed,
        kitchenProcessingTimeMs: avgCookingTime,
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
        log('warn', 'CHAOS: Kitchen service kill triggered');
        res.json({ message: 'Service shutting down...' });
        setTimeout(() => process.exit(1), 500);
    } catch {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token', traceId: '' } });
    }
});

// ==========================================
// RabbitMQ Consumer
// ==========================================
let rabbitConnected = false;

async function processOrder(msg: amqplib.ConsumeMessage, channel: amqplib.Channel) {
    const content = JSON.parse(msg.content.toString());
    const { orderId, studentId, items } = content;

    // Idempotent: skip already processed
    if (processedOrderIds.has(orderId)) {
        log('info', 'Duplicate order skipped', { orderId });
        channel.ack(msg);
        return;
    }

    log('info', 'Order received in kitchen', { orderId, studentId });

    // ACK immediately (within <2s requirement), decouple cooking
    channel.ack(msg);

    // Notify: IN_KITCHEN
    try {
        await axios.post(`${NOTIFICATION_HUB_URL}/notify`, {
            orderId,
            studentId,
            status: 'IN_KITCHEN',
            timestamp: new Date().toISOString(),
            message: 'Your order is being prepared',
        }, { timeout: 3000 });
    } catch (err: any) {
        log('warn', 'Failed to notify IN_KITCHEN', { orderId, error: err.message });
    }

    // Update gateway order status
    try {
        await axios.patch(`${GATEWAY_URL}/api/orders/${orderId}/status`, { status: 'IN_KITCHEN' }, {
            timeout: 3000,
            headers: { 'X-Internal-Key': process.env.INTERNAL_SECRET || 'devsprint-internal-2026' },
        });
    } catch (err: any) {
        log('warn', 'Failed to update gateway status', { orderId, error: err.message });
    }

    // Simulate cooking (3-7 seconds)
    const cookingTime = 3000 + Math.random() * 4000;
    await new Promise(resolve => setTimeout(resolve, cookingTime));
    totalCookingTimeMs += cookingTime;

    // Mark as READY
    processedOrderIds.add(orderId);
    if (processedOrderIds.size > 10000) {
        // Cleanup old entries
        const arr = Array.from(processedOrderIds);
        arr.splice(0, 5000);
        processedOrderIds.clear();
        arr.forEach(id => processedOrderIds.add(id));
    }

    ordersProcessed++;

    // Notify: READY
    try {
        await axios.post(`${NOTIFICATION_HUB_URL}/notify`, {
            orderId,
            studentId,
            status: 'READY',
            timestamp: new Date().toISOString(),
            message: 'Your order is ready for pickup!',
        }, { timeout: 3000 });
    } catch (err: any) {
        log('warn', 'Failed to notify READY', { orderId, error: err.message });
    }

    // Update gateway order status
    try {
        await axios.patch(`${GATEWAY_URL}/api/orders/${orderId}/status`, { status: 'READY' }, {
            timeout: 3000,
            headers: { 'X-Internal-Key': process.env.INTERNAL_SECRET || 'devsprint-internal-2026' },
        });
    } catch (err: any) {
        log('warn', 'Failed to update gateway READY status', { orderId, error: err.message });
    }

    log('info', 'Order completed', { orderId, cookingTimeMs: Math.round(cookingTime) });
}

async function connectRabbitMQ() {
    let retries = 30;
    while (retries > 0) {
        try {
            const conn = await amqplib.connect(RABBITMQ_URL);
            const channel = await conn.createChannel();
            await channel.assertQueue(QUEUE_NAME, { durable: true });
            channel.prefetch(5); // Process up to 5 orders concurrently

            channel.consume(QUEUE_NAME, async (msg) => {
                if (msg) {
                    try {
                        await processOrder(msg, channel);
                    } catch (err: any) {
                        log('error', 'Order processing failed', { error: err.message });
                        errorCount++;
                    }
                }
            });

            rabbitConnected = true;
            log('info', 'RabbitMQ consumer connected');

            conn.on('error', () => { rabbitConnected = false; });
            conn.on('close', () => {
                rabbitConnected = false;
                log('warn', 'RabbitMQ connection closed, reconnecting...');
                setTimeout(connectRabbitMQ, 5000);
            });

            return;
        } catch {
            retries--;
            log('warn', `Waiting for RabbitMQ... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    log('error', 'Failed to connect to RabbitMQ');
}

// ==========================================
// Start
// ==========================================
async function start() {
    await connectRabbitMQ();

    app.listen(PORT, '0.0.0.0', () => {
        log('info', `Kitchen Service running on port ${PORT}`);
    });
}

start().catch(err => {
    log('error', 'Failed to start', { error: err.message });
    process.exit(1);
});

export { app };
