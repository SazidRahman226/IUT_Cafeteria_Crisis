-- ==========================================
-- Orders Database Initialization
-- ==========================================

CREATE TABLE IF NOT EXISTS orders (
    order_id VARCHAR(100) PRIMARY KEY,
    student_id VARCHAR(50) NOT NULL,
    items JSONB NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    idempotency_key VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_student ON orders (student_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders (idempotency_key);

-- OTP delivery tracking
CREATE TABLE IF NOT EXISTS order_delivery (
    order_id VARCHAR(100) PRIMARY KEY REFERENCES orders(order_id),
    otp_code TEXT NOT NULL,
    otp_expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_order_delivery_order ON order_delivery (order_id);

-- Revenue tracking
CREATE TABLE IF NOT EXISTS revenue (
    id VARCHAR(100) PRIMARY KEY,
    order_id VARCHAR(100) REFERENCES orders(order_id),
    student_id VARCHAR(50) NOT NULL,
    amount NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revenue_order ON revenue (order_id);
CREATE INDEX IF NOT EXISTS idx_revenue_created ON revenue (created_at);

