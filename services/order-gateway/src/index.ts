import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import amqplib from 'amqplib';
import axios from 'axios';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// ==========================================
// Configuration
// ==========================================
const PORT = parseInt(process.env.PORT || '8080');
const JWT_SECRET = process.env.JWT_SECRET || 'devsprint-2026-secret-key';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const STOCK_SERVICE_URL = process.env.STOCK_SERVICE_URL || 'http://localhost:4002';
const NOTIFICATION_HUB_URL = process.env.NOTIFICATION_HUB_URL || 'http://localhost:4005';
const QUEUE_NAME = 'kitchen_orders';
const STOCK_CACHE_TTL = 30; // seconds

// Postgres for order records
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'cafeteria_orders',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

let redis: Redis;
let rabbitChannel: amqplib.Channel | null = null;

// ==========================================
// Metrics
// ==========================================
let requestCount = 0;
let errorCount = 0;
let latencies: number[] = [];
let ordersProcessed = 0;
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

function getRecentAvgLatency(): number {
    const recent = latencies.slice(-50);
    if (recent.length === 0) return 0;
    return recent.reduce((a, b) => a + b, 0) / recent.length;
}

// ==========================================
// Logger
// ==========================================
function log(level: string, message: string, meta?: Record<string, any>) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: 'order-gateway',
        message,
        ...meta,
    }));
}

// ==========================================
// App Setup
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());

// Root info page
app.get('/', (_req, res) => {
    res.send(`<html><head><title>Order Gateway</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:16px;max-width:500px;box-shadow:0 4px 30px rgba(0,0,0,.3)}h1{color:#a78bfa;margin-top:0}a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}code{background:#334155;padding:2px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>🛒 Order Gateway</h1><p>API Gateway for IUT Cafeteria Crisis</p><p><b>Endpoints:</b></p><ul><li><a href="/health">/health</a> — Health check</li><li><a href="/metrics">/metrics</a> — Prometheus metrics</li><li><code>POST /api/orders</code> — Place order</li><li><code>GET /api/menu</code> — Get menu</li><li><code>GET /api/orders</code> — My orders</li></ul><p style="color:#64748b;font-size:12px">DevSprint 2026 — IUT Cafeteria Crisis</p></div></body></html>`);
});

// Request ID middleware
app.use((req, _res, next) => {
    (req as any).requestId = (req.headers['x-request-id'] as string) || uuidv4();
    next();
});

// Metrics middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => recordRequest(Date.now() - start, res.statusCode >= 500));
    next();
});

// ==========================================
// JWT Auth Middleware
// ==========================================
function authenticateJwt(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token', traceId: (req as any).requestId },
        });
        return;
    }
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as any;
        (req as any).user = decoded;
        next();
    } catch {
        res.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', traceId: (req as any).requestId },
        });
    }
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (!(req as any).user || (req as any).user.role !== 'admin') {
        res.status(403).json({
            error: { code: 'FORBIDDEN', message: 'Admin access required', traceId: (req as any).requestId },
        });
        return;
    }
    next();
}

// ==========================================
// Routes
// ==========================================

// Get menu (proxy to stock service)
app.get('/api/menu', async (req, res) => {
    const traceId = (req as any).requestId;
    try {
        const response = await axios.get(`${STOCK_SERVICE_URL}/stock`, {
            headers: { 'X-Request-Id': traceId },
            timeout: 5000,
        });
        res.json(response.data);
    } catch (err: any) {
        log('error', 'Failed to fetch menu', { error: err.message, traceId });
        res.status(502).json({
            error: { code: 'SERVICE_UNAVAILABLE', message: 'Unable to fetch menu', traceId },
        });
    }
});

