import express from "express";
import cors from "cors";
import jwt, { SignOptions } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";

const PORT = parseInt(process.env.PORT || "4001");
const JWT_SECRET = process.env.JWT_SECRET || "devsprint-2026-secret-key";
const JWT_EXPIRY = (process.env.JWT_EXPIRY ||
  "24h") as SignOptions["expiresIn"];

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "cafeteria_auth",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

let requestCount = 0,
  errorCount = 0,
  totalLatency = 0,
  latencies: number[] = [];
const startTime = Date.now();

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

app.get("/", (_, res) =>
  res.send(
    `<html><head><title>Identity Provider</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:16px;max-width:500px;box-shadow:0 4px 30px rgba(0,0,0,.3)}h1{color:#38bdf8;margin-top:0}a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}code{background:#334155;padding:2px 8px;border-radius:4px;font-size:14px}</style></head><body><div><h1>🔐 Identity Provider</h1><p>Authentication service for IUT Cafeteria</p><p><b>Endpoints:</b></p><ul><li><a href="/health">/health</a></li><li><a href="/metrics">/metrics</a></li><li><code>POST /auth/login</code></li><li><code>POST /auth/register</code></li><li><code>POST /auth/verify</code></li></ul><p style="color:#64748b;font-size:12px">DevSprint 2026</p></div></body></html>`,
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

const loginLimiter = rateLimit({
  windowMs: 60000,
  max: 3,
  keyGenerator: (req) => req.body?.studentId || req.ip || "unknown",
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many login attempts. Try again in 1 minute.",
      traceId: "",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const log = (level: string, message: string, meta?: any) =>
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "identity-provider",
      message,
      ...meta,
    }),
  );

app.post("/auth/login", loginLimiter, async (req, res) => {
  const { studentId, password } = req.body;
  const traceId = (req as any).requestId;

  if (!studentId || !password) {
    return res
      .status(400)
      .json({
        error: {
          code: "VALIDATION_ERROR",
          message: "studentId and password required",
          traceId,
        },
      });
  }

  try {
    const { rows } = await pool.query(
      "SELECT student_id, name, password_hash, role FROM users WHERE student_id = $1",
      [studentId],
    );

    if (
      !rows.length ||
      !(await bcrypt.compare(password, rows[0].password_hash))
    ) {
      return res
        .status(401)
        .json({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid credentials",
            traceId,
          },
        });
    }

    const user = rows[0];
    const accessToken = jwt.sign(
      { sub: user.student_id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY },
    );
    const refreshToken = jwt.sign(
      { sub: user.student_id, role: user.role, type: "refresh" },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    log("info", "Login successful", { studentId, traceId });
    res.json({
      accessToken,
      refreshToken,
      user: { studentId: user.student_id, name: user.name, role: user.role },
    });
  } catch (err: any) {
    log("error", "Login error", { error: err.message, traceId });
    res
      .status(500)
      .json({
        error: { code: "INTERNAL_ERROR", message: "Auth error", traceId },
      });
  }
});

app.post("/auth/register", async (req, res) => {
  const { studentId, name, password, role } = req.body;
  const traceId = (req as any).requestId;

  if (!studentId || !name || !password) {
    return res
      .status(400)
      .json({
        error: { code: "VALIDATION_ERROR", message: "Missing fields", traceId },
      });
  }

  try {
    await pool.query(
      "INSERT INTO users (student_id, name, password_hash, role) VALUES ($1, $2, $3, $4)",
      [studentId, name, await bcrypt.hash(password, 10), role || "student"],
    );
    log("info", "User registered", { studentId, traceId });
    res.status(201).json({ message: "User registered", studentId });
  } catch (err: any) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({
          error: { code: "USER_EXISTS", message: "Student ID exists", traceId },
        });
    log("error", "Register error", { error: err.message, traceId });
    res
      .status(500)
      .json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Registration failed",
          traceId,
        },
      });
  }
});

app.get("/auth/verify", (req, res) => {
  const auth = req.headers.authorization;
  const traceId = (req as any).requestId;

  if (!auth?.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({
        error: { code: "UNAUTHORIZED", message: "Missing token", traceId },
      });
  }

  try {
    res.json({
      valid: true,
      claims: jwt.verify(auth.split(" ")[1], JWT_SECRET),
    });
  } catch {
    res
      .status(401)
      .json({
        error: { code: "UNAUTHORIZED", message: "Invalid token", traceId },
      });
  }
});

app.get("/health", async (_, res) => {
  try {
    const start = Date.now();
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      service: "identity-provider",
      timestamp: new Date().toISOString(),
      uptime: uptime(),
      dependencies: { postgres: { status: "ok", latency: Date.now() - start } },
    });
  } catch {
    res
      .status(503)
      .json({
        status: "down",
        service: "identity-provider",
        timestamp: new Date().toISOString(),
        uptime: uptime(),
        dependencies: { postgres: { status: "down" } },
      });
  }
});

app.get("/metrics", (_, res) => {
  res
    .set("Content-Type", "text/plain")
    .send(
      `# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{service="identity-provider"} ${requestCount}\n` +
        `# HELP errors_total Total errors\n# TYPE errors_total counter\nerrors_total{service="identity-provider"} ${errorCount}\n` +
        `# HELP avg_latency_ms Average latency\n# TYPE avg_latency_ms gauge\navg_latency_ms{service="identity-provider"} ${Math.round(getAvgLatency() * 100) / 100}\n` +
        `# HELP uptime_seconds Service uptime\n# TYPE uptime_seconds gauge\nuptime_seconds{service="identity-provider"} ${uptime()}\n`,
    );
});

app.get("/metrics/json", (_, res) => {
  res.json({
    service: "identity-provider",
    requestCount,
    errorCount,
    avgLatencyMs: Math.round(getAvgLatency() * 100) / 100,
    uptime: uptime(),
  });
});

app.post("/chaos/kill", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return res
      .status(401)
      .json({ error: { code: "UNAUTHORIZED", message: "Missing token" } });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], JWT_SECRET) as any;
    if (decoded.role !== "admin")
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
      log("warn", `Waiting for database... (${i - 1} retries left)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (i === 1) {
      log("error", "Failed to connect to database");
      process.exit(1);
    }
  }
  app.listen(PORT, "0.0.0.0", () =>
    log("info", `Identity Provider running on port ${PORT}`),
  );
})().catch((err) => {
  log("error", "Failed to start", { error: err.message });
  process.exit(1);
});

export { app };
