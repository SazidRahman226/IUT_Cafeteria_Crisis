# 🍽️ IUT Cafeteria Crisis — DevSprint 2026

> **Production-grade microservices system** for campus cafeteria management with real-time order tracking, chaos engineering, and full observability.

---

## 🚀 Quick Start (One Command)

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| **Cafeteria Portal** (Student + Admin) | [http://localhost:3000](http://localhost:3000) |
| Order Gateway API | [http://localhost:8080](http://localhost:8080) |
| Identity Provider | [http://localhost:4001](http://localhost:4001) |
| Stock Service | [http://localhost:4002](http://localhost:4002) |
| Kitchen Service | [http://localhost:4003](http://localhost:4003) |
| Notification Hub | [http://localhost:4005](http://localhost:4005) |
| RabbitMQ Management | [http://localhost:15672](http://localhost:15672) (guest/guest) |
| Prometheus | [http://localhost:9090](http://localhost:9090) |

### Demo Credentials

| Role | ID | Password |
|---|---|---|
| Student | `student1` | `password123` |
| Student | `student2` | `password123` |
| Admin | `admin1` | `password123` |

---

## 🏗️ Architecture

<img src="Architecture.png" alt="Architecture" width="700"/>

---

## 🧪 Judge Quick Test Guide

### 1. Login & Place Order

```bash
# Login as student
curl -X POST http://localhost:4001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"studentId":"student1","password":"password123"}'

# Save the returned accessToken, then:
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"items":[{"itemId":"item-001","name":"Chicken Biryani","quantity":2,"price":120}]}'
```

### 2. Check Health Endpoints

```bash
curl http://localhost:4001/health  # Identity Provider
curl http://localhost:4002/health  # Stock Service
curl http://localhost:8080/health  # Order Gateway
curl http://localhost:4003/health  # Kitchen Service
curl http://localhost:4005/health  # Notification Hub
```

### 3. Check Metrics (Prometheus format)

```bash
curl http://localhost:8080/metrics
```

### 4. Rate Limiting (3 attempts/min per studentId)

```bash
# Fire 4 rapid login attempts — 4th will be rate-limited
for i in $(seq 1 4); do
  echo "--- Attempt $i ---"
  curl -s -X POST http://localhost:4001/auth/login \
    -H "Content-Type: application/json" \
    -d '{"studentId":"student1","password":"wrong"}'
  echo ""
done
```

### 5. Chaos Engineering

```bash
# Login as admin first
ADMIN_TOKEN=$(curl -s -X POST http://localhost:4001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"studentId":"admin1","password":"password123"}' | jq -r '.accessToken')

# Kill the kitchen service
curl -X POST http://localhost:4003/chaos/kill \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Watch docker compose auto-restart it
docker compose ps
```

### 6. Idempotency Check

```bash
# Same idempotency key returns same result, stock not double-deducted
IDEM_KEY=$(uuidgen)
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '{"items":[{"itemId":"item-001","name":"Chicken Biryani","quantity":1,"price":120}]}'

# Repeat with same key — should return cached result
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '{"items":[{"itemId":"item-001","name":"Chicken Biryani","quantity":1,"price":120}]}'
```

---

## 📁 Repository Structure

```
iut-cafeteria-crisis/
├── services/
│   ├── identity-provider/    # JWT auth, bcrypt, rate limiting
│   ├── stock-service/        # Inventory with optimistic locking
│   ├── order-gateway/        # API gateway, Redis cache, RabbitMQ
│   ├── kitchen-service/      # Async order processing via AMQP
│   └── notification-hub/     # WebSocket real-time updates
├── clients/                  # Unified React app (Student + Admin dashboard)
├── shared/                   # Types, middleware, DTOs
├── infrastructure/
│   ├── db/                   # SQL init + seed scripts
│   └── prometheus/           # Prometheus config
├── k8s/                      # Kubernetes manifests
├── .github/workflows/        # CI/CD pipeline
└── docker-compose.yml        # Single-command orchestration
```

---

## 🔑 Key Technical Features

| Feature | Implementation |
|---|---|
| **Authentication** | JWT tokens with bcrypt password hashing |
| **Rate Limiting** | 3 login attempts/min per studentId (Identity Provider) |
| **Optimistic Locking** | Version-based concurrency control in Stock Service |
| **Idempotency** | UUID-based idempotency keys in Order Gateway + Stock Service |
| **Message Queue** | RabbitMQ for async order → kitchen processing |
| **Caching** | Redis for stock level caching (30s TTL) |
| **Real-time** | WebSocket push for order status updates |
| **Observability** | Prometheus metrics + structured JSON logging + request ID tracing |
| **Chaos Engineering** | `/chaos/kill` endpoint on every service (admin-only) |
| **Resilience** | Auto-restart, PENDING_QUEUE retry, connection retry with backoff |

---

## 🧪 Running Tests

```bash
# Order validation tests
cd services/order-gateway && npm test

# Stock deduction / idempotency tests
cd services/stock-service && npm test
```

---

## ☸️ Kubernetes Deployment

```bash
kubectl apply -f k8s/infrastructure/namespace-secrets.yaml
kubectl apply -f k8s/infrastructure/
kubectl apply -f k8s/services/
```

---

## 🛠️ Tech Stack

- **Backend:** Node.js + TypeScript + Express
- **Database:** PostgreSQL 16 (3 isolated instances)
- **Cache:** Redis 7
- **Message Queue:** RabbitMQ 3.12
- **Frontend:** React 18 + Vite + Tailwind CSS + Framer Motion + Recharts
- **Metrics:** Prometheus
- **CI/CD:** GitHub Actions
- **Containerization:** Docker + Docker Compose
- **Orchestration:** Kubernetes (manifests provided)

---

Built for **DevSprint 2026** by Team IUT 🏆
