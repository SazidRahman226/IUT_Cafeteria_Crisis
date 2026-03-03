export const BASE_HOST = window.location.hostname || "localhost";

export const GATEWAY_URL =
  import.meta.env.VITE_ORDER_API_URL || "http://localhost:8080";
export const AUTH_URL =
  import.meta.env.VITE_IDENTITY_API_URL || "http://localhost:4001";
export const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4005/ws";
export const STOCK_URL =
  import.meta.env.VITE_STOCK_API_URL || "http://localhost:4002";

export const SERVICES = [
  {
    name: "Identity Provider",
    key: "identity-provider",
    port: 4001,
    url: import.meta.env.VITE_IDENTITY_API_URL,
    color: "#3b82f6",
  },
  {
    name: "Order Gateway",
    key: "order-gateway",
    port: 8080,
    url: import.meta.env.VITE_ORDER_API_URL,
    color: "#8b5cf6",
  },
  {
    name: "Stock Service",
    key: "stock-service",
    port: 4002,
    url: import.meta.env.VITE_STOCK_API_URL,
    color: "#10b981",
  },
  {
    name: "Kitchen Service",
    key: "kitchen-service",
    port: 4003,
    url: import.meta.env.VITE_KITCHEN_API_URL,
    color: "#f59e0b",
  },
  {
    name: "Notification Hub",
    key: "notification-hub",
    port: 4005,
    url: import.meta.env.VITE_NOTIFICATION_API_URL,
    color: "#ec4899",
  },
];
