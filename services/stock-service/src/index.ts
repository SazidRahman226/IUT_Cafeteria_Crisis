import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const JWT_SECRET = process.env.JWT_SECRET || 'devsprint-2026-secret-key';

// ==========================================
// Configuration
// ==========================================
const PORT = parseInt(process.env.PORT || '4002');
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'cafeteria_inventory',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Orders PG pool (for revenue calculation)
const ordersPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'cafeteria_orders', // Hardcoded as this service nominally connects to inventory
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

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

// ==========================================
// Logger
// ==========================================
function log(level: string, message: string, meta?: Record<string, any>) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: 'stock-service',
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

// Root info page
app.get('/', (_req, res) => {
    res.send(`<html><head><title>Stock Service</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:16px;max-width:500px;box-shadow:0 4px 30px rgba(0,0,0,.3)}h1{color:#34d399;margin-top:0}a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}code{background:#334155;padding:2px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>📦 Stock Service</h1><p>Inventory management with optimistic locking</p><p><b>Endpoints:</b></p><ul><li><a href="/health">/health</a> — Health check</li><li><a href="/stock">/stock</a> — All menu items</li><li><a href="/metrics">/metrics</a> — Prometheus metrics</li><li><code>POST /stock/deduct</code> — Deduct stock</li></ul><p style="color:#64748b;font-size:12px">DevSprint 2026 — IUT Cafeteria Crisis</p></div></body></html>`);
});

// Request ID
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
// Routes
// ==========================================

// Get all stock items
app.get('/stock', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT item_id, name, description, price, category, image_url, available_qty, version FROM inventory ORDER BY category, name'
        );
        res.json(result.rows.map(r => ({
            itemId: r.item_id,
            name: r.name,
            description: r.description,
            price: parseFloat(r.price),
            category: r.category,
            imageUrl: r.image_url,
            availableQty: r.available_qty,
            version: r.version,
        })));
    } catch (err: any) {
        log('error', 'Failed to fetch stock', { error: err.message });
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch inventory', traceId: (req as any)?.requestId || '' },
        });
    }
});

// Get single item stock
app.get('/stock/:itemId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT item_id, name, description, price, category, image_url, available_qty, version FROM inventory WHERE item_id = $1',
            [req.params.itemId]
        );
        if (result.rows.length === 0) {
            res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Item not found', traceId: (req as any).requestId },
            });
            return;
        }
        const r = result.rows[0];
        res.json({
            itemId: r.item_id,
            name: r.name,
            description: r.description,
            price: parseFloat(r.price),
            category: r.category,
            imageUrl: r.image_url,
            availableQty: r.available_qty,
            version: r.version,
        });
    } catch (err: any) {
        log('error', 'Failed to fetch item', { error: err.message, itemId: req.params.itemId });
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch item', traceId: (req as any).requestId },
        });
    }
});

