import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import Redis from "ioredis";
import amqplib from "amqplib";
import axios from "axios";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

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
    return res.status(401).json({
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
    res.status(401).json({
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
    return res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Admin access required",
        traceId: (req as any).requestId,
      },
    });
  next();
}

function requireStaffOrAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const role = (req as any).user?.role;
  if (role !== "staff" && role !== "admin")
    return res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Staff access required",
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
    res.status(502).json({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Unable to fetch menu",
        traceId,
      },
    });
  }
});

app.get("/api/orders/revenue", async (req, res) => {
  const traceId = (req as any).requestId;
  try {
    const { rows } = await pool.query(
      "SELECT COALESCE(SUM(total_amount), 0) as total_revenue FROM orders WHERE status != 'FAILED'",
    );
    res.json({ totalRevenue: parseFloat(rows[0].total_revenue) });
  } catch (err: any) {
    log("error", "Revenue fetch failed", { error: err.message });
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Calculation failed",
        traceId: (req as any)?.requestId || "",
      },
    });
  }
});

app.get("/api/orders/orderCount", async (req, res) => {
  const traceId = (req as any).requestId;
  try {
    const { rows } = await pool.query("SELECT COUNT(*) as count FROM orders");
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (err: any) {
    log("error", "Order count fetch failed", { error: err.message });
    res.status(500).json({
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
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "items array is required",
        traceId,
      },
    });
  if (items.some((i: any) => !i.itemId || !i.quantity || i.quantity <= 0))
    return res.status(400).json({
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
    // Check if any items are disabled before proceeding
    for (const item of items) {
      try {
        const checkRes = await axios.get(
          `${STOCK_SERVICE_URL}/stock/check-enabled/${item.itemId}`,
          { headers: { "X-Request-Id": traceId }, timeout: 5000 },
        );
        if (!checkRes.data.isEnabled) {
          return res.status(409).json({
            error: {
              code: "ITEM_DISABLED",
              message: `${item.name || item.itemId} is currently disabled: ${checkRes.data.disabledReason || "Unavailable"}`,
              traceId,
            },
          });
        }
      } catch (err: any) {
        if (err.response?.status === 409 || err.response?.status === 404) {
          return res.status(409).json({
            error: {
              code: err.response?.data?.error?.code || "ITEM_DISABLED",
              message: err.response?.data?.error?.message || "Item unavailable",
              traceId,
            },
          });
        }
      }
    }

    for (const item of items) {
      try {
        const stock = await redis.get(`stock:${item.itemId}`);
        if (stock !== null && parseInt(stock) < item.quantity) {
          return res.status(409).json({
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
      return res.status(409).json({
        error: {
          code: "OUT_OF_STOCK",
          message: err.response.data?.error?.message || "Out of stock",
          traceId,
        },
      });
    log("error", "Order failed", { error: err.message, traceId });
    res.status(500).json({
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
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Order not found", traceId },
      });

    const order = rows[0];
    if (user.role !== "admin" && order.student_id !== user.sub)
      return res.status(403).json({
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
    res.status(500).json({
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
    res.status(500).json({
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
    return res.status(401).json({
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
    "DELIVERED",
    "FAILED",
    "PENDING_QUEUE",
  ];
  if (!validStatuses.includes(status))
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: `Invalid status`, traceId },
    });

  try {
    await pool.query("UPDATE orders SET status = $1, updated_at = NOW() WHERE order_id = $2", [
      status,
      req.params.orderId,
    ]);

    // When status changes to READY, generate OTP
    if (status === "READY") {
      try {
        const otpCode = crypto.randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await pool.query(
          "INSERT INTO order_delivery (order_id, otp_code, otp_expires_at) VALUES ($1, $2, $3) ON CONFLICT (order_id) DO UPDATE SET otp_code = $2, otp_expires_at = $3, is_used = FALSE",
          [req.params.orderId, otpCode, expiresAt],
        );
        log("info", "OTP generated for order", { orderId: req.params.orderId });
      } catch (otpErr: any) {
        log("error", "OTP generation failed", { error: otpErr.message, orderId: req.params.orderId });
      }
    }

    res.json({ orderId: req.params.orderId, status });
  } catch (err: any) {
    log("error", "Status update failed", { error: err.message, traceId });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Update failed", traceId },
    });
  }
});

// ========== OTP RETRIEVAL (Student only - secure) ==========
app.get("/api/orders/:orderId/otp", authenticateJwt, async (req, res) => {
  const traceId = (req as any).requestId;
  const user = (req as any).user;

  try {
    // Only allow the student who placed the order to see OTP
    const { rows: orderRows } = await pool.query(
      "SELECT student_id, status FROM orders WHERE order_id = $1",
      [req.params.orderId],
    );
    if (!orderRows.length) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found", traceId } });
    if (orderRows[0].student_id !== user.sub && user.role !== "admin")
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied", traceId } });
    if (orderRows[0].status !== "READY")
      return res.status(400).json({ error: { code: "NOT_READY", message: "Order is not ready yet", traceId } });

    // Always generate a fresh 2-minute OTP on each request
    const crypto = await import("crypto");
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

    const { rows } = await pool.query(
      `INSERT INTO order_delivery (order_id, otp_code, otp_expires_at, is_used)
       VALUES ($1, $2, $3, FALSE)
       ON CONFLICT (order_id) DO UPDATE SET otp_code = $2, otp_expires_at = $3, is_used = FALSE
       RETURNING otp_code, otp_expires_at`,
      [req.params.orderId, otpCode, expiresAt],
    );
    log("info", "OTP generated", { orderId: req.params.orderId, traceId });

    res.json({
      orderId: req.params.orderId,
      otpCode: rows[0].otp_code,
      expiresAt: rows[0].otp_expires_at,
    });
  } catch (err: any) {
    log("error", "OTP fetch failed", { error: err.message, traceId });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Fetch failed", traceId } });
  }
});

// ========== VERIFY & DELIVER (Staff endpoint) ==========
app.post("/api/orders/:orderId/verify-delivery", authenticateJwt, requireStaffOrAdmin, async (req, res) => {
  const traceId = (req as any).requestId;
  const { otp } = req.body;
  const orderId = req.params.orderId;

  if (!otp) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "OTP is required", traceId } });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get order
    const { rows: orderRows } = await client.query(
      "SELECT student_id, items, total_amount, status FROM orders WHERE order_id = $1 FOR UPDATE",
      [orderId],
    );
    if (!orderRows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found", traceId } }); }
    if (orderRows[0].status !== "READY") { await client.query("ROLLBACK"); return res.status(400).json({ error: { code: "NOT_READY", message: "Order is not in READY status", traceId } }); }

    // Get OTP
    const { rows: otpRows } = await client.query(
      "SELECT otp_code, otp_expires_at, is_used FROM order_delivery WHERE order_id = $1 FOR UPDATE",
      [orderId],
    );
    if (!otpRows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "NOT_FOUND", message: "No OTP found for this order", traceId } }); }

    const delivery = otpRows[0];

    // Validate OTP
    if (delivery.is_used) { await client.query("ROLLBACK"); return res.status(400).json({ error: { code: "OTP_USED", message: "OTP already used", traceId } }); }
    if (new Date(delivery.otp_expires_at) < new Date()) { await client.query("ROLLBACK"); return res.status(400).json({ error: { code: "OTP_EXPIRED", message: "OTP has expired", traceId } }); }
    if (delivery.otp_code !== otp.toString()) { await client.query("ROLLBACK"); return res.status(401).json({ error: { code: "INVALID_OTP", message: "Invalid OTP", traceId } }); }

    // Mark OTP as used
    await client.query(
      "UPDATE order_delivery SET is_used = TRUE, delivered_at = NOW() WHERE order_id = $1",
      [orderId],
    );

    // Update order status to DELIVERED
    await client.query(
      "UPDATE orders SET status = 'DELIVERED', updated_at = NOW() WHERE order_id = $1",
      [orderId],
    );

    // Insert revenue record
    const revenueId = uuidv4();
    await client.query(
      "INSERT INTO revenue (id, order_id, student_id, amount) VALUES ($1, $2, $3, $4)",
      [revenueId, orderId, orderRows[0].student_id, orderRows[0].total_amount],
    );

    await client.query("COMMIT");

    // Notify student via notification hub (fire-and-forget)
    try {
      await axios.post(
        `${NOTIFICATION_HUB_URL}/notify`,
        {
          orderId,
          studentId: orderRows[0].student_id,
          status: "DELIVERED",
          timestamp: new Date().toISOString(),
          message: "Your order has been delivered!",
        },
        { timeout: 3000 },
      );
    } catch { log("warn", "Delivery notification failed", { orderId }); }

    log("info", "Order delivered", { orderId, studentId: orderRows[0].student_id, traceId });
    res.json({
      message: "Order successfully delivered",
      orderId,
      studentId: orderRows[0].student_id,
      totalAmount: parseFloat(orderRows[0].total_amount),
      deliveredAt: new Date().toISOString(),
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    log("error", "Delivery verification failed", { error: err.message, traceId });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Verification failed", traceId } });
  } finally {
    client.release();
  }
});

// ========== STAFF: Mark order as READY ==========
app.post("/api/staff/orders/:orderId/ready", authenticateJwt, requireStaffOrAdmin, async (req, res) => {
  const traceId = (req as any).requestId;
  const orderId = req.params.orderId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get order and verify it's IN_KITCHEN
    const { rows: orderRows } = await client.query(
      "SELECT student_id, status FROM orders WHERE order_id = $1 FOR UPDATE",
      [orderId],
    );
    if (!orderRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found", traceId } });
    }
    if (orderRows[0].status !== "IN_KITCHEN") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "INVALID_STATUS", message: `Order is ${orderRows[0].status}, not IN_KITCHEN`, traceId } });
    }

    // Update order status to READY
    await client.query(
      "UPDATE orders SET status = 'READY', updated_at = NOW() WHERE order_id = $1",
      [orderId],
    );

    // Generate OTP for the order
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await client.query(
      `INSERT INTO order_delivery (order_id, otp_code, otp_expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_id) DO UPDATE SET otp_code = $2, otp_expires_at = $3, is_used = FALSE`,
      [orderId, otpCode, expiresAt],
    );

    await client.query("COMMIT");

    // Notify student via notification hub
    try {
      await axios.post(
        `${NOTIFICATION_HUB_URL}/notify`,
        {
          orderId,
          studentId: orderRows[0].student_id,
          status: "READY",
          timestamp: new Date().toISOString(),
          message: "Your order is ready for pickup!",
          otp: otpCode,
          otpExpiresAt: expiresAt.toISOString(),
        },
        { timeout: 3000 },
      );
    } catch {
      log("warn", "Ready notification failed", { orderId });
    }

    log("info", "Staff marked order as READY", { orderId, staffId: (req as any).user.sub, traceId });
    res.json({ message: "Order marked as ready", orderId, status: "READY" });
  } catch (err: any) {
    await client.query("ROLLBACK");
    log("error", "Mark ready failed", { error: err.message, traceId });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to mark ready", traceId } });
  } finally {
    client.release();
  }
});

// ========== STAFF: Get orders by status ==========
app.get("/api/staff/orders", authenticateJwt, requireStaffOrAdmin, async (req, res) => {
  const traceId = (req as any).requestId;
  const status = req.query.status as string;
  try {
    let query = "SELECT o.order_id, o.student_id, o.items, o.total_amount, o.status, o.created_at, o.updated_at, od.delivered_at FROM orders o LEFT JOIN order_delivery od ON o.order_id = od.order_id";
    const params: any[] = [];
    if (status) {
      query += " WHERE o.status = $1";
      params.push(status);
    }
    query += " ORDER BY o.created_at DESC LIMIT 200";
    const { rows } = await pool.query(query, params);
    res.json(rows.map((r) => ({
      orderId: r.order_id,
      studentId: r.student_id,
      items: typeof r.items === "string" ? JSON.parse(r.items) : r.items,
      totalAmount: parseFloat(r.total_amount),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deliveredAt: r.delivered_at,
    })));
  } catch (err: any) {
    log("error", "Staff orders fetch failed", { error: err.message, traceId });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Fetch failed", traceId } });
  }
});

// ========== STAFF: Get delivered orders ==========
app.get("/api/staff/delivered", authenticateJwt, requireStaffOrAdmin, async (req, res) => {
  const traceId = (req as any).requestId;
  try {
    const { rows } = await pool.query(
      `SELECT o.order_id, o.student_id, o.items, o.total_amount, o.status, o.created_at, od.delivered_at, r.amount as revenue_amount
       FROM orders o
       JOIN order_delivery od ON o.order_id = od.order_id
       LEFT JOIN revenue r ON o.order_id = r.order_id
       WHERE o.status = 'DELIVERED'
       ORDER BY od.delivered_at DESC
       LIMIT 200`,
    );
    res.json(rows.map((r) => ({
      orderId: r.order_id,
      studentId: r.student_id,
      items: typeof r.items === "string" ? JSON.parse(r.items) : r.items,
      totalAmount: parseFloat(r.total_amount),
      status: r.status,
      createdAt: r.created_at,
      deliveredAt: r.delivered_at,
      revenueAmount: r.revenue_amount ? parseFloat(r.revenue_amount) : parseFloat(r.total_amount),
    })));
  } catch (err: any) {
    log("error", "Delivered fetch failed", { error: err.message, traceId });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Fetch failed", traceId } });
  }
});

// ========== REVENUE ENDPOINTS ==========
app.get("/api/revenue/total", authenticateJwt, async (req, res) => {
  const traceId = (req as any).requestId;
  try {
    const { rows } = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM revenue");
    res.json({ totalRevenue: parseFloat(rows[0].total) });
  } catch (err: any) {
    log("error", "Revenue total fetch failed", { error: err.message });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Fetch failed", traceId } });
  }
});

app.get("/api/revenue/daily", authenticateJwt, async (req, res) => {
  const traceId = (req as any).requestId;
  try {
    const { rows } = await pool.query(
      `SELECT DATE(created_at) as date, SUM(amount) as total
       FROM revenue
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
    );
    res.json(rows.map((r) => ({ date: r.date, total: parseFloat(r.total) })));
  } catch (err: any) {
    log("error", "Daily revenue fetch failed", { error: err.message });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Fetch failed", traceId } });
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
  res.status(allOk ? 200 : 503).json({
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

      // Run migrations for new tables
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS order_delivery (
            order_id VARCHAR(100) PRIMARY KEY REFERENCES orders(order_id),
            otp_code TEXT NOT NULL,
            otp_expires_at TIMESTAMPTZ NOT NULL,
            is_used BOOLEAN DEFAULT FALSE,
            delivered_at TIMESTAMPTZ
          )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_order_delivery_order ON order_delivery (order_id)`);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS revenue (
            id VARCHAR(100) PRIMARY KEY,
            order_id VARCHAR(100) REFERENCES orders(order_id),
            student_id VARCHAR(50) NOT NULL,
            amount NUMERIC NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_revenue_order ON revenue (order_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_revenue_created ON revenue (created_at)`);
        log("info", "Order DB migrations applied");
      } catch (migErr: any) {
        log("warn", "Migration may already be applied", { error: migErr.message });
      }

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
