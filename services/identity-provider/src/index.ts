import express from 'express';
import cors from 'cors';
import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

// ==========================================
// Configuration
// ==========================================
const PORT = parseInt(process.env.PORT || '4001');
const JWT_SECRET = process.env.JWT_SECRET || 'devsprint-2026-secret-key';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'cafeteria_auth',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// ==========================================
// Metrics Collector
// ==========================================
let requestCount = 0;
let errorCount = 0;
let latencies: number[] = [];
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
// App Setup
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());

// Root info page
app.get('/', (_req, res) => {
    res.send(`<html><head><title>Identity Provider</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:16px;max-width:500px;box-shadow:0 4px 30px rgba(0,0,0,.3)}h1{color:#38bdf8;margin-top:0}a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}code{background:#334155;padding:2px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>🔐 Identity Provider</h1><p>Authentication service for IUT Cafeteria</p><p><b>Endpoints:</b></p><ul><li><a href="/health">/health</a> — Health check</li><li><a href="/metrics">/metrics</a> — Prometheus metrics</li><li><code>POST /auth/login</code> — Login</li><li><code>POST /auth/register</code> — Register</li><li><code>POST /auth/verify</code> — Verify token</li></ul><p style="color:#64748b;font-size:12px">DevSprint 2026 — IUT Cafeteria Crisis</p></div></body></html>`);
});

// Request ID middleware
app.use((req, _res, next) => {
    (req as any).requestId = (req.headers['x-request-id'] as string) || uuidv4();
    next();
});

// Metrics middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        recordRequest(Date.now() - start, res.statusCode >= 500);
    });
    next();
});

// Rate limiting: 3 login attempts per minute per studentId
const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    keyGenerator: (req) => req.body?.studentId || req.ip || 'unknown',
    message: {
        error: {
            code: 'RATE_LIMITED',
            message: 'Too many login attempts. Try again in 1 minute.',
            traceId: '',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// ==========================================
// Structured Logger
// ==========================================
function log(level: string, message: string, meta?: Record<string, any>) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: 'identity-provider',
        message,
        ...meta,
    }));
}

// ==========================================
// Routes
// ==========================================

// Login
app.post('/auth/login', loginLimiter, async (req, res) => {
    const { studentId, password } = req.body;
    const traceId = (req as any).requestId;

    if (!studentId || !password) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'studentId and password are required', traceId },
        });
        return;
    }

    try {
        const result = await pool.query(
            'SELECT student_id, name, password_hash, role FROM users WHERE student_id = $1',
            [studentId]
        );

        if (result.rows.length === 0) {
            res.status(401).json({
                error: { code: 'INVALID_CREDENTIALS', message: 'Invalid student ID or password', traceId },
            });
            return;
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);

        if (!valid) {
            res.status(401).json({
                error: { code: 'INVALID_CREDENTIALS', message: 'Invalid student ID or password', traceId },
            });
            return;
        }

        const signOpts: SignOptions = { expiresIn: JWT_EXPIRY as any };
        const accessToken = jwt.sign(
            { sub: user.student_id, role: user.role },
            JWT_SECRET,
            signOpts
        );

        const refreshOpts: SignOptions = { expiresIn: '7d' };
        const refreshToken = jwt.sign(
            { sub: user.student_id, role: user.role, type: 'refresh' },
            JWT_SECRET,
            refreshOpts
        );

        log('info', 'Login successful', { studentId: user.student_id, traceId });

        res.json({
            accessToken,
            refreshToken,
            user: {
                studentId: user.student_id,
                name: user.name,
                role: user.role,
            },
        });
    } catch (err: any) {
        log('error', 'Login error', { error: err.message, traceId });
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Authentication service error', traceId },
        });
    }
});

// Register (admin use)
app.post('/auth/register', async (req, res) => {
    const { studentId, name, password, role } = req.body;
    const traceId = (req as any).requestId;

    if (!studentId || !name || !password) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'studentId, name, and password are required', traceId },
        });
        return;
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (student_id, name, password_hash, role) VALUES ($1, $2, $3, $4)',
            [studentId, name, hash, role || 'student']
        );

        log('info', 'User registered', { studentId, traceId });
        res.status(201).json({ message: 'User registered', studentId });
    } catch (err: any) {
        if (err.code === '23505') {
            res.status(409).json({
                error: { code: 'USER_EXISTS', message: 'Student ID already registered', traceId },
            });
            return;
        }
        log('error', 'Register error', { error: err.message, traceId });
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Registration failed', traceId },
        });
    }
});

// Verify token
app.get('/auth/verify', (req, res) => {
    const authHeader = req.headers.authorization;
    const traceId = (req as any).requestId;

    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Missing bearer token', traceId },
        });
        return;
    }

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        res.json({ valid: true, claims: decoded });
    } catch {
        res.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', traceId },
        });
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
            service: 'identity-provider',
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            dependencies: {
                postgres: { status: 'ok', latency: dbLatency },
            },
        });
    } catch {
        res.status(503).json({
            status: 'down',
            service: 'identity-provider',
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            dependencies: {
                postgres: { status: 'down' },
            },
        });
    }
});

// Metrics
app.get('/metrics', (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const avgLatency = Math.round(getAvgLatency() * 100) / 100;

    res.set('Content-Type', 'text/plain');
    res.send(
        `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="identity-provider"} ${requestCount}\n` +
        `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="identity-provider"} ${errorCount}\n` +
        `# HELP avg_latency_ms Average latency\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="identity-provider"} ${avgLatency}\n` +
        `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="identity-provider"} ${uptime}\n`
    );
});

// JSON metrics for admin dashboard
app.get('/metrics/json', (_req, res) => {
    res.json({
        service: 'identity-provider',
        requestCount,
        errorCount,
        avgLatencyMs: Math.round(getAvgLatency() * 100) / 100,
        uptime: Math.floor((Date.now() - startTime) / 1000),
    });
});

// Chaos endpoint (admin-secured self-destruct)
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
// Start Server
// ==========================================
async function start() {
    // Wait for DB
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

    if (retries === 0) {
        log('error', 'Failed to connect to database');
        process.exit(1);
    }

    app.listen(PORT, '0.0.0.0', () => {
        log('info', `Identity Provider running on port ${PORT}`);
    });
}

start().catch(err => {
    log('error', 'Failed to start', { error: err.message });
    process.exit(1);
});

export { app };
