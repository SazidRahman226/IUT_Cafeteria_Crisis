import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";

const PORT = parseInt(process.env.PORT || "4002");
const JWT_SECRET = process.env.JWT_SECRET || "devsprint-2026-secret-key";

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "cafeteria_inventory",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

let requestCount = 0,
  errorCount = 0,
  totalLatency = 0,
  ordersProcessed = 0;
const latencies: number[] = [];
const startTime = Date.now();

const log = (level: string, message: string, meta?: any) =>
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "stock-service",
      message,
      ...meta,
    }),
  );

function recordRequest(ms: number, isErr = false) {
  requestCount++;
  if (isErr) errorCount++;
  latencies.push(ms);
  totalLatency += ms;
  if (latencies.length > 500) totalLatency -= latencies.shift()!;
}

const getAvgLatency = () =>
  latencies.length ? totalLatency / latencies.length : 0;
const uptime = () => Math.floor((Date.now() - startTime) / 1000);

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  (req as any).requestId = req.headers["x-request-id"] || uuidv4();
  const start = Date.now();
  res.on("finish", () =>
    recordRequest(Date.now() - start, res.statusCode >= 500),
  );
  next();
});

app.get("/", (_, res) =>
  res.send(
    `<html><head><title>Stock Service</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:16px;max-width:500px;box-shadow:0 4px 30px rgba(0,0,0,.3)}h1{color:#34d399;margin-top:0}a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}code{background:#334155;padding:2px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>📦 Stock Service</h1><p>Inventory management with optimistic locking</p><p><b>Endpoints:</b></p><ul><li><a href="/health">/health</a></li><li><a href="/stock">/stock</a></li><li><a href="/metrics">/metrics</a></li><li><code>POST /stock/deduct</code></li></ul><p style="color:#64748b;font-size:12px">DevSprint 2026</p></div></body></html>`,
  ),
);

app.get("/stock", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT item_id, name, description, price, category, image_url, available_qty, version FROM inventory ORDER BY category, name",
    );
    res.json(
      rows.map((r) => ({
        itemId: r.item_id,
        name: r.name,
        description: r.description,
        price: parseFloat(r.price),
        category: r.category,
        imageUrl: r.image_url,
        availableQty: r.available_qty,
        version: r.version,
      })),
    );
  } catch (err: any) {
    log("error", "Fetch stock failed", { error: err.message });
    res
      .status(500)
      .json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Fetch failed",
          traceId: (req as any)?.requestId || "",
        },
      });
  }
});

app.get("/stock/:itemId", async (req, res) => {
  const traceId = (req as any).requestId;
  try {
    const { rows } = await pool.query(
      "SELECT item_id, name, description, price, category, image_url, available_qty, version FROM inventory WHERE item_id = $1",
      [req.params.itemId],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({
          error: { code: "NOT_FOUND", message: "Item not found", traceId },
        });

    const r = rows[0];
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
    log("error", "Fetch item failed", {
      error: err.message,
      itemId: req.params.itemId,
    });
    res
      .status(500)
      .json({
        error: { code: "INTERNAL_ERROR", message: "Fetch failed", traceId },
      });
  }
});

app.post("/stock/reserve", async (req, res) => {
  const { itemId, quantity, idempotencyKey } = req.body;
  const traceId = (req as any).requestId;

  if (!itemId || !quantity || quantity <= 0)
    return res
      .status(400)
      .json({
        error: { code: "VALIDATION_ERROR", message: "Invalid input", traceId },
      });

  if (idempotencyKey) {
    try {
      const { rows } = await pool.query(
        "SELECT result FROM idempotency_keys WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      if (rows.length) {
        log("info", "Returning cached result", { idempotencyKey, traceId });
        return res.json(JSON.parse(rows[0].result));
      }
    } catch (err: any) {
      log("warn", "Idempotency check failed", { error: err.message });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query(
      "SELECT name, available_qty, version FROM inventory WHERE item_id = $1 FOR UPDATE",
      [itemId],
    );

    if (!current.rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({
          error: { code: "NOT_FOUND", message: "Item not found", traceId },
        });
    }

    const { name, available_qty, version } = current.rows[0];

    if (available_qty < quantity) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({
          error: {
            code: "OUT_OF_STOCK",
            message: `Insufficient ${name}. Available: ${available_qty}`,
            traceId,
          },
        });
    }

    const updateResult = await client.query(
      "UPDATE inventory SET available_qty = available_qty - $1, version = version + 1 WHERE item_id = $2 AND version = $3 AND available_qty >= $1 RETURNING available_qty",
      [quantity, itemId, version],
    );

    if (!updateResult.rowCount) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({
          error: {
            code: "CONFLICT",
            message: "Concurrent modification, retry",
            traceId,
          },
        });
    }

    const response = {
      success: true,
      itemId,
      reservedQty: quantity,
      remainingQty: updateResult.rows[0].available_qty,
    };

    if (idempotencyKey) {
      await client.query(
        "INSERT INTO idempotency_keys (idempotency_key, result, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING",
        [idempotencyKey, JSON.stringify(response)],
      );
    }

    await client.query("COMMIT");
    ordersProcessed++;
    log("info", "Stock reserved", {
      itemId,
      quantity,
      remaining: response.remainingQty,
      traceId,
    });
    res.json(response);
  } catch (err: any) {
    await client.query("ROLLBACK");
    log("error", "Reserve failed", { error: err.message, traceId });
    res
      .status(500)
      .json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Reservation failed",
          traceId,
        },
      });
  } finally {
    client.release();
  }
});

