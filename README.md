# SiteLens — Precision Site Operations & Inspection Platform

SiteLens is a **dedicated, self-hosted** field inspection, checklist master-data, and corrective action (CAPA) platform built for construction and industrial operations.

It is designed for single-tenant pilot and production deployments where field inspectors and office engineers collaborate across web and mobile devices.

---

## Core Capabilities

- **Template Master Data (ISO / ASME / API Formats):** Structured checklist templates supporting standard body metadata (`ISO`, `ASME`, `API`, `SNI`, `OSHA`), document control numbers, ITP inspection points (`H`/`W`/`R`/`S`), acceptance criteria, and numeric tolerance thresholds.
- **Dynamic Multi-Step Approval Workflows:** Configurable per-template approval stages by role and trigger condition (`always`, `on_fail`, `on_critical`).
- **Field Inspection & Evidence Capture:** Bilingual (`EN` / `ID`) inspection execution with conditional fields, photo evidence, digital signatures, and automated PDF compliance reports (`jsPDF`).
- **Corrective Actions (CAPA):** Track open findings, severity levels, assignees, due dates, and resolution evidence.
- **Offline OCR & Optional BYOK AI:**
  - **Tesseract.js OCR** runs 100% locally in the browser with zero API cost.
  - **Gemini AI Template Generator** is optional (Bring Your Own Key via `GEMINI_API_KEY`); the server and app run cleanly without it.
- **Self-Hosted Infrastructure:** Docker Compose stack with **PostgreSQL 16** (Drizzle ORM), local disk media volume (`/data/uploads`), and **Caddy** reverse proxy with automatic HTTPS.

---

## Tech Stack

- **Frontend:** React 19, Vite 8, Tailwind CSS v4, Motion, Lucide Icons, `jspdf`, `tesseract.js`
- **Backend:** Express, Node.js 22 (`tsx`), Drizzle ORM, `@google/genai` (optional)
- **Database & Infra:** PostgreSQL 16, Docker Compose, Caddy 2 (auto-HTTPS)

---

## Quick Start

### 1. Local Development

```bash
# Install dependencies
npm install --legacy-peer-deps

# Copy environment template
cp .env.example .env

# Run dev server (Express + Vite middleware on http://localhost:3000)
npm run dev
```

### 2. Self-Hosted Pilot (Docker Compose)

1. Copy `.env.example` to `.env` and update `POSTGRES_PASSWORD`, `SESSION_SECRET`, `SITE_DOMAIN`, `RP_ID`, and `RP_ORIGIN`.
2. Build and start the stack (`postgres`, `app`, `caddy`):

```bash
docker compose up -d --build
```

3. Push the Drizzle schema and seed initial master data + admin account:

```bash
docker compose exec app npm run db:push
docker compose exec app npm run db:seed
```

4. Check server health:

```bash
curl -k https://localhost/api/health
```

---

## Database & Useful Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Express + Vite dev server on port `3000` |
| `npm run build` | Build production frontend bundle to `dist/` |
| `npm run lint` | Run TypeScript type check (`tsc --noEmit`) |
| `npm run db:generate` | Generate Drizzle SQL migrations into `drizzle/` |
| `npm run db:push` | Push Drizzle schema directly to PostgreSQL |
| `npm run db:seed` | Seed default admin user, sample projects, and master templates |

---

## Project Structure

```text
├── server.ts                  # Express server, API routes, Vite/static serving
├── docker-compose.yml         # PostgreSQL, App, and Caddy auto-HTTPS stack
├── Dockerfile                 # Multi-stage production container build
├── Caddyfile                  # Reverse proxy & automatic TLS configuration
├── drizzle.config.ts          # Drizzle Kit configuration
├── drizzle/                   # Generated PostgreSQL SQL migrations
└── src/
    ├── server/db/             # Drizzle schema, DB pool, and seed script
    ├── components/            # React UI modules (Dashboard, Builder, Execution, CAPA, etc.)
    ├── services/              # Client storage & API services
    ├── i18n/                  # English & Bahasa Indonesia translations
    ├── types/                 # Shared TypeScript domain types
    └── utils/                 # PDF generator & local Tesseract OCR service
```

