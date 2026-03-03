import { BASE_HOST, SERVICES } from "../config/constants";
import { MetricsData } from "../types";

export function getServiceUrl(port: number) {
  const svc = SERVICES.find((s) => s.port === port);
  if (svc && svc.url) return svc.url;
  return `http://${BASE_HOST}:${port}`;
}

export function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function parsePrometheusMetrics(
  text: string,
  service: string,
): MetricsData {
  const gv = (n: string) => {
    const m = text.match(new RegExp(`${n}\\{[^}]*\\}\\s+(\\d+\\.?\\d*)`));
    return m ? parseFloat(m[1]) : 0;
  };

  return {
    service,
    requestCount: gv("requests_total"),
    errorCount: gv("errors_total"),
    avgLatencyMs: gv("avg_latency_ms"),
    ordersProcessed: gv("orders_processed_total"),
    uptime: gv("uptime_seconds"),
  };
}
