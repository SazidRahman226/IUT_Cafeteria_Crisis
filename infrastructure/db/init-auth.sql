-- ==========================================
-- Auth Database Initialization
-- ==========================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'student',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Seed users (password: password123 for all)
-- bcrypt hash of 'password123'
INSERT INTO users (student_id, name, password_hash, role) VALUES
    ('student1', 'Farhan Ahmed', '$2a$10$aoUqgAb3oZe5sJybauEFROQAAM2I2pKEku2kmozoqWFTluuC.5aVa', 'student'),
    ('student2', 'Nadia Rahman', '$2a$10$aoUqgAb3oZe5sJybauEFROQAAM2I2pKEku2kmozoqWFTluuC.5aVa', 'student'),
    ('admin1', 'System Admin', '$2a$10$aoUqgAb3oZe5sJybauEFROQAAM2I2pKEku2kmozoqWFTluuC.5aVa', 'admin')
ON CONFLICT (student_id) DO NOTHING;
