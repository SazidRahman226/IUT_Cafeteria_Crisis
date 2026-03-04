/**
 * stress-test.js — Stock Service Load Tester
 * Usage:
 *   node stress-test.js               (GET /stock, 5000 reqs, 50 concurrent)
 *   node stress-test.js reserve       (POST /stock/reserve)
 *   node stress-test.js health 100 10 (GET /health, 100 reqs, 10 concurrent)
 *
 * Args: [endpoint] [total=5000] [concurrency=50] [jwt=<token>]
 */

const http = require("http");

// ── Config ────────────────────────────────────────────────────────────────────
const MODE        = process.argv[2] || "stock";   // 'stock' | 'reserve' | 'health'
const TOTAL       = parseInt(process.argv[3]) || 5000;
const CONCURRENCY = parseInt(process.argv[4]) || 50;
const JWT_TOKEN   = process.argv[5] || null;       // Pass a Bearer token if needed

const HOST = "localhost";
const PORT = 4002;

// Per-mode settings
const MODES = {
  stock: {
    path: "/stock",
    method: "GET",
    body: null,
    label: "GET /stock (inventory list)",
  },
  health: {
    path: "/health",
    method: "GET",
    body: null,
    label: "GET /health",
  },
  reserve: {
    path: "/stock/reserve",
    method: "POST",
    // Change itemId to a real item ID from your DB
    body: JSON.stringify({ itemId: "item-001", quantity: 1 }),
    label: "POST /stock/reserve",
  },
};

const cfg = MODES[MODE] || MODES.stock;

// ── State ─────────────────────────────────────────────────────────────────────
let sent = 0, done = 0;
const statusCounts = {};
const latencies = [];
const start = Date.now();
let lastPrintAt = Date.now();

// ── Request ───────────────────────────────────────────────────────────────────
function makeRequest(cb) {
  const reqStart = Date.now();
  const headers = { "Content-Type": "application/json" };
  if (JWT_TOKEN) headers["Authorization"] = `Bearer ${JWT_TOKEN}`;
  if (cfg.body)  headers["Content-Length"] = Buffer.byteLength(cfg.body);

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

// ── Progress printer ──────────────────────────────────────────────────────────
function printProgress() {
  const now = Date.now();
  if (now - lastPrintAt < 500) return;
  lastPrintAt = now;
  const pct = Math.round((done / TOTAL) * 100);
  const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
  const rps = Math.round(done / ((now - start) / 1000));
  process.stdout.write(`\r  [${bar}] ${pct}% | ${done}/${TOTAL} | ${rps} req/s   `);
}

// ── Worker ────────────────────────────────────────────────────────────────────
function worker() {
  if (sent >= TOTAL) return;
  sent++;
  makeRequest(() => {
    done++;
    printProgress();

    if (done === TOTAL) {
      printResults();
    } else {
      worker();
    }
  });
}

// ── Results ───────────────────────────────────────────────────────────────────
function printResults() {
  const elapsed = Date.now() - start;
  latencies.sort((a, b) => a - b);

  const avg  = (latencies.reduce((s, v) => s + v, 0) / latencies.length).toFixed(1);
  const p50  = latencies[Math.floor(latencies.length * 0.50)];
  const p90  = latencies[Math.floor(latencies.length * 0.90)];
  const p99  = latencies[Math.floor(latencies.length * 0.99)];
  const min  = latencies[0];
  const max  = latencies[latencies.length - 1];
  const rps  = Math.round(TOTAL / (elapsed / 1000));

  const success = Object.entries(statusCounts)
    .filter(([k]) => k >= 200 && k < 300)
    .reduce((s, [, v]) => s + v, 0);
  const errors = TOTAL - success;

  console.log("\n");
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║         STOCK SERVICE STRESS TEST            ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Endpoint  : ${cfg.label.padEnd(31)}║`);
  console.log(`║  Requests  : ${String(TOTAL).padEnd(31)}║`);
  console.log(`║  Concurrent: ${String(CONCURRENCY).padEnd(31)}║`);
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Duration  : ${String(elapsed + "ms").padEnd(31)}║`);
  console.log(`║  Throughput: ${String(rps + " req/s").padEnd(31)}║`);
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Avg latency : ${String(avg + "ms").padEnd(29)}║`);
  console.log(`║  Min/Max     : ${String(min + "ms / " + max + "ms").padEnd(29)}║`);
  console.log(`║  p50/p90/p99 : ${String(p50 + "ms / " + p90 + "ms / " + p99 + "ms").padEnd(29)}║`);
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  ✅ Success  : ${String(success).padEnd(30)}║`);
  console.log(`║  ❌ Errors   : ${String(errors).padEnd(30)}║`);
  console.log("╠══════════════════════════════════════════════╣");
  console.log("║  Status breakdown:                           ║");
  for (const [code, count] of Object.entries(statusCounts)) {
    const line = `    HTTP ${code}: ${count}`;
    console.log(`║  ${line.padEnd(44)}║`);
  }
  console.log("╚══════════════════════════════════════════════╝");
  console.log();

  // Also print current service metrics
  fetchMetrics();
}

function fetchMetrics() {
  http.get(`http://${HOST}:${PORT}/metrics/json`, (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      try {
        const m = JSON.parse(data);
        console.log("📊 Live service metrics after test:");
        console.log(`   Total requests seen : ${m.requestCount}`);
        console.log(`   Error count         : ${m.errorCount}`);
        console.log(`   Avg latency (svc)   : ${m.avgLatencyMs}ms`);
        console.log(`   Orders processed    : ${m.ordersProcessed}`);
        console.log(`   Uptime              : ${m.uptime}s`);
      } catch {}
    });
  }).on("error", () => {});
}

// ── Run ───────────────────────────────────────────────────────────────────────
console.log(`\n🚀 Stress testing stock-service on port ${PORT}`);
console.log(`   Mode: ${cfg.label}`);
console.log(`   ${TOTAL} total requests @ ${CONCURRENCY} concurrent\n`);

for (let i = 0; i < CONCURRENCY; i++) worker();