app.get("/health", async (_, res) => {
  try {
    const start = Date.now();
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      service: "stock-service",
      timestamp: new Date().toISOString(),
      uptime: uptime(),
      dependencies: { postgres: { status: "ok", latency: Date.now() - start } },
    });
  } catch {
    res
      .status(503)
      .json({
        status: "down",
        service: "stock-service",
        timestamp: new Date().toISOString(),
        uptime: uptime(),
        dependencies: { postgres: { status: "down" } },
      });
  }
});

app.get("/metrics", (_, res) =>
  res
    .set("Content-Type", "text/plain")
    .send(
      `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="stock-service"} ${requestCount}\n` +
        `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="stock-service"} ${errorCount}\n` +
        `# HELP avg_latency_ms Average latency\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="stock-service"} ${Math.round(getAvgLatency() * 100) / 100}\n` +
        `# HELP orders_processed_total Orders processed\n# TYPE orders_processed_total counter\norders_processed_total{service="stock-service"} ${ordersProcessed}\n` +
        `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="stock-service"} ${uptime()}\n`,
    ),
);

app.get("/metrics/json", (_, res) =>
  res.json({
    service: "stock-service",
    requestCount,
    errorCount,
    avgLatencyMs: Math.round(getAvgLatency() * 100) / 100,
    ordersProcessed,
    uptime: uptime(),
  }),
);

app.post("/chaos/kill", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return res
      .status(401)
      .json({ error: { code: "UNAUTHORIZED", message: "Missing token" } });
  try {
    if ((jwt.verify(auth.split(" ")[1], JWT_SECRET) as any).role !== "admin")
      return res
        .status(403)
        .json({ error: { code: "FORBIDDEN", message: "Admin only" } });
    log("warn", "CHAOS: Service kill triggered");
    res.json({ message: "Service shutting down..." });
    setTimeout(() => process.exit(1), 500);
  } catch {
    res
      .status(401)
      .json({ error: { code: "UNAUTHORIZED", message: "Invalid token" } });
  }
});

(async () => {
  for (let i = 30; i > 0; i--) {
    try {
      await pool.query("SELECT 1");
      log("info", "Database connected");
      break;
    } catch {
      log("warn", `Waiting for database... (${i - 1} left)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (i === 1) {
      log("error", "DB connection failed");
      process.exit(1);
    }
  }
  app.listen(PORT, "0.0.0.0", () =>
    log("info", `Stock Service running on port ${PORT}`),
  );
})().catch((err) => {
  log("error", "Failed to start", { error: err.message });
  process.exit(1);
});

export { app, pool };
