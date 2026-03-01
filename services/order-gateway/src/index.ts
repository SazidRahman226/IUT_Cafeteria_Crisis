import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import Redis from "ioredis";
import amqplib from "amqplib";
import axios from "axios";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";

const PORT = parseInt(process.env.PORT || "8080");
const JWT_SECRET = process.env.JWT_SECRET || "devsprint-2026-secret-key";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const STOCK_SERVICE_URL =
  process.env.STOCK_SERVICE_URL || "http://localhost:4002";
const NOTIFICATION_HUB_URL =
  process.env.NOTIFICATION_HUB_URL || "http://localhost:4005";
const QUEUE_NAME = "kitchen_orders";
const STOCK_CACHE_TTL = 30;

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "cafeteria_orders",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

let redis: Redis;
let rabbitChannel: amqplib.Channel | null = null;

let requestCount = 0,
  errorCount = 0,
  ordersProcessed = 0;
let totalLatency = 0,
  recentTotalLatency = 0;
const latencies: number[] = [];
const recentLatencies: number[] = [];
const startTime = Date.now();

function recordRequest(ms: number, isErr = false) {
  requestCount++;
  if (isErr) errorCount++;

  latencies.push(ms);
  totalLatency += ms;
  if (latencies.length > 1000) totalLatency -= latencies.shift()!;

  recentLatencies.push(ms);
  recentTotalLatency += ms;
  if (recentLatencies.length > 50)
    recentTotalLatency -= recentLatencies.shift()!;
}

const getAvgLatency = () =>
  latencies.length ? totalLatency / latencies.length : 0;
const getRecentAvgLatency = () =>
  recentLatencies.length ? recentTotalLatency / recentLatencies.length : 0;
const log = (level: string, message: string, meta?: any) =>
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "order-gateway",
      message,
      ...meta,
    }),
  );

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_, res) =>
  res.send(
    `<html><head><title>Order Gateway</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:16px;max-width:500px;box-shadow:0 4px 30px rgba(0,0,0,.3)}h1{color:#a78bfa;margin-top:0}a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}code{background:#334155;padding:2px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>🛒 Order Gateway</h1><p>API Gateway for IUT Cafeteria Crisis</p><p><b>Endpoints:</b></p><ul><li><a href="/health">/health</a></li><li><a href="/metrics">/metrics</a></li><li><code>POST /api/orders</code></li><li><code>GET /api/menu</code></li><li><code>GET /api/orders</code></li></ul><p style="color:#64748b;font-size:12px">DevSprint 2026</p></div></body></html>`,
  ),
);

app.use((req, res, next) => {
  (req as any).requestId = req.headers["x-request-id"] || uuidv4();
  const start = Date.now();
  res.on("finish", () =>
    recordRequest(Date.now() - start, res.statusCode >= 500),
  );
  next();
});

function authenticateJwt(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer "))
    return res
      .status(401)
      .json({
        error: {
          code: "UNAUTHORIZED",
          message: "Missing token",
          traceId: (req as any).requestId,
        },
      });

  try {
    (req as any).user = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    res
      .status(401)
      .json({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid token",
          traceId: (req as any).requestId,
        },
      });
  }
}

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if ((req as any).user?.role !== "admin")
    return res
      .status(403)
      .json({
        error: {
          code: "FORBIDDEN",
          message: "Admin access required",
          traceId: (req as any).requestId,
        },
      });
  next();
}

app.get("/api/menu", async (req, res) => {
  const traceId = (req as any).requestId;
  try {
    res.json(
      (
        await axios.get(`${STOCK_SERVICE_URL}/stock`, {
          headers: { "X-Request-Id": traceId },
          timeout: 5000,
        })
      ).data,
    );
  } catch (err: any) {
    log("error", "Failed to fetch menu", { error: err.message, traceId });
    res
      .status(502)
      .json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Unable to fetch menu",
          traceId,
        },
      });
  }
});

app.get("/api/orders/revenue", async (req, res) => {
  if (!req.headers.authorization)
    return res
      .status(401)
      .json({
        error: {
          code: "UNAUTHORIZED",
          message: "Missing token",
          traceId: (req as any).requestId,
        },
      });
  try {
    const { rows } = await pool.query(
      "SELECT COALESCE(SUM(total_amount), 0) as total_revenue FROM orders WHERE status != 'FAILED'",
    );
    res.json({ totalRevenue: parseFloat(rows[0].total_revenue) });
  } catch (err: any) {
    log("error", "Revenue fetch failed", { error: err.message });
    res
      .status(500)
      .json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Calculation failed",
          traceId: (req as any)?.requestId || "",
        },
      });
  }
});