// Place order (protected)
app.post('/api/orders', authenticateJwt, async (req, res) => {
    const traceId = (req as any).requestId;
    const user = (req as any).user;
    const { items } = req.body;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || uuidv4();

    // Validate
    if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'items array is required and must not be empty', traceId },
        });
        return;
    }

    for (const item of items) {
        if (!item.itemId || !item.quantity || item.quantity <= 0) {
            res.status(400).json({
                error: { code: 'VALIDATION_ERROR', message: 'Each item must have itemId and positive quantity', traceId },
            });
            return;
        }
    }

    // Idempotency check via Redis
    try {
        const cached = await redis.get(`idempotency:${idempotencyKey}`);
        if (cached) {
            log('info', 'Idempotent request - returning cached', { idempotencyKey, traceId });
            res.json(JSON.parse(cached));
            return;
        }
    } catch (err: any) {
        log('warn', 'Idempotency Redis check failed', { error: err.message });
    }

    const orderId = uuidv4();

    try {
        // Check cache first for each item
        for (const item of items) {
            try {
                const cachedStock = await redis.get(`stock:${item.itemId}`);
                if (cachedStock !== null && parseInt(cachedStock) < item.quantity) {
                    res.status(409).json({
                        error: { code: 'OUT_OF_STOCK', message: `Item ${item.itemId} is out of stock (cached)`, traceId },
                    });
                    return;
                }
            } catch {
                // Cache miss is OK, continue to stock service
            }
        }

        // Reserve stock for each item
        let totalAmount = 0;
        const reservedItems: any[] = [];

        for (const item of items) {
            const reserveResponse = await axios.post(`${STOCK_SERVICE_URL}/stock/reserve`, {
                itemId: item.itemId,
                quantity: item.quantity,
                idempotencyKey: `${idempotencyKey}-${item.itemId}`,
            }, {
                headers: { 'X-Request-Id': traceId },
                timeout: 5000,
            });

            // Update cache with remaining qty
            try {
                await redis.set(`stock:${item.itemId}`, reserveResponse.data.remainingQty.toString(), 'EX', STOCK_CACHE_TTL);
            } catch {
                // Cache update failure is non-critical
            }

            // Get item details
            try {
                const itemDetails = await axios.get(`${STOCK_SERVICE_URL}/stock/${item.itemId}`, {
                    headers: { 'X-Request-Id': traceId },
                    timeout: 5000,
                });
                item.name = itemDetails.data.name;
                item.price = itemDetails.data.price;
                totalAmount += item.price * item.quantity;
            } catch {
                item.name = item.name || 'Unknown Item';
                item.price = item.price || 0;
            }

            reservedItems.push(item);
        }

        // Create order record in DB
        await pool.query(
            `INSERT INTO orders (order_id, student_id, items, total_amount, status, idempotency_key, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [orderId, user.sub, JSON.stringify(items), totalAmount, 'STOCK_VERIFIED', idempotencyKey]
        );

        // Publish to RabbitMQ
        const kitchenMessage = {
            orderId,
            studentId: user.sub,
            items: reservedItems,
            timestamp: new Date().toISOString(),
        };

        let published = false;
        if (rabbitChannel) {
            try {
                rabbitChannel.sendToQueue(
                    QUEUE_NAME,
                    Buffer.from(JSON.stringify(kitchenMessage)),
                    { persistent: true, messageId: orderId }
                );
                published = true;
            } catch (err: any) {
                log('error', 'Failed to publish to RabbitMQ', { error: err.message, traceId });
            }
        }

        if (!published) {
            // Mark as PENDING_QUEUE for background retry
            await pool.query('UPDATE orders SET status = $1 WHERE order_id = $2', ['PENDING_QUEUE', orderId]);
            log('warn', 'Message queued for retry', { orderId, traceId });
        }

        // Notify hub about initial status
        try {
            await axios.post(`${NOTIFICATION_HUB_URL}/notify`, {
                orderId,
                studentId: user.sub,
                status: 'STOCK_VERIFIED',
                timestamp: new Date().toISOString(),
                message: 'Stock verified, sending to kitchen',
            }, { timeout: 3000 });
        } catch {
            log('warn', 'Failed to notify hub', { orderId, traceId });
        }

        const response = {
            orderId,
            studentId: user.sub,
            items: reservedItems,
            totalAmount,
            status: published ? 'STOCK_VERIFIED' : 'PENDING_QUEUE',
            createdAt: new Date().toISOString(),
        };

        // Cache idempotency result
        try {
            await redis.set(`idempotency:${idempotencyKey}`, JSON.stringify(response), 'EX', 3600);
        } catch {
            // Non-critical
        }

        ordersProcessed++;
        log('info', 'Order placed', { orderId, studentId: user.sub, totalAmount, traceId });
        res.status(201).json(response);

    } catch (err: any) {
        if (err.response?.status === 409) {
            res.status(409).json({
                error: { code: 'OUT_OF_STOCK', message: err.response.data?.error?.message || 'Item out of stock', traceId },
            });
            return;
        }
        log('error', 'Order placement failed', { error: err.message, traceId });
        res.status(500).json({
            error: { code: 'ORDER_FAILED', message: 'Failed to place order', traceId },
        });
    }
});

// Get order by ID
app.get('/api/orders/:orderId', authenticateJwt, async (req, res) => {
    const traceId = (req as any).requestId;
    const user = (req as any).user;
    try {
        const result = await pool.query(
            'SELECT order_id, student_id, items, total_amount, status, created_at FROM orders WHERE order_id = $1',
            [req.params.orderId]
        );
        if (result.rows.length === 0) {
            res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Order not found', traceId },
            });
            return;
        }
        const order = result.rows[0];
        // Students can only see their own orders
        if (user.role !== 'admin' && order.student_id !== user.sub) {
            res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Access denied', traceId },
            });
            return;
        }
        res.json({
            orderId: order.order_id,
            studentId: order.student_id,
            items: typeof order.items === 'string' ? JSON.parse(order.items) : order.items,
            totalAmount: parseFloat(order.total_amount),
            status: order.status,
            createdAt: order.created_at,
        });
    } catch (err: any) {
        log('error', 'Failed to get order', { error: err.message, traceId });
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to get order', traceId },
        });
    }
});

// Get all orders for user
app.get('/api/orders', authenticateJwt, async (req, res) => {
    const traceId = (req as any).requestId;
    const user = (req as any).user;
    try {
        const query = user.role === 'admin'
            ? 'SELECT order_id, student_id, items, total_amount, status, created_at FROM orders ORDER BY created_at DESC LIMIT 100'
            : 'SELECT order_id, student_id, items, total_amount, status, created_at FROM orders WHERE student_id = $1 ORDER BY created_at DESC LIMIT 50';
        const params = user.role === 'admin' ? [] : [user.sub];
        const result = await pool.query(query, params);
        res.json(result.rows.map(r => ({
            orderId: r.order_id,
            studentId: r.student_id,
            items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items,
            totalAmount: parseFloat(r.total_amount),
            status: r.status,
            createdAt: r.created_at,
        })));
    } catch (err: any) {
        log('error', 'Failed to list orders', { error: err.message, traceId });
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to list orders', traceId },
        });
    }
});

// Update order status (internal - used by kitchen service, secured with shared secret)
app.patch('/api/orders/:orderId/status', async (req, res) => {
    const traceId = (req as any).requestId;
    const { status } = req.body;

    // Allow internal services via shared JWT secret or admin token
    const authHeader = req.headers.authorization;
    const internalKey = req.headers['x-internal-key'] as string;
    const validInternalKey = internalKey === (process.env.INTERNAL_SECRET || 'devsprint-internal-2026');

    let authorized = validInternalKey;
    if (!authorized && authHeader?.startsWith('Bearer ')) {
        try {
            const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as any;
            authorized = decoded.role === 'admin';
        } catch {
            // Invalid token
        }
    }

    if (!authorized) {
        res.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Internal or admin access required', traceId },
        });
        return;
    }

    const validStatuses = ['PENDING', 'STOCK_VERIFIED', 'IN_KITCHEN', 'READY', 'FAILED', 'PENDING_QUEUE'];
    if (!status || !validStatuses.includes(status)) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, traceId },
        });
        return;
    }

    try {
        await pool.query('UPDATE orders SET status = $1 WHERE order_id = $2', [status, req.params.orderId]);
        res.json({ orderId: req.params.orderId, status });
    } catch (err: any) {
        log('error', 'Failed to update order status', { error: err.message, traceId });
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to update status', traceId },
        });
    }
});

// Health check
app.get('/health', async (_req, res) => {
    const deps: Record<string, any> = {};

    // Check Postgres
    try {
        const start = Date.now();
        await pool.query('SELECT 1');
        deps.postgres = { status: 'ok', latency: Date.now() - start };
    } catch { deps.postgres = { status: 'down' }; }

    // Check Redis
    try {
        const start = Date.now();
        await redis.ping();
        deps.redis = { status: 'ok', latency: Date.now() - start };
    } catch { deps.redis = { status: 'down' }; }

    // Check RabbitMQ
    deps.rabbitmq = rabbitChannel ? { status: 'ok' } : { status: 'down' };

    const allOk = Object.values(deps).every((d: any) => d.status === 'ok');
    res.status(allOk ? 200 : 503).json({
        status: allOk ? 'ok' : 'degraded',
        service: 'order-gateway',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        dependencies: deps,
    });
});

// Metrics
app.get('/metrics', (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const avgLatency = Math.round(getAvgLatency() * 100) / 100;
    const recentAvg = Math.round(getRecentAvgLatency() * 100) / 100;
    res.set('Content-Type', 'text/plain');
    res.send(
        `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="order-gateway"} ${requestCount}\n` +
        `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="order-gateway"} ${errorCount}\n` +
        `# HELP avg_latency_ms Average latency\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="order-gateway"} ${avgLatency}\n` +
        `# HELP recent_avg_latency_ms Recent 30s avg latency\n# TYPE recent_avg_latency_ms gauge\nrecent_avg_latency_ms{service="order-gateway"} ${recentAvg}\n` +
        `# HELP orders_processed_total Orders processed\n# TYPE orders_processed_total counter\norders_processed_total{service="order-gateway"} ${ordersProcessed}\n` +
        `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="order-gateway"} ${uptime}\n`
    );
});

