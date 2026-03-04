/**
 * stress-chart.js — IUT Cafeteria Crisis Load Tester + HTML Chart Reporter
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs 5000 requests against a service endpoint, then generates a beautiful
 * self-contained HTML report with interactive Chart.js charts.
 *
 * Usage (from project root):
 *   node stress-chart.js                          → stock GET /stock
 *   node stress-chart.js stock                    → stock GET /stock
 *   node stress-chart.js gateway                  → gateway GET /api/menu
 *   node stress-chart.js stock   5000 50          → custom total/concurrency
 *   node stress-chart.js gateway 5000 50 <jwt>    → gateway with auth
 *   node stress-chart.js both                     → run stock + gateway, compare
 *
 * Output: stress-report.html  (opens automatically in browser if possible)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");
const { exec } = require("child_process");

// ── CLI ───────────────────────────────────────────────────────────────────────
const TARGET      = process.argv[2] || "stock";
const TOTAL       = parseInt(process.argv[3]) || 5000;
const CONCURRENCY = parseInt(process.argv[4]) || 50;
const JWT_TOKEN   = process.argv[5] || null;
const OUT_FILE    = path.join(__dirname, "stress-report.html");

// ── Endpoints ─────────────────────────────────────────────────────────────────
const TARGETS = {
  stock: {
    host: "localhost", port: 4002,
    path: "/stock", method: "GET", body: null,
    label: "Stock Service — GET /stock",
    color: "#34d399",
  },
  gateway: {
    host: "localhost", port: 8080,
    path: "/api/menu", method: "GET", body: null,
    label: "Order Gateway — GET /api/menu",
    color: "#a78bfa",
  },
  "gateway-health": {
    host: "localhost", port: 8080,
    path: "/health", method: "GET", body: null,
    label: "Order Gateway — GET /health",
    color: "#38bdf8",
  },
  "stock-health": {
    host: "localhost", port: 4002,
    path: "/health", method: "GET", body: null,
    label: "Stock Service — GET /health",
    color: "#fb923c",
  },
};

// ── Runner ────────────────────────────────────────────────────────────────────
function runTest(targetKey, jwt) {
  const cfg = TARGETS[targetKey];
  if (!cfg) {
    console.error(`\n❌ Unknown target: "${targetKey}". Valid: ${Object.keys(TARGETS).join(", ")}, both\n`);
    process.exit(1);
  }

  return new Promise((resolve) => {
    console.log(`\n🚀 Testing: ${cfg.label}`);
    console.log(`   ${TOTAL} requests @ ${CONCURRENCY} concurrent\n`);

    const testStart = Date.now();
    let sent = 0, done = 0;
    let lastPrint = Date.now(), finished = false;

    // Per-request data: [timestampMs, latencyMs, statusCode]
    const samples = [];

    function makeReq() {
      if (sent >= TOTAL) return;
      sent++;
      const headers = { "Content-Type": "application/json" };
      if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
      if (cfg.body) headers["Content-Length"] = Buffer.byteLength(cfg.body);

      const t0 = Date.now();
      const req = http.request(
        { hostname: cfg.host, port: cfg.port, path: cfg.path, method: cfg.method, headers },
        (res) => {
          res.resume();
          res.on("end", () => {
            samples.push([t0 - testStart, Date.now() - t0, res.statusCode]);
            tick();
          });
        }
      );
      req.on("error", () => {
        samples.push([Date.now() - testStart, Date.now() - t0, 0]);
        tick();
      });
      if (cfg.body) req.write(cfg.body);
      req.end();
    }

    function tick() {
      done++;
      // Progress bar
      if (!finished) {
        const now = Date.now();
        if (now - lastPrint >= 400) {
          lastPrint = now;
          const pct = Math.round((done / TOTAL) * 100);
          const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
          const rps = Math.round(done / ((now - testStart) / 1000)) || 0;
          process.stdout.write(`\r  [${bar}] ${pct}% | ${done}/${TOTAL} | ${rps} req/s    `);
        }
      }
      if (done === TOTAL) {
        finished = true;
        process.stdout.write("\n");
        resolve(buildResult(cfg, testStart, samples));
      } else {
        makeReq();
      }
    }

    for (let i = 0; i < Math.min(CONCURRENCY, TOTAL); i++) makeReq();
  });
}

// ── Compute Summary ───────────────────────────────────────────────────────────
function buildResult(cfg, testStart, samples) {
  const elapsed  = Date.now() - testStart;
  const lats     = samples.map((s) => s[1]).sort((a, b) => a - b);
  const statuses = {};
  samples.forEach(([, , code]) => { statuses[code] = (statuses[code] || 0) + 1; });

  const p = (pct) => lats[Math.max(0, Math.floor(lats.length * pct) - 1)] || 0;
  const avg = lats.reduce((s, v) => s + v, 0) / (lats.length || 1);
  const success = samples.filter((s) => s[2] >= 200 && s[2] < 300).length;

  // Timeline: bucket into 100ms windows → [windowMs, avgLatMs, count]
  const windowMs = Math.max(50, Math.round(elapsed / 100));
  const windows  = {};
  samples.forEach(([ts, lat]) => {
    const w = Math.floor(ts / windowMs) * windowMs;
    if (!windows[w]) windows[w] = { total: 0, count: 0 };
    windows[w].total += lat;
    windows[w].count++;
  });
  const timeline = Object.entries(windows)
    .sort((a, b) => a[0] - b[0])
    .map(([w, v]) => ({ t: parseInt(w), avgLat: +(v.total / v.count).toFixed(1), rps: Math.round(v.count / (windowMs / 1000)) }));

  // Histogram: buckets of ~10ms
  const bucketSize = Math.max(5, Math.round((lats[lats.length - 1] || 100) / 20));
  const hist = {};
  lats.forEach((l) => {
    const b = Math.floor(l / bucketSize) * bucketSize;
    hist[b] = (hist[b] || 0) + 1;
  });

  return {
    label:    cfg.label,
    color:    cfg.color,
    total:    TOTAL,
    concurrency: CONCURRENCY,
    elapsed,
    rps:      Math.round(TOTAL / (elapsed / 1000)),
    success,
    errors:   TOTAL - success,
    statuses,
    avg:      +avg.toFixed(1),
    min:      lats[0]  || 0,
    max:      lats[lats.length - 1] || 0,
    p50:      p(0.50),
    p90:      p(0.90),
    p99:      p(0.99),
    timeline,
    hist: Object.entries(hist).sort((a, b) => a[0] - b[0]).map(([b, c]) => ({ bucket: parseInt(b), count: c })),
  };
}

// ── HTML Generator ────────────────────────────────────────────────────────────
function generateHTML(results) {
  const colors = results.map((r) => r.color);

  const statCard = (r) => `
    <div class="card stat-grid">
      <div class="card-title">${r.label}</div>
      <div class="stats">
        <div class="stat"><span class="val">${r.rps.toLocaleString()}</span><span class="key">req/s</span></div>
        <div class="stat"><span class="val">${(r.elapsed/1000).toFixed(2)}s</span><span class="key">duration</span></div>
        <div class="stat"><span class="val" style="color:#34d399">${r.success.toLocaleString()}</span><span class="key">success</span></div>
        <div class="stat"><span class="val" style="color:${r.errors>0?'#f87171':'#34d399'}">${r.errors}</span><span class="key">errors</span></div>
        <div class="stat"><span class="val">${r.avg}ms</span><span class="key">avg lat</span></div>
        <div class="stat"><span class="val">${r.p50}ms</span><span class="key">p50</span></div>
        <div class="stat"><span class="val">${r.p90}ms</span><span class="key">p90</span></div>
        <div class="stat"><span class="val">${r.p99}ms</span><span class="key">p99</span></div>
        <div class="stat"><span class="val">${r.min}ms</span><span class="key">min</span></div>
        <div class="stat"><span class="val">${r.max}ms</span><span class="key">max</span></div>
      </div>
    </div>`;

  const timelineDatasets = results.map((r, i) => ({
    label: r.label + " (avg ms)",
    data: r.timeline.map((p) => ({ x: p.t, y: p.avgLat })),
    borderColor: colors[i],
    backgroundColor: colors[i] + "22",
    fill: true,
    tension: 0.3,
    pointRadius: 2,
  }));

  const rpsDatasets = results.map((r, i) => ({
    label: r.label + " (req/s)",
    data: r.timeline.map((p) => ({ x: p.t, y: p.rps })),
    borderColor: colors[i],
    backgroundColor: colors[i] + "33",
    fill: true,
    tension: 0.3,
    pointRadius: 2,
  }));

  const histCharts = results.map((r, i) => `
    <div class="card">
      <div class="card-title">Latency Histogram — ${r.label}</div>
      <canvas id="hist${i}" height="140"></canvas>
    </div>`).join("");

  const histScripts = results.map((r, i) => `
    new Chart(document.getElementById("hist${i}"), {
      type: "bar",
      data: {
        labels: ${JSON.stringify(r.hist.map((h) => h.bucket + "ms"))},
        datasets: [{
          label: "Requests",
          data: ${JSON.stringify(r.hist.map((h) => h.count))},
          backgroundColor: "${r.color}99",
          borderColor: "${r.color}",
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 12 }, grid: { color: "#1e293b" } },
          y: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } }
        }
      }
    });`).join("\n");

  const statusCharts = results.map((r, i) => {
    const codes  = Object.keys(r.statuses);
    const counts = codes.map((c) => r.statuses[c]);
    const palettes = ["#34d399","#a78bfa","#38bdf8","#f87171","#fb923c","#fbbf24","#64748b"];
    const bgColors = codes.map((c, j) => c >= 200 && c < 300 ? "#34d399" : c >= 400 ? "#f87171" : palettes[j % palettes.length]);
    return `
    <div class="card donut-card">
      <div class="card-title">Status Codes — ${r.label}</div>
      <canvas id="status${i}" height="160"></canvas>
    </div>
    <script>
    new Chart(document.getElementById("status${i}"), {
      type: "doughnut",
      data: {
        labels: ${JSON.stringify(codes.map((c) => "HTTP " + (c || "ERR")))},
        datasets: [{ data: ${JSON.stringify(counts)}, backgroundColor: ${JSON.stringify(bgColors)}, borderWidth: 2, borderColor: "#0f172a" }]
      },
      options: {
        responsive: true,
        cutout: "65%",
        plugins: {
          legend: { position: "bottom", labels: { color: "#94a3b8", padding: 12 } },
          tooltip: { callbacks: { label: (ctx) => ctx.label + ": " + ctx.parsed.toLocaleString() } }
        }
      }
    });
    </script>`;
  }).join("\n");

  const now = new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stress Test Report — IUT Cafeteria Crisis</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0a0f1e;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 32px 24px;
    }
    header {
      text-align: center;
      margin-bottom: 40px;
    }
    header h1 {
      font-size: 2rem;
      font-weight: 700;
      background: linear-gradient(135deg, #34d399, #a78bfa, #38bdf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 8px;
    }
    header p { color: #64748b; font-size: 0.9rem; }
    .badge {
      display: inline-block;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 99px;
      padding: 4px 14px;
      font-size: 0.78rem;
      color: #94a3b8;
      margin: 4px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .card {
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    .card-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 16px;
    }
    .stat-grid .stats {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 16px;
    }
    .stat {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 14px 10px;
      text-align: center;
    }
    .stat .val {
      display: block;
      font-size: 1.4rem;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 4px;
    }
    .stat .key {
      font-size: 0.72rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .donut-card { display: flex; flex-direction: column; align-items: center; }
    .donut-card canvas { max-width: 320px; }
    canvas { max-width: 100%; }
    @media (max-width: 720px) { .grid-2 { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<div class="container">
  <header>
    <h1>🚀 Stress Test Report</h1>
    <p>IUT Cafeteria Crisis — DevSprint 2026</p>
    <br>
    <span class="badge">📅 ${now}</span>
    <span class="badge">🔢 ${TOTAL.toLocaleString()} requests</span>
    <span class="badge">⚡ ${CONCURRENCY} concurrent</span>
    ${results.map((r) => `<span class="badge" style="color:${r.color}">${r.label}</span>`).join("")}
  </header>

  ${results.map((r) => statCard(r)).join("\n")}

  <div class="card">
    <div class="card-title">⏱ Latency Over Time (ms)</div>
    <canvas id="timeline" height="120"></canvas>
  </div>

  <div class="card">
    <div class="card-title">⚡ Throughput Over Time (req/s)</div>
    <canvas id="rps" height="120"></canvas>
  </div>

  ${histCharts}

  <div class="grid-2">
    ${statusCharts}
  </div>
</div>

<script>
Chart.defaults.color = "#94a3b8";
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";

// ── Timeline Chart ────────────────────────────────────────────────────────────
new Chart(document.getElementById("timeline"), {
  type: "line",
  data: { datasets: ${JSON.stringify(timelineDatasets)} },
  options: {
    responsive: true,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: "#94a3b8" } },
      tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y + "ms" } }
    },
    scales: {
      x: {
        type: "linear",
        title: { display: true, text: "Time (ms into test)", color: "#64748b" },
        ticks: { color: "#94a3b8" },
        grid: { color: "#1e293b" }
      },
      y: {
        title: { display: true, text: "Avg Latency (ms)", color: "#64748b" },
        ticks: { color: "#94a3b8" },
        grid: { color: "#1e293b" }
      }
    }
  }
});

// ── RPS Chart ─────────────────────────────────────────────────────────────────
new Chart(document.getElementById("rps"), {
  type: "line",
  data: { datasets: ${JSON.stringify(rpsDatasets)} },
  options: {
    responsive: true,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { labels: { color: "#94a3b8" } } },
    scales: {
      x: {
        type: "linear",
        title: { display: true, text: "Time (ms into test)", color: "#64748b" },
        ticks: { color: "#94a3b8" },
        grid: { color: "#1e293b" }
      },
      y: {
        title: { display: true, text: "Requests / second", color: "#64748b" },
        ticks: { color: "#94a3b8" },
        grid: { color: "#1e293b" }
      }
    }
  }
});

// ── Histogram Charts ──────────────────────────────────────────────────────────
${histScripts}
</script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  let results = [];

  if (TARGET === "both") {
    results.push(await runTest("stock",   JWT_TOKEN));
    results.push(await runTest("gateway", JWT_TOKEN));
  } else {
    const key = TARGETS[TARGET] ? TARGET : "stock";
    results.push(await runTest(key, JWT_TOKEN));
  }

  // Print quick summary to console
  console.log("\n📊 Results Summary:");
  results.forEach((r) => {
    console.log(`\n  ${r.label}`);
    console.log(`    Throughput : ${r.rps} req/s  |  Duration: ${(r.elapsed/1000).toFixed(2)}s`);
    console.log(`    Latency    : avg ${r.avg}ms  |  p50 ${r.p50}ms  |  p90 ${r.p90}ms  |  p99 ${r.p99}ms`);
    console.log(`    Success    : ${r.success}/${r.total}  |  Errors: ${r.errors}`);
  });

  // Write HTML
  const html = generateHTML(results);
  fs.writeFileSync(OUT_FILE, html, "utf-8");
  console.log(`\n✅ Report saved → ${OUT_FILE}`);

  // Try to open in browser
  const opener =
    process.platform === "win32"  ? `start "" "${OUT_FILE}"` :
    process.platform === "darwin" ? `open "${OUT_FILE}"`      :
                                    `xdg-open "${OUT_FILE}"`;
  exec(opener, (err) => {
    if (!err) console.log("🌐 Opened in browser!\n");
    else       console.log("   Open stress-report.html in your browser to view the charts.\n");
  });
})();
