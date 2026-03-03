export interface User {
  studentId: string;
  name: string;
  role: string;
}

export interface MenuItem {
  itemId: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string;
  availableQty: number;
  isEnabled?: boolean;
  disabledReason?: string;
}

export interface Order {
  orderId: string;
  studentId: string;
  items: Array<{
    itemId: string;
    name: string;
    quantity: number;
    price: number;
  }>;
  totalAmount: number;
  status: string;
  createdAt: string;
  otp?: string;
  otpExpiresAt?: string;
  revenueAmount?: number;
  deliveredAt?: string;
}

export interface CartItem extends MenuItem {
  quantity: number;
}

export type StudentScreen = "menu" | "orders";
export type KitchenPage = "orders" | "items" | "delivered" | "verify";
export type LoginRole = "student" | "staff" | "admin";

export interface HealthData {
  status: string;
  service: string;
  uptime: number;
  dependencies: Record<string, { status: string; latency?: number }>;
}

export interface MetricsData {
  service: string;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
  recentAvgLatencyMs?: number;
  ordersProcessed: number;
  uptime: number;
  connectedClients?: number;
  notificationsSent?: number;
  kitchenProcessingTimeMs?: number;
  totalRevenue?: number;
}

export interface ServiceState {
  name: string;
  key: string;
  port: number;
  color: string;
  health: HealthData | null;
  metrics: MetricsData | null;
  isUp: boolean;
  lastCheck: Date;
}

export interface LatencyPoint {
  time: string;
  gateway: number;
  identity: number;
  stock: number;
  kitchen: number;
  notification: number;
}