// JSON metrics for admin dashboard
app.get('/metrics/json', (_req, res) => {
    res.json({
        service: 'order-gateway',
        requestCount,
        errorCount,
        avgLatencyMs: Math.round(getAvgLatency() * 100) / 100,
        recentAvgLatencyMs: Math.round(getRecentAvgLatency() * 100) / 100,
        ordersProcessed,
        uptime: Math.floor((Date.now() - startTime) / 1000),
    });
});

// Chaos endpoint
app.post('/chaos/kill', authenticateJwt, requireAdmin, (_req, res) => {
    log('warn', 'CHAOS: Gateway kill triggered');
    res.json({ message: 'Service shutting down...' });
    setTimeout(() => process.exit(1), 500);
});

// ==========================================
// Background: Retry PENDING_QUEUE orders
// ==========================================
async function retryPendingOrders() {
    if (!rabbitChannel) return;
    try {
        const result = await pool.query(
            "SELECT order_id, student_id, items FROM orders WHERE status = 'PENDING_QUEUE' LIMIT 10"
        );
        for (const row of result.rows) {
            try {
                const message = {
                    orderId: row.order_id,
                    studentId: row.student_id,
                    items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
                    timestamp: new Date().toISOString(),
                };
                rabbitChannel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), {
                    persistent: true,
                    messageId: row.order_id,
                });
                await pool.query('UPDATE orders SET status = $1 WHERE order_id = $2', ['STOCK_VERIFIED', row.order_id]);
                log('info', 'Retried pending order', { orderId: row.order_id });
            } catch (err: any) {
                log('error', 'Retry failed', { orderId: row.order_id, error: err.message });
            }
        }
    } catch (err: any) {
        log('error', 'Retry scan failed', { error: err.message });
    }
}