// Reserve stock (optimistic locking + idempotency)
app.post('/stock/reserve', async (req, res) => {
    const { itemId, quantity, idempotencyKey } = req.body;
    const traceId = (req as any).requestId;

    if (!itemId || !quantity || quantity <= 0) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'itemId and positive quantity required', traceId },
        });
        return;
    }

    // Idempotency check
    if (idempotencyKey) {
        try {
            const existing = await pool.query(
                'SELECT result FROM idempotency_keys WHERE idempotency_key = $1',
                [idempotencyKey]
            );
            if (existing.rows.length > 0) {
                log('info', 'Idempotent request - returning cached result', { idempotencyKey, traceId });
                res.json(JSON.parse(existing.rows[0].result));
                return;
            }
        } catch (err: any) {
            log('warn', 'Idempotency check failed, proceeding', { error: err.message });
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Read current stock with version (optimistic locking)
        const current = await client.query(
            'SELECT name, available_qty, version FROM inventory WHERE item_id = $1 FOR UPDATE',
            [itemId]
        );

        if (current.rows.length === 0) {
            await client.query('ROLLBACK');
            res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Item not found', traceId },
            });
            return;
        }

        const { name, available_qty, version } = current.rows[0];

        if (available_qty < quantity) {
            await client.query('ROLLBACK');
            res.status(409).json({
                error: { code: 'OUT_OF_STOCK', message: `Insufficient ${name}. Available: ${available_qty}`, traceId },
            });
            return;
        }

        // Optimistic lock: update with version check
        const updateResult = await client.query(
            `UPDATE inventory 
       SET available_qty = available_qty - $1, version = version + 1 
       WHERE item_id = $2 AND version = $3 AND available_qty >= $1
       RETURNING available_qty`,
            [quantity, itemId, version]
        );

        if (updateResult.rowCount === 0) {
            await client.query('ROLLBACK');
            res.status(409).json({
                error: { code: 'CONFLICT', message: 'Concurrent modification detected, please retry', traceId },
            });
            return;
        }

        const response = {
            success: true,
            itemId,
            reservedQty: quantity,
            remainingQty: updateResult.rows[0].available_qty,
        };

        // Store idempotency key
        if (idempotencyKey) {
            await client.query(
                'INSERT INTO idempotency_keys (idempotency_key, result, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING',
                [idempotencyKey, JSON.stringify(response)]
            );
        }

        await client.query('COMMIT');
        ordersProcessed++;
        log('info', 'Stock reserved', { itemId, quantity, remaining: response.remainingQty, traceId });

        res.json(response);
    } catch (err: any) {
        await client.query('ROLLBACK');
        log('error', 'Reserve failed', { error: err.message, traceId });
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Stock reservation failed', traceId },
        });
    } finally {
        client.release();
    }
});

// Health check
app.get('/health', async (_req, res) => {
    try {
        const start = Date.now();
        await pool.query('SELECT 1');
        const dbLatency = Date.now() - start;
        res.json({
            status: 'ok',
            service: 'stock-service',
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            dependencies: { postgres: { status: 'ok', latency: dbLatency } },
        });
    } catch {
        res.status(503).json({
            status: 'down',
            service: 'stock-service',
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            dependencies: { postgres: { status: 'down' } },
        });
    }
});

// Metrics
app.get('/metrics', (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const avgLatency = Math.round(getAvgLatency() * 100) / 100;
    res.set('Content-Type', 'text/plain');
    res.send(
        `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="stock-service"} ${requestCount}\n` +
        `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="stock-service"} ${errorCount}\n` +
        `# HELP avg_latency_ms Average latency\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="stock-service"} ${avgLatency}\n` +
        `# HELP orders_processed_total Orders processed\n# TYPE orders_processed_total counter\norders_processed_total{service="stock-service"} ${ordersProcessed}\n` +
        `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="stock-service"} ${uptime}\n`
    );
});

// JSON metrics for admin dashboard
app.get('/metrics/json', (_req, res) => {
    res.json({
        service: 'stock-service',
        requestCount,
        errorCount,
        avgLatencyMs: Math.round(getAvgLatency() * 100) / 100,
        ordersProcessed,
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
        log('warn', 'CHAOS: Service kill triggered');
        res.json({ message: 'Service shutting down...' });
        setTimeout(() => process.exit(1), 500);
    } catch {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token', traceId: '' } });
    }
});

// ==========================================
// Start
// ==========================================
async function start() {
    let retries = 30;
    while (retries > 0) {
        try {
            await pool.query('SELECT 1');
            log('info', 'Database connected');
            break;
        } catch {
            retries--;
            log('warn', `Waiting for database... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    if (retries === 0) { log('error', 'DB connection failed'); process.exit(1); }

    app.listen(PORT, '0.0.0.0', () => {
        log('info', `Stock Service running on port ${PORT}`);
    });
}

start().catch(err => { log('error', 'Failed to start', { error: err.message }); process.exit(1); });

export {app, pool };
