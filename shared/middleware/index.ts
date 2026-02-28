import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { JwtClaims, ApiError } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'devsprint-2026-secret-key';

// ==========================================
// JWT Authentication Middleware
// ==========================================
export function authenticateJwt(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        const error: ApiError = {
            error: {
                code: 'UNAUTHORIZED',
                message: 'Missing or invalid bearer token',
                traceId: (req as any).requestId || 'unknown',
            },
        };
        res.status(401).json(error);
        return;
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as JwtClaims;
        (req as any).user = decoded;
        next();
    } catch (err) {
        const error: ApiError = {
            error: {
                code: 'UNAUTHORIZED',
                message: 'Invalid or expired token',
                traceId: (req as any).requestId || 'unknown',
            },
        };
        res.status(401).json(error);
        return;
    }
}

// ==========================================
// Admin-only Middleware
// ==========================================
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    const user = (req as any).user as JwtClaims;
    if (!user || user.role !== 'admin') {
        const error: ApiError = {
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required',
                traceId: (req as any).requestId || 'unknown',
            },
        };
        res.status(403).json(error);
        return;
    }
    next();
}

// ==========================================
// Request ID Middleware (X-Request-Id)
// ==========================================
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();
    (req as any).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
}

// ==========================================
// Structured Logger
// ==========================================
export class Logger {
    private serviceName: string;

    constructor(serviceName: string) {
        this.serviceName = serviceName;
    }

    private log(level: string, message: string, meta?: Record<string, any>) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            service: this.serviceName,
            message,
            ...meta,
        };
        console.log(JSON.stringify(entry));
    }

    info(message: string, meta?: Record<string, any>) { this.log('info', message, meta); }
    warn(message: string, meta?: Record<string, any>) { this.log('warn', message, meta); }
    error(message: string, meta?: Record<string, any>) { this.log('error', message, meta); }
    debug(message: string, meta?: Record<string, any>) { this.log('debug', message, meta); }
}

// ==========================================
// Global Error Handler
// ==========================================
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
    const error: ApiError = {
        error: {
            code: 'INTERNAL_ERROR',
            message: err.message || 'Internal server error',
            traceId: (req as any).requestId || 'unknown',
        },
    };
    res.status(500).json(error);
}

// ==========================================
// Metrics Collector
// ==========================================
export class MetricsCollector {
    private requestCount = 0;
    private errorCount = 0;
    private latencies: number[] = [];
    private ordersProcessed = 0;
    private startTime = Date.now();
    public serviceName: string;
    public extra: Record<string, number> = {};

    constructor(serviceName: string) {
        this.serviceName = serviceName;
    }

    recordRequest(latencyMs: number, isError: boolean = false) {
        this.requestCount++;
        this.latencies.push(latencyMs);
        if (this.latencies.length > 1000) this.latencies = this.latencies.slice(-500);
        if (isError) this.errorCount++;
    }

    recordOrder() { this.ordersProcessed++; }

    getAvgLatency(): number {
        if (this.latencies.length === 0) return 0;
        return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
    }

    getRecentAvgLatency(windowMs: number = 30000): number {
        const now = Date.now();
        const recent = this.latencies.slice(-100);
        if (recent.length === 0) return 0;
        return recent.reduce((a, b) => a + b, 0) / recent.length;
    }

    getMetrics() {
        return {
            service: this.serviceName,
            requestCount: this.requestCount,
            errorCount: this.errorCount,
            avgLatencyMs: Math.round(this.getAvgLatency() * 100) / 100,
            ordersProcessed: this.ordersProcessed,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            ...this.extra,
        };
    }

    getPrometheusMetrics(): string {
        const m = this.getMetrics();
        let out = '';
        out += `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="${m.service}"} ${m.requestCount}\n`;
        out += `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="${m.service}"} ${m.errorCount}\n`;
        out += `# HELP avg_latency_ms Average latency in ms\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="${m.service}"} ${m.avgLatencyMs}\n`;
        out += `# HELP orders_processed_total Total orders processed\n# TYPE orders_processed_total counter\norders_processed_total{service="${m.service}"} ${m.ordersProcessed}\n`;
        out += `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="${m.service}"} ${m.uptime}\n`;
        for (const [k, v] of Object.entries(this.extra)) {
            out += `# HELP ${k} Custom metric\n# TYPE ${k} gauge\n${k}{service="${m.service}"} ${v}\n`;
        }
        return out;
    }

    metricsMiddleware() {
        return (req: Request, res: Response, next: NextFunction) => {
            const start = Date.now();
            res.on('finish', () => {
                const latency = Date.now() - start;
                this.recordRequest(latency, res.statusCode >= 500);
            });
            next();
        };
    }
}

export { JWT_SECRET };
