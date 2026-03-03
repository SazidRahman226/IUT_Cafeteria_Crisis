export const BASE_HOST = window.location.hostname || "localhost";
export const PORT = window.location.port;
export const NO_PORT = PORT === "80" || PORT === "";
export const IS_LOCAL = window.location.hostname === "localhost";
export const API_BASE = IS_LOCAL && PORT === "3000" ? "" : "";

export const GATEWAY_URL =
  API_BASE ||
  (NO_PORT
    ? `${window.location.protocol}//${window.location.hostname}:8080`
    : "http://localhost:8080");

export const AUTH_URL =
  API_BASE ||
  (NO_PORT
    ? `${window.location.protocol}//${window.location.hostname}:4001`
    : "http://localhost:4001");

export const WS_URL = NO_PORT
  ? `ws://${window.location.hostname}:4005/ws`
  : "ws://localhost:4005/ws";

export const STOCK_URL = NO_PORT
  ? `${window.location.protocol}//${window.location.hostname}:4002`
  : "http://localhost:4002";

export const SERVICES = [
  {
    name: "Identity Provider",
    key: "identity-provider",
    port: 4001,
    color: "#3b82f6",
  },
  {
    name: "Order Gateway",
    key: "order-gateway",
    port: 8080,
    color: "#8b5cf6",
  },
  {
    name: "Stock Service",
    key: "stock-service",
    port: 4002,
    color: "#10b981",
  },
  {
    name: "Kitchen Service",
    key: "kitchen-service",
    port: 4003,
    color: "#f59e0b",
  },
  {
    name: "Notification Hub",
    key: "notification-hub",
    port: 4005,
    color: "#ec4899",
  },
];