// ==========================================
// Startup
// ==========================================
async function connectRedis() {
    redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => Math.min(times * 500, 5000),
        lazyConnect: true,
    });
    let retries = 30;
    while (retries > 0) {
        try {
            await redis.connect();
            log('info', 'Redis connected');
            return;
        } catch {
            retries--;
            log('warn', `Waiting for Redis... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    log('error', 'Failed to connect to Redis');
}

async function connectRabbitMQ() {
    let retries = 30;
    while (retries > 0) {
        try {
            const conn = await amqplib.connect(RABBITMQ_URL);
            rabbitChannel = await conn.createChannel();
            await rabbitChannel.assertQueue(QUEUE_NAME, { durable: true });
            log('info', 'RabbitMQ connected');
            conn.on('error', () => { rabbitChannel = null; });
            conn.on('close', () => { rabbitChannel = null; });
            return;
        } catch {
            retries--;
            log('warn', `Waiting for RabbitMQ... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    log('error', 'Failed to connect to RabbitMQ');
}

async function connectDB() {
    let retries = 30;
    while (retries > 0) {
        try {
            await pool.query('SELECT 1');
            log('info', 'Database connected');
            return;
        } catch {
            retries--;
            log('warn', `Waiting for database... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    log('error', 'Failed to connect to database');
    process.exit(1);
}

async function start() {
    await connectDB();
    await connectRedis();
    await connectRabbitMQ();

    // Retry pending orders every 10s
    setInterval(retryPendingOrders, 10000);

    app.listen(PORT, '0.0.0.0', () => {
        log('info', `Order Gateway running on port ${PORT}`);
    });
}

start().catch(err => {
    log('error', 'Failed to start', { error: err.message });
    process.exit(1);
});

export { app };
