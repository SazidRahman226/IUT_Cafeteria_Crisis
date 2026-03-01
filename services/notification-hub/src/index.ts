import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";

const PORT = parseInt(process.env.PORT || "4005");
const JWT_SECRET = process.env.JWT_SECRET || "devsprint-2026-secret-key";

let requestCount = 0,
  errorCount = 0,
  totalLatency = 0,
  notificationsSent = 0,
  totalClients = 0;
const latencies: number[] = [];
const startTime = Date.now();
const clients = new Map<string, Set<WebSocket>>();

const log = (level: string, message: string, meta?: any) =>
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "notification-hub",
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

function addClient(studentId: string, ws: WebSocket) {
  if (!clients.has(studentId)) clients.set(studentId, new Set());
  clients.get(studentId)!.add(ws);
  totalClients++;
  log("info", "Client connected", { studentId, totalClients });
}

function removeClient(studentId: string, ws: WebSocket) {
  const studentClients = clients.get(studentId);
  if (studentClients?.has(ws)) {
    studentClients.delete(ws);
    totalClients--;
    if (studentClients.size === 0) clients.delete(studentId);
    log("info", "Client disconnected", { studentId, totalClients });
  }
}

function sendToStudent(studentId: string, data: any) {
  const studentClients = clients.get(studentId);
  if (!studentClients || studentClients.size === 0) return 0;

  let sent = 0;
  const msg = JSON.stringify(data);
  for (const ws of studentClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
      sent++;
    }
  }
  return sent;
}

const app = express();
app.use(cors());
app.use(express.json());

app.use((_, res, next) => {
  const start = Date.now();
  res.on("finish", () =>
    recordRequest(Date.now() - start, res.statusCode >= 500),
  );
  next();
});

app.get("/", (_, res) =>
  res.send(
    `<html><head><title>Notification Hub</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:16px;max-width:500px;box-shadow:0 4px 30px rgba(0,0,0,.3)}h1{color:#f472b6;margin-top:0}a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}code{background:#334155;padding:2px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>🔔 Notification Hub</h1><p>Real-time WebSocket notifications</p><p><b>Endpoints:</b></p><ul><li><a href="/health">/health</a></li><li><a href="/metrics">/metrics</a></li><li><code>POST /notify</code></li><li><code>POST /broadcast</code></li><li><code>ws://localhost:4005/ws</code></li></ul><p style="color:#64748b;font-size:12px">DevSprint 2026</p></div></body></html>`,
  ),
);

app.post("/notify", (req, res) => {
  const { orderId, studentId, status, timestamp, message } = req.body;
  if (!orderId || !studentId || !status)
    return res
      .status(400)
      .json({ error: { code: "VALIDATION_ERROR", message: "Missing fields" } });

  const sent = sendToStudent(studentId, {
    type: "ORDER_STATUS_UPDATE",
    orderId,
    studentId,
    status,
    timestamp: timestamp || new Date().toISOString(),
    message: message || `Order status: ${status}`,
  });
  notificationsSent++;

  log("info", "Notification sent", {
    orderId,
    studentId,
    status,
    clientsNotified: sent,
  });
  res.json({ sent, orderId, status });
});

app.post("/broadcast", (req, res) => {
  const msgStr = JSON.stringify({
    type: req.body.type || "SYSTEM_MESSAGE",
    message: req.body.message,
    timestamp: new Date().toISOString(),
  });
  let sent = 0;
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msgStr);
      sent++;
    }
  });
  res.json({ sent });
});

app.get("/health", (_, res) => {
  const wsOk = !!wss?.clients;
  res
    .status(wsOk ? 200 : 503)
    .json({
      status: wsOk ? "ok" : "down",
      service: "notification-hub",
      timestamp: new Date().toISOString(),
      uptime: uptime(),
      dependencies: {
        websocket: {
          status: wsOk ? "ok" : "down",
          connectedClients: totalClients,
        },
      },
    });
});

app.get("/metrics", (_, res) =>
  res
    .set("Content-Type", "text/plain")
    .send(
      `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="notification-hub"} ${requestCount}\n` +
        `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="notification-hub"} ${errorCount}\n` +
        `# HELP avg_latency_ms Average latency\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="notification-hub"} ${Math.round(getAvgLatency() * 100) / 100}\n` +
        `# HELP notifications_sent_total Notifications sent\n# TYPE notifications_sent_total counter\nnotifications_sent_total{service="notification-hub"} ${notificationsSent}\n` +
        `# HELP connected_clients Connected WS clients\n# TYPE connected_clients gauge\nconnected_clients{service="notification-hub"} ${totalClients}\n` +
        `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="notification-hub"} ${uptime()}\n`,
    ),
);

app.get("/metrics/json", (_, res) =>
  res.json({
    service: "notification-hub",
    requestCount,
    errorCount,
    avgLatencyMs: Math.round(getAvgLatency() * 100) / 100,
    notificationsSent,
    connectedClients: totalClients,
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
    log("warn", "CHAOS: Notification hub kill triggered");
    res.json({ message: "Service shutting down..." });
    setTimeout(() => process.exit(1), 500);
  } catch {
    res
      .status(401)
      .json({ error: { code: "UNAUTHORIZED", message: "Invalid token" } });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const token = new URL(
    req.url || "/",
    `http://${req.headers.host}`,
  ).searchParams.get("token");
  if (!token) {
    ws.send(
      JSON.stringify({ type: "ERROR", message: "Authentication required" }),
    );
    return ws.close(4001, "No token provided");
  }
  try {
    const studentId = (jwt.verify(token, JWT_SECRET) as any).sub;
    addClient(studentId, ws);

    ws.send(
      JSON.stringify({
        type: "CONNECTED",
        studentId,
        message: "Connected to notification hub",
        timestamp: new Date().toISOString(),
      }),
    );

    ws.on("close", () => removeClient(studentId, ws));
    ws.on("error", () => removeClient(studentId, ws));
    ws.on("pong", () => {});
  } catch {
    ws.send(
      JSON.stringify({ type: "ERROR", message: "Invalid or expired token" }),
    );
    ws.close(4001, "Invalid token");
  }
});

setInterval(
  () =>
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }),
  30000,
);

server.listen(PORT, "0.0.0.0", () =>
  log("info", `Notification Hub running on port ${PORT}`),
);

export { app, server };
