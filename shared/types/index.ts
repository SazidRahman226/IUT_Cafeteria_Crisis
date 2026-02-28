// ==========================================
// DevSprint 2026 - IUT Cafeteria Crisis
// Shared Types & DTOs
// ==========================================

export enum OrderStatus {
  PENDING = 'PENDING',
  STOCK_VERIFIED = 'STOCK_VERIFIED',
  IN_KITCHEN = 'IN_KITCHEN',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum UserRole {
  STUDENT = 'student',
  ADMIN = 'admin',
}

// JWT Claims
export interface JwtClaims {
  sub: string; // studentId
  role: UserRole;
  iat: number;
  exp: number;
}

// Auth
export interface LoginRequest {
  studentId: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  user: {
    studentId: string;
    name: string;
    role: UserRole;
  };
}

// Menu / Stock
export interface MenuItem {
  itemId: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string;
  availableQty: number;
}

export interface StockReserveRequest {
  itemId: string;
  quantity: number;
  idempotencyKey: string;
}

export interface StockReserveResponse {
  success: boolean;
  itemId: string;
  remainingQty: number;
}

// Orders
export interface OrderItem {
  itemId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface CreateOrderRequest {
  items: OrderItem[];
}

export interface OrderResponse {
  orderId: string;
  studentId: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  createdAt: string;
}

// Notifications
export interface StatusUpdate {
  orderId: string;
  studentId: string;
  status: OrderStatus;
  timestamp: string;
  message?: string;
}

// Queue Messages
export interface KitchenMessage {
  orderId: string;
  studentId: string;
  items: OrderItem[];
  timestamp: string;
}

// Error Format (Standardized)
export interface ApiError {
  error: {
    code: string;
    message: string;
    traceId: string;
  };
}

// Health / Metrics
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  timestamp: string;
  uptime: number;
  dependencies: Record<string, { status: 'ok' | 'down'; latency?: number }>;
}

export interface MetricsData {
  service: string;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
  ordersProcessed?: number;
  kitchenProcessingTimeMs?: number;
  connectedClients?: number;
  uptime: number;
}