app.post("/api/orders", authenticateJwt, async (req, res) => {
  const traceId = (req as any).requestId;
  const user = (req as any).user;
  const { items } = req.body;
  const idempotencyKey = (req.headers["idempotency-key"] as string) || uuidv4();

  if (!items?.length)
    return res
      .status(400)
      .json({
        error: {
          code: "VALIDATION_ERROR",
          message: "items array is required",
          traceId,
        },
      });
  if (items.some((i: any) => !i.itemId || !i.quantity || i.quantity <= 0))
    return res
      .status(400)
      .json({
        error: { code: "VALIDATION_ERROR", message: "Invalid items", traceId },
      });

  try {
    const cached = await redis.get(`idempotency:${idempotencyKey}`);
    if (cached) {
      log("info", "Returning cached order", { idempotencyKey, traceId });
      return res.json(JSON.parse(cached));
    }
  } catch (err: any) {
    log("warn", "Redis check failed", { error: err.message });
  }

  const orderId = uuidv4();

  try {
    for (const item of items) {
      try {
        const stock = await redis.get(`stock:${item.itemId}`);
        if (stock !== null && parseInt(stock) < item.quantity) {
          return res
            .status(409)
            .json({
              error: {
                code: "OUT_OF_STOCK",
                message: `${item.name} out of stock (cached)`,
                traceId,
              },
            });
        }
      } catch {}
    }

    let totalAmount = 0;
    const reservedItems = [];

    for (const item of items) {
      const reserveRes = await axios.post(
        `${STOCK_SERVICE_URL}/stock/reserve`,
        {
          itemId: item.itemId,
          quantity: item.quantity,
          idempotencyKey: `${idempotencyKey}-${item.itemId}`,
        },
        { headers: { "X-Request-Id": traceId }, timeout: 5000 },
      );
      try {
        await redis.set(
          `stock:${item.itemId}`,
          reserveRes.data.remainingQty.toString(),
          "EX",
          STOCK_CACHE_TTL,
        );
      } catch {}

      try {
        const { data } = await axios.get(
          `${STOCK_SERVICE_URL}/stock/${item.itemId}`,
          { headers: { "X-Request-Id": traceId }, timeout: 5000 },
        );
        item.name = data.name;
        item.price = data.price;
        totalAmount += item.price * item.quantity;
      } catch {
        item.name = item.name || "Unknown";
        item.price = item.price || 0;
      }
      reservedItems.push(item);
    }

    await pool.query(
      "INSERT INTO orders (order_id, student_id, items, total_amount, status, idempotency_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())",
      [
        orderId,
        user.sub,
        JSON.stringify(items),
        totalAmount,
        "STOCK_VERIFIED",
        idempotencyKey,
      ],
    );

    let published = false;
    if (rabbitChannel) {
      try {
        rabbitChannel.sendToQueue(
          QUEUE_NAME,
          Buffer.from(
            JSON.stringify({
              orderId,
              studentId: user.sub,
              items: reservedItems,
              timestamp: new Date().toISOString(),
            }),
          ),
          { persistent: true, messageId: orderId },
        );
        published = true;
      } catch (err: any) {
        log("error", "RabbitMQ publish failed", {
          error: err.message,
          traceId,
        });
      }
    }

    if (!published) {
      await pool.query("UPDATE orders SET status = $1 WHERE order_id = $2", [
        "PENDING_QUEUE",
        orderId,
      ]);
      log("warn", "Order queued for retry", { orderId, traceId });
    }

    try {
      await axios.post(
        `${NOTIFICATION_HUB_URL}/notify`,
        {
          orderId,
          studentId: user.sub,
          status: "STOCK_VERIFIED",
          timestamp: new Date().toISOString(),
          message: "Stock verified, sending to kitchen",
        },
        { timeout: 3000 },
      );
    } catch {
      log("warn", "Hub notify failed", { orderId, traceId });
    }

    const response = {
      orderId,
      studentId: user.sub,
      items: reservedItems,
      totalAmount,
      status: published ? "STOCK_VERIFIED" : "PENDING_QUEUE",
      createdAt: new Date().toISOString(),
    };
    try {
      await redis.set(
        `idempotency:${idempotencyKey}`,
        JSON.stringify(response),
        "EX",
        3600,
      );
    } catch {}

    ordersProcessed++;
    log("info", "Order placed", {
      orderId,
      studentId: user.sub,
      totalAmount,
      traceId,
    });
    res.status(201).json(response);
  } catch (err: any) {
    if (err.response?.status === 409)
      return res
        .status(409)
        .json({
          error: {
            code: "OUT_OF_STOCK",
            message: err.response.data?.error?.message || "Out of stock",
            traceId,
          },
        });
    log("error", "Order failed", { error: err.message, traceId });
    res
      .status(500)
      .json({
        error: {
          code: "ORDER_FAILED",
          message: "Failed to place order",
          traceId,
        },
      });
  }
});

