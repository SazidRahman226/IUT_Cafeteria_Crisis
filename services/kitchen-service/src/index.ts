import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import amqplib from "amqplib";
import axios from "axios";

const PORT = parseInt(process.env.PORT || "4003");
const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const GATEWAY_URL = process.env.GATEWAY_URL || "http://order-gateway:8080";
const NOTIFICATION_HUB_URL =
  process.env.NOTIFICATION_HUB_URL || "http://notification-hub:4005";
const JWT_SECRET = process.env.JWT_SECRET || "devsprint-2026-secret-key";
const INTERNAL_SECRET =
  process.env.INTERNAL_SECRET || "devsprint-internal-2026";
const QUEUE_NAME = "kitchen_orders";

let requestCount = 0,
  errorCount = 0,
  totalLatency = 0,
  ordersProcessed = 0,
  totalCookingTimeMs = 0;
const latencies: number[] = [];
const startTime = Date.now();
let processedOrderIds = new Set<string>();
let rabbitConnected = false;

const log = (level: string, message: string, meta?: any) =>
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "kitchen-service",
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
const getAvgCooking = () =>
  ordersProcessed ? Math.round(totalCookingTimeMs / ordersProcessed) : 0;

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () =>
    recordRequest(Date.now() - start, res.statusCode >= 500),
  );
  next();
});

app.get("/", (_, res) =>
  res.send(
    `<html><head><title>Kitchen Service</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:16px;max-width:500px;box-shadow:0 4px 30px rgba(0,0,0,.3)}h1{color:#fb923c;margin-top:0}a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}code{background:#334155;padding:2px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>👨‍🍳 Kitchen Service</h1><p>Async order processing via RabbitMQ</p><p><b>Endpoints:</b></p><ul><li><a href="/health">/health</a></li><li><a href="/metrics">/metrics</a></li><li><code>POST /chaos/kill</code></li></ul><p style="color:#64748b;font-size:12px">DevSprint 2026</p></div></body></html>`,
  ),
);

app.get("/health", (_, res) =>
  res
    .status(rabbitConnected ? 200 : 503)
    .json({
      status: rabbitConnected ? "ok" : "down",
      service: "kitchen-service",
      timestamp: new Date().toISOString(),
      uptime: uptime(),
      dependencies: { rabbitmq: { status: rabbitConnected ? "ok" : "down" } },
    }),
);

app.get("/metrics", (_, res) =>
  res
    .set("Content-Type", "text/plain")
    .send(
      `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="kitchen-service"} ${requestCount}\n` +
        `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="kitchen-service"} ${errorCount}\n` +
        `# HELP avg_latency_ms Average latency\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="kitchen-service"} ${Math.round(getAvgLatency() * 100) / 100}\n` +
        `# HELP orders_processed_total Orders processed\n# TYPE orders_processed_total counter\norders_processed_total{service="kitchen-service"} ${ordersProcessed}\n` +
        `# HELP kitchen_processing_time_ms Avg cooking time\n# TYPE kitchen_processing_time_ms gauge\nkitchen_processing_time_ms{service="kitchen-service"} ${getAvgCooking()}\n` +
        `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="kitchen-service"} ${uptime()}\n`,
    ),
);

app.get("/metrics/json", (_, res) =>
  res.json({
    service: "kitchen-service",
    requestCount,
    errorCount,
    avgLatencyMs: Math.round(getAvgLatency() * 100) / 100,
    ordersProcessed,
    kitchenProcessingTimeMs: getAvgCooking(),
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
    log("warn", "CHAOS: Kitchen service kill triggered");
    res.json({ message: "Service shutting down..." });
    setTimeout(() => process.exit(1), 500);
  } catch {
    res
      .status(401)
      .json({ error: { code: "UNAUTHORIZED", message: "Invalid token" } });
  }
});

const notifyAndUpdate = async (
  orderId: string,
  studentId: string,
  status: string,
  message: string,
) => {
  try {
    await Promise.allSettled([
      axios.post(
        `${NOTIFICATION_HUB_URL}/notify`,
        {
          orderId,
          studentId,
          status,
          timestamp: new Date().toISOString(),
          message,
        },
        { timeout: 3000 },
      ),
      axios.patch(
        `${GATEWAY_URL}/api/orders/${orderId}/status`,
        { status },
        { timeout: 3000, headers: { "X-Internal-Key": INTERNAL_SECRET } },
      ),
    ]);
  } catch (err: any) {
    log("warn", `Failed to sync status ${status}`, {
      orderId,
      error: err.message,
    });
  }
};

async function processOrder(
  msg: amqplib.ConsumeMessage,
  channel: amqplib.Channel,
) {
  const { orderId, studentId } = JSON.parse(msg.content.toString());

  if (processedOrderIds.has(orderId)) {
    log("info", "Duplicate order skipped", { orderId });
    return channel.ack(msg);
  }

  channel.ack(msg);
  log("info", "Order received in kitchen", { orderId, studentId });

  await notifyAndUpdate(
    orderId,
    studentId,
    "IN_KITCHEN",
    "Your order is being prepared",
  );

  const cookingTime = 3000 + Math.random() * 4000;
  await new Promise((r) => setTimeout(r, cookingTime));
  totalCookingTimeMs += cookingTime;

  processedOrderIds.add(orderId);
  if (processedOrderIds.size > 10000)
    processedOrderIds = new Set(Array.from(processedOrderIds).slice(-5000));
  ordersProcessed++;

  await notifyAndUpdate(
    orderId,
    studentId,
    "READY",
    "Your order is ready for pickup!",
  );
  log("info", "Order completed", {
    orderId,
    cookingTimeMs: Math.round(cookingTime),
  });
}

async function connectRabbitMQ() {
  for (let i = 30; i > 0; i--) {
    try {
      const conn = await amqplib.connect(RABBITMQ_URL);
      const channel = await conn.createChannel();
      await channel.assertQueue(QUEUE_NAME, { durable: true });
      channel.prefetch(5);

      channel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return;
        try {
          await processOrder(msg, channel);
        } catch (err: any) {
          log("error", "Order processing failed", { error: err.message });
          errorCount++;
        }
      });

      rabbitConnected = true;
      log("info", "RabbitMQ consumer connected");

      conn.on("error", () => {
        rabbitConnected = false;
      });
      conn.on("close", () => {
        rabbitConnected = false;
        log("warn", "RabbitMQ closed, reconnecting...");
        setTimeout(connectRabbitMQ, 5000);
      });
      return;
    } catch {
      log("warn", `Waiting for RabbitMQ... (${i - 1} retries left)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  log("error", "Failed to connect to RabbitMQ");
}

(async () => {
  await connectRabbitMQ();
  app.listen(PORT, "0.0.0.0", () =>
    log("info", `Kitchen Service running on port ${PORT}`),
  );
})().catch((err) => {
  log("error", "Failed to start", { error: err.message });
  process.exit(1);
});

export { app };
