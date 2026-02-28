-- ==========================================
-- Inventory Database Initialization
-- ==========================================

CREATE TABLE IF NOT EXISTS inventory (
    item_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    category VARCHAR(50) NOT NULL,
    image_url VARCHAR(500) DEFAULT '',
    available_qty INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    idempotency_key VARCHAR(100) PRIMARY KEY,
    result TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Auto-cleanup idempotency keys older than 1 hour (optional trigger)
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys (created_at);

-- Seed menu items
INSERT INTO inventory (item_id, name, description, price, category, image_url, available_qty, version) VALUES
    ('item-001', 'Chicken Biryani', 'Aromatic basmati rice with tender chicken, infused with saffron and spices', 120.00, 'Rice', '🍚', 50, 1),
    ('item-002', 'Beef Kacchi', 'Slow-cooked beef kacchi biryani with potatoes and boiled eggs', 180.00, 'Rice', '🍛', 30, 1),
    ('item-003', 'Naan & Curry', 'Freshly baked naan bread with creamy chicken korma curry', 90.00, 'Bread', '🫓', 40, 1),
    ('item-004', 'Fried Rice', 'Chinese-style fried rice with egg, vegetables and soy sauce', 80.00, 'Rice', '🍳', 60, 1),
    ('item-005', 'Chicken Burger', 'Crispy fried chicken patty with lettuce, mayo and special sauce', 150.00, 'Fast Food', '🍔', 45, 1),
    ('item-006', 'Mango Lassi', 'Refreshing yogurt drink blended with fresh mango pulp', 40.00, 'Beverages', '🥤', 100, 1),
    ('item-007', 'Masala Chai', 'Aromatic spiced tea with cardamom, ginger and cinnamon', 25.00, 'Beverages', '☕', 200, 1),
    ('item-008', 'Samosa (2 pcs)', 'Crispy pastry filled with spiced potato and peas', 30.00, 'Snacks', '🥟', 80, 1),
    ('item-009', 'Chocolate Brownie', 'Warm fudgy brownie with chocolate chips', 60.00, 'Dessert', '🍫', 35, 1),
    ('item-010', 'Fresh Juice', 'Mixed fruit juice made from seasonal fresh fruits', 50.00, 'Beverages', '🧃', 70, 1)
ON CONFLICT (item_id) DO NOTHING;
