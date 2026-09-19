# Galaxy Agent Backend (`galaxy-agent-backend`)

The production-grade agent orchestration backend for **Galaxy Agent Chat**. Features a provider-neutral typed tool registry, progressive on-demand skills system, live Magica GPU execution, transactional credit ledger, and outbound HMAC-SHA256 signed webhooks.

---

## 🏛️ Architecture Overview

- **Runtime**: Next.js 15 App Router (Route Handlers) running on port 3001
- **Database**: PostgreSQL 16 + Prisma ORM (9 relational models, cascade deletes, composite pagination indexes)
- **Core LLM**: OpenRouter Free (`openrouter/free`) with 0 credits charged to the user
- **Typed Tools**: Runtime Zod schemas automatically converted to OpenAI function declarations
- **Magica Integration**: Live server-to-server execution for `crop_image`, `gpt_image_2`, and `merge_videos` with 300s timeout tolerance
- **Realtime**: Server-Sent Events (SSE) with event replay buffer and zero-refresh database reconciliation
- **Webhooks**: Outbound HMAC-SHA256 signed lifecycle events (`agent.started`, `tool.completed`, `agent.completed`, `agent.failed`)

---

## ⚡ Quick Start

### 1. Install Dependencies & Generate Prisma Client
```bash
pnpm install
npx prisma generate
```

### 2. Database Setup (PostgreSQL)
Ensure PostgreSQL is running, then push the schema:
```bash
npx prisma db push
```

### 3. Run Development Server
```bash
pnpm dev
# API listening on http://localhost:3001
```

### 4. Run Automated Test Suite (Vitest)
```bash
pnpm test
```

---

## 📦 API Endpoints & Postman Collection

A complete 18-endpoint Postman collection is located at [`galaxy_postman_collection.json`](./galaxy_postman_collection.json).

| Category | Method | Endpoint | Description |
| :--- | :--- | :--- | :--- |
| **Chats** | `POST` | `/api/chats` | Create conversation session |
| **Chats** | `GET` | `/api/chats` | List user chats (cursor-paginated) |
| **Messages** | `POST` | `/api/chats/:id/messages` | Dispatch turn (Plan Mode, attachments, concurrency lock) |
| **Runs** | `GET` | `/api/runs/:id/stream` | Server-Sent Events real-time text & thinking stream |
| **Runs** | `POST` | `/api/runs/:id/cancel` | Cancel in-flight agent run |
| **Waitpoints**| `POST`| `/api/runs/:id/waitpoints/:token/resolve` | Submit human approval for Plan Mode |
| **Credits** | `GET` | `/api/credits` | Balance and transaction ledger audit history |
| **Media** | `POST` | `/api/transloadit/assembly` | Signed HMAC-SHA384 upload parameters |
| **Webhooks**| `GET` | `/api/webhooks` | Webhook status & supported lifecycle events |

---

## 🧪 Testing

```bash
pnpm test
```
Runs 16 unit and integration tests covering Tool Registry, Skills System, Webhook signatures, and Credit Ledger accounting.
