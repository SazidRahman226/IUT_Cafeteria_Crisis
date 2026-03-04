/**
 * stress-test.js — Order Gateway Load Tester
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   node stress-test.js                         → GET /api/menu   (5000 req, 50 concurrent)
 *   node stress-test.js menu                    → GET /api/menu
 *   node stress-test.js health                  → GET /health
 *   node stress-test.js orders <jwt>            → GET /api/orders  (requires JWT)
 *   node stress-test.js place-order <jwt>       → POST /api/orders (requires JWT + real itemId)
 *   node stress-test.js revenue                 → GET /api/orders/revenue
 *   node stress-test.js all <jwt>               → Run ALL modes sequentially
 *
 *   node stress-test.js menu 5000 50            → Custom total & concurrency
 *
 * Get a JWT:
 *   POST http://localhost:4001/auth/login  { "username": "...", "password": "..." }
 * ─────────────────────────────────────────────────────────────────────────────
 */

const http = require("http");

// ── CLI Args ──────────────────────────────────────────────────────────────────
const MODE        = process.argv[2] || "menu";
const TOTAL       = parseInt(process.argv[4]) || 5000;
const CONCURRENCY = parseInt(process.argv[5]) || 50;
const JWT_TOKEN   = process.argv[3] || null;

const HOST = "localhost";
const PORT = 8080;

// ── Endpoint Configurations ───────────────────────────────────────────────────
const MODES = {
  menu: {
    path: "/api/menu",
    method: "GET",
    body: null,
    label: "GET /api/menu (proxies stock-service)",
    requiresAuth: false,
  },
  health: {
    path: "/health",
    method: "GET",
    body: null,
    label: "GET /health",
    requiresAuth: false,
  },
  revenue: {
    path: "/api/orders/revenue",
    method: "GET",
    body: null,
    label: "GET /api/orders/revenue",
    requiresAuth: false,
  },
  "order-count": {
    path: "/api/orders/orderCount",
    method: "GET",
    body: null,
    label: "GET /api/orders/orderCount",
    requiresAuth: false,
  },
  orders: {
    path: "/api/orders",
    method: "GET",
    body: null,
    label: "GET /api/orders (student order list)",
    requiresAuth: true,
  },
  "place-order": {
    path: "/api/orders",
    method: "POST",
    // ⚠️  Change itemId to a real one from your DB before running this mode
    body: JSON.stringify({
      items: [{ itemId: "item-001", quantity: 1 }],
    }),
    label: "POST /api/orders (full order flow)",
    requiresAuth: true,
  },
};

// ── State ─────────────────────────────────────────────────────────────────────
let sent = 0, done = 0, finished = false;
const statusCounts = {};
const latencies = [];
const start = Date.now();
let lastPrintAt = Date.now();

// ── Single Request ────────────────────────────────────────────────────────────
function makeRequest(cfg, jwt, cb) {
  const reqStart = Date.now();
  const headers = { "Content-Type": "application/json" };
  if (jwt)      headers["Authorization"]  = `Bearer ${jwt}`;
  if (cfg.body) headers["Content-Length"] = Buffer.byteLength(cfg.body);

  // Use a unique idempotency key per request so POST /api/orders isn't cached
  if (cfg.method === "POST") {
    headers["idempotency-key"] = `stress-${Date.now()}-${Math.random()}`;
  }

  const options = {
    hostname: HOST,
    port: PORT,
    path: cfg.path,
    method: cfg.method,
    headers,
  };

  const req = http.request(options, (res) => {
    res.resume();
    res.on("end", () => {
      const ms = Date.now() - reqStart;
      latencies.push(ms);
      statusCounts[res.statusCode] = (statusCounts[res.statusCode] || 0) + 1;
      cb();
    });
  });

  req.on("error", () => {
    statusCounts["ERR"] = (statusCounts["ERR"] || 0) + 1;
    cb();
  });

  if (cfg.body) req.write(cfg.body);
  req.end();
}

// ── Progress Bar ──────────────────────────────────────────────────────────────
function printProgress() {
  if (finished) return;
  const now = Date.now();
  if (now - lastPrintAt < 500) return;
  lastPrintAt = now;
  const pct  = Math.round((done / TOTAL) * 100);
  const bar  = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
  const rps  = Math.round(done / ((now - start) / 1000)) || 0;
  process.stdout.write(`\r  [${bar}] ${pct}% | ${done}/${TOTAL} | ${rps} req/s   `);
}