app.get("/api/orders/:orderId", authenticateJwt, async (req, res) => {
  const traceId = (req as any).requestId;
  const user = (req as any).user;
  try {
    const { rows } = await pool.query(
      "SELECT order_id, student_id, items, total_amount, status, created_at FROM orders WHERE order_id = $1",
      [req.params.orderId],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({
          error: { code: "NOT_FOUND", message: "Order not found", traceId },
        });

    const order = rows[0];
    if (user.role !== "admin" && order.student_id !== user.sub)
      return res
        .status(403)
        .json({
          error: { code: "FORBIDDEN", message: "Access denied", traceId },
        });

    res.json({
      orderId: order.order_id,
      studentId: order.student_id,
      items:
        typeof order.items === "string" ? JSON.parse(order.items) : order.items,
      totalAmount: parseFloat(order.total_amount),
      status: order.status,
      createdAt: order.created_at,
    });
  } catch (err: any) {
    log("error", "Get order failed", { error: err.message, traceId });
    res
      .status(500)
      .json({
        error: { code: "INTERNAL_ERROR", message: "Fetch failed", traceId },
      });
  }
});

app.get("/api/orders", authenticateJwt, async (req, res) => {
  const traceId = (req as any).requestId;
  const user = (req as any).user;
  try {
    const query =
      user.role === "admin"
        ? "SELECT * FROM orders ORDER BY created_at DESC LIMIT 100"
        : "SELECT * FROM orders WHERE student_id = $1 ORDER BY created_at DESC LIMIT 50";
    const params = user.role === "admin" ? [] : [user.sub];
    const { rows } = await pool.query(query, params);

    res.json(
      rows.map((r) => ({
        orderId: r.order_id,
        studentId: r.student_id,
        items: typeof r.items === "string" ? JSON.parse(r.items) : r.items,
        totalAmount: parseFloat(r.total_amount),
        status: r.status,
        createdAt: r.created_at,
      })),
    );
  } catch (err: any) {
    log("error", "List orders failed", { error: err.message, traceId });
    res
      .status(500)
      .json({
        error: { code: "INTERNAL_ERROR", message: "List failed", traceId },
      });
  }
});

app.patch("/api/orders/:orderId/status", async (req, res) => {
  const traceId = (req as any).requestId;
  const { status } = req.body;
  const validInternalKey =
    req.headers["x-internal-key"] ===
    (process.env.INTERNAL_SECRET || "devsprint-internal-2026");

  let authorized = validInternalKey;
  if (!authorized && req.headers.authorization?.startsWith("Bearer ")) {
    try {
      authorized =
        (jwt.verify(req.headers.authorization.split(" ")[1], JWT_SECRET) as any)
          .role === "admin";
    } catch {}
  }

  if (!authorized)
    return res
      .status(401)
      .json({
        error: {
          code: "UNAUTHORIZED",
          message: "Admin access required",
          traceId,
        },
      });

  const validStatuses = [
    "PENDING",
    "STOCK_VERIFIED",
    "IN_KITCHEN",
    "READY",
    "FAILED",
    "PENDING_QUEUE",
  ];
  if (!validStatuses.includes(status))
    return res
      .status(400)
      .json({
        error: { code: "VALIDATION_ERROR", message: `Invalid status`, traceId },
      });

  try {
    await pool.query("UPDATE orders SET status = $1 WHERE order_id = $2", [
      status,
      req.params.orderId,
    ]);
    res.json({ orderId: req.params.orderId, status });
  } catch (err: any) {
    log("error", "Status update failed", { error: err.message, traceId });
    res
      .status(500)
      .json({
        error: { code: "INTERNAL_ERROR", message: "Update failed", traceId },
      });
  }
});

app.get("/health", async (_, res) => {
  const deps: any = {
    rabbitmq: rabbitChannel ? { status: "ok" } : { status: "down" },
  };
  try {
    const start = Date.now();
    await pool.query("SELECT 1");
    deps.postgres = { status: "ok", latency: Date.now() - start };
  } catch {
    deps.postgres = { status: "down" };
  }
  try {
    const start = Date.now();
    await redis.ping();
    deps.redis = { status: "ok", latency: Date.now() - start };
  } catch {
    deps.redis = { status: "down" };
  }

  const allOk = Object.values(deps).every((d: any) => d.status === "ok");
  res
    .status(allOk ? 200 : 503)
    .json({
      status: allOk ? "ok" : "degraded",
      service: "order-gateway",
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      dependencies: deps,
    });
});

app.get("/metrics", (_, res) =>
  res
    .set("Content-Type", "text/plain")
    .send(
      `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="order-gateway"} ${requestCount}\n` +
        `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="order-gateway"} ${errorCount}\n` +
        `# HELP avg_latency_ms Average latency\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="order-gateway"} ${Math.round(getAvgLatency() * 100) / 100}\n` +
        `# HELP recent_avg_latency_ms Recent 30s avg latency\n# TYPE recent_avg_latency_ms gauge\nrecent_avg_latency_ms{service="order-gateway"} ${Math.round(getRecentAvgLatency() * 100) / 100}\n` +
        `# HELP orders_processed_total Orders processed\n# TYPE orders_processed_total counter\norders_processed_total{service="order-gateway"} ${ordersProcessed}\n` +
        `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="order-gateway"} ${Math.floor((Date.now() - startTime) / 1000)}\n`,
    ),
);

app.get("/metrics/json", (_, res) =>
  res.json({
    service: "order-gateway",
    requestCount,
    errorCount,
    avgLatencyMs: Math.round(getAvgLatency() * 100) / 100,
    recentAvgLatencyMs: Math.round(getRecentAvgLatency() * 100) / 100,
    ordersProcessed,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  }),
);

app.post("/chaos/kill", authenticateJwt, requireAdmin, (_, res) => {
  log("warn", "CHAOS: Gateway kill triggered");
  res.json({ message: "Shutting down..." });
  setTimeout(() => process.exit(1), 500);
});

async function retryPendingOrders() {
  if (!rabbitChannel) return;
  try {
    const { rows } = await pool.query(
      "SELECT order_id, student_id, items FROM orders WHERE status = 'PENDING_QUEUE' LIMIT 10",
    );
    await Promise.allSettled(
      rows.map(async (row) => {
        const msg = {
          orderId: row.order_id,
          studentId: row.student_id,
          items:
            typeof row.items === "string" ? JSON.parse(row.items) : row.items,
          timestamp: new Date().toISOString(),
        };
        rabbitChannel!.sendToQueue(
          QUEUE_NAME,
          Buffer.from(JSON.stringify(msg)),
          { persistent: true, messageId: row.order_id },
        );
        await pool.query("UPDATE orders SET status = $1 WHERE order_id = $2", [
          "STOCK_VERIFIED",
          row.order_id,
        ]);
        log("info", "Retried pending order", { orderId: row.order_id });
      }),
    );
  } catch (err: any) {
    log("error", "Retry scan failed", { error: err.message });
  }
}

async function connectRedis() {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: (t) => Math.min(t * 500, 5000),
    lazyConnect: true,
  });
  for (let i = 30; i > 0; i--) {
    try {
      await redis.connect();
      log("info", "Redis connected");
      return;
    } catch {
      log("warn", `Waiting for Redis... (${i - 1} left)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  log("error", "Redis connection failed");
}

async function connectRabbitMQ() {
  for (let i = 30; i > 0; i--) {
    try {
      const conn = await amqplib.connect(RABBITMQ_URL);
      rabbitChannel = await conn.createChannel();
      await rabbitChannel.assertQueue(QUEUE_NAME, { durable: true });
      log("info", "RabbitMQ connected");
      conn.on("error", () => {
        rabbitChannel = null;
      });
      conn.on("close", () => {
        rabbitChannel = null;
      });
      return;
    } catch {
      log("warn", `Waiting for RabbitMQ... (${i - 1} left)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  log("error", "RabbitMQ connection failed");
}

async function connectDB() {
  for (let i = 30; i > 0; i--) {
    try {
      await pool.query("SELECT 1");
      log("info", "DB connected");
      return;
    } catch {
      log("warn", `Waiting for DB... (${i - 1} left)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  log("error", "DB connection failed");
  process.exit(1);
}

(async () => {
  await Promise.all([connectDB(), connectRedis(), connectRabbitMQ()]);
  setInterval(retryPendingOrders, 10000);
  app.listen(PORT, "0.0.0.0", () =>
    log("info", `Order Gateway running on port ${PORT}`),
  );
})().catch((err) => {
  log("error", "Failed to start", { error: err.message });
  process.exit(1);
});

export { app };