// ── Results ───────────────────────────────────────────────────────────────────
function printResults(cfg, resolve) {
  finished = true;
  process.stdout.write("\n"); // clear the progress line
  const elapsed = Date.now() - start;
  const sorted  = [...latencies].sort((a, b) => a - b);

  const p = (pct) => sorted[Math.floor(sorted.length * pct)] || 0;
  const avg = sorted.length
    ? (sorted.reduce((s, v) => s + v, 0) / sorted.length).toFixed(1)
    : "0";

  const success = Object.entries(statusCounts)
    .filter(([k]) => Number(k) >= 200 && Number(k) < 300)
    .reduce((s, [, v]) => s + v, 0);
  const errors = TOTAL - success;
  const rps    = Math.round(TOTAL / (elapsed / 1000));

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║         ORDER GATEWAY STRESS TEST                ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Endpoint    : ${cfg.label.substring(0,34).padEnd(34)}║`);
  console.log(`║  Requests    : ${String(TOTAL).padEnd(34)}║`);
  console.log(`║  Concurrent  : ${String(CONCURRENCY).padEnd(34)}║`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Duration    : ${String(elapsed + "ms").padEnd(34)}║`);
  console.log(`║  Throughput  : ${String(rps + " req/s").padEnd(34)}║`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Avg latency : ${String(avg + "ms").padEnd(34)}║`);
  console.log(`║  p50         : ${String(p(0.50) + "ms").padEnd(34)}║`);
  console.log(`║  p90         : ${String(p(0.90) + "ms").padEnd(34)}║`);
  console.log(`║  p99         : ${String(p(0.99) + "ms").padEnd(34)}║`);
  console.log(`║  Min / Max   : ${String(sorted[0] + "ms / " + sorted[sorted.length - 1] + "ms").padEnd(34)}║`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  ✅ Success   : ${String(success).padEnd(34)}║`);
  console.log(`║  ❌ Errors    : ${String(errors).padEnd(34)}║`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║  Status breakdown:                               ║");
  for (const [code, count] of Object.entries(statusCounts).sort()) {
    const line = `    HTTP ${code}: ${count}`;
    console.log(`║  ${line.padEnd(48)}║`);
  }
  console.log("╚══════════════════════════════════════════════════╝");

  fetchMetrics(resolve);
}

function fetchMetrics(resolve) {
  http.get(`http://${HOST}:${PORT}/metrics/json`, (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      try {
        const m = JSON.parse(data);
        console.log("\n📊 Live gateway metrics after test:");
        console.log(`   Total requests  : ${m.requestCount}`);
        console.log(`   Error count     : ${m.errorCount}`);
        console.log(`   Avg latency     : ${m.avgLatencyMs}ms`);
        console.log(`   Orders processed: ${m.ordersProcessed}`);
        console.log(`   Uptime          : ${m.uptime}s`);
      } catch {}
      if (resolve) resolve();
    });
  }).on("error", () => { if (resolve) resolve(); });
}

// ── Worker Pool ───────────────────────────────────────────────────────────────
function runTest(cfg, jwt) {
  return new Promise((resolve) => {
    sent = 0; done = 0; finished = false;
    Object.keys(statusCounts).forEach((k) => delete statusCounts[k]);
    latencies.length = 0;

    if (cfg.requiresAuth && !jwt) {
      console.log(`\n⚠️  Mode "${MODE}" requires a JWT token.`);
      console.log(`   Usage: node stress-test.js ${MODE} <your-jwt-token>\n`);
      resolve();
      return;
    }

    console.log(`\n🚀 Stress testing Order Gateway on port ${PORT}`);
    console.log(`   ${cfg.label}`);
    console.log(`   ${TOTAL} total requests @ ${CONCURRENCY} concurrent\n`);

    function worker() {
      if (sent >= TOTAL) return;
      sent++;
      makeRequest(cfg, jwt, () => {
        done++;
        printProgress();
        if (done === TOTAL) {
          printResults(cfg, resolve);
        } else {
          worker();
        }
      });
    }

    for (let i = 0; i < Math.min(CONCURRENCY, TOTAL); i++) worker();
  });
}

// ── Entry Point ───────────────────────────────────────────────────────────────
(async () => {
  if (MODE === "all") {
    // Run a gauntlet of all non-destructive modes
    const jwt = JWT_TOKEN;
    const gauntlet = [
      { key: "health",       small: true  },
      { key: "menu",         small: false },
      { key: "revenue",      small: false },
      { key: "order-count",  small: false },
      ...(jwt ? [{ key: "orders", small: false }] : []),
    ];

    for (const { key, small } of gauntlet) {
      const cfg = MODES[key];
      // Override totals for the gauntlet
      const origTotal = TOTAL;
      if (small) {
        // use smaller count for health checks to save time
        global._total = 500;
      } else {
        global._total = origTotal;
      }
      await runTest(cfg, jwt);
      console.log("\n" + "─".repeat(52) + "\n");
    }

    console.log("🏁 Gauntlet complete!\n");
  } else {
    const cfg = MODES[MODE];
    if (!cfg) {
      console.error(`\n❌ Unknown mode: "${MODE}"`);
      console.error(`   Valid modes: ${Object.keys(MODES).join(", ")}, all\n`);
      process.exit(1);
    }
    await runTest(cfg, JWT_TOKEN);
  }
})();
