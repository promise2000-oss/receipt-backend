# Eleosstyles Receipt System

Create, brand, send and track sales receipts: a boutique receipt tool for a
single business — customers, a guided receipt builder, a branded PDF, expiry
protected sharing links, history with void/reissue, and a dashboard.

**Cream page · black header · gold accents** — the same palette is used by the
on-screen UI *and* the server-rendered receipt, so the PDF never drifts from
what you saw in the preview.

---

## Contents

- [Features](#features)
- [Stack](#stack)
- [Quick start (local)](#quick-start-local)
- [Scripts](#scripts)
- [Configuration](#configuration)
- [Production build](#production-build)
- [Docker (managed PostgreSQL)](#docker-managed-postgresql)
- [Deploy (Render)](#deploy-render)
- [Testing](#testing)
- [Architecture](#architecture)
- [Business rules](#business-rules)
- [API](#api)
- [API documentation](#api-documentation)
- [Project layout](#project-layout)

---

## Features

| # | Feature | Where |
|---|---------|-------|
| 1 | Email + password sign-in, JWT in an `httpOnly` cookie, sign-up creates business + owner atomically | `/login`, `/signup` |
| 2 | Business settings: name, contact details, logo upload, brand colours with presets, currency, receipt number prefix | `/settings` |
| 3 | Customers: create, edit, search, delete, receipts-per-customer count | `/customers` |
| 4 | Receipt builder: dynamic line items, live totals, per-business sequential numbers (`ES-0000214`), live preview | `/receipts/new` |
| 5 | Branded PDF: black header band + logo, cream body, itemised table, gold total row, gold frame, footer disclaimer | `GET /api/receipts/:id/pdf` |
| 6 | Share: expiring signed link, WhatsApp (`wa.me`), email with the PDF attached, download | `/receipts/:id` |
| 7 | History: search + status/period filters, Paid = gold pill, Pending = grey outline, Void = strikethrough | `/receipts` |
| 8 | Void + reissue: voided receipts are retained and marked, reissue creates a linked replacement with a fresh number | `/receipts/:id` |
| 9 | Dashboard: Today / This Week / This Month cards + recent receipts table | `/dashboard` |

## Stack

- **Web** — Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- **API** — Node.js, Express 5, Zod v4 validation, Prisma 6 → PostgreSQL 17
- **PDF** — one HTML template rendered on screen and fed to Puppeteer
- **Storage** — private disk by default (`LocalDiskStorage`), S3-compatible driver behind env vars
- **Mail** — console transport by default, SMTP in production
- **Monorepo** — npm workspaces: `apps/api`, `apps/web`, `packages/shared`

## Quick start (local)

Requires Node 20+.

```bash
npm install

cp .env.example .env
# then set JWT_SECRET to something long and random:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm run db:start     # terminal 1 — embedded PostgreSQL 17 on :5433, leave it running
npm run db:setup     # terminal 2 — creates the databases, migrates, seeds demo data
npm run dev          # terminal 2 — API on :4000, web on :3000
```

Open <http://localhost:3000> and sign in with the seeded demo tenant:

```
demo@eleosstyles.com
password123
```

> No system PostgreSQL is needed: `npm run db:start` runs real PostgreSQL from
> a project-local data directory (`apps/api/.pgdata`) with a UTF-8 cluster.
> Delete that folder to start from scratch, then run `db:start` + `db:setup`.

## Scripts

Run from the repository root:

| Script | What it does |
|--------|--------------|
| `npm run dev` | Build the shared package, then run API + web in watch mode |
| `npm run build` | Production build: shared → API (`tsc`) → web (`next build`) |
| `npm start` | Run the production build (`dist/index.js` + `next start`) |
| `npm test` | API test suite (business rules, tenancy, auth, numbering…) |
| `npm run typecheck` | Type-check every workspace, including the tests |
| `npm run db:start` | Start the embedded PostgreSQL (foreground, leave running) |
| `npm run db:setup` | Create databases if missing, apply migrations, seed |
| `npm run db:migrate` | `prisma migrate dev` (create/apply migrations interactively) |
| `npm run db:seed` | Seed the demo tenant (idempotent) |
| `npm run db:reset` | Drop, recreate and re-migrate the database, then seed |

## Configuration

Everything is read from the repo-root `.env` (see `.env.example` for the full,
commented list). The important ones:

| Variable | Notes |
|----------|-------|
| `JWT_SECRET` | **Required**, ≥ 32 chars. Signs session cookies *and* share links. |
| `DATABASE_URL` | `postgresql://user:pass@host:port/dbname` |
| `API_ORIGIN` | CORS allowlist (comma separated). The browser normally goes through the Next proxy, so same-origin requests skip CORS entirely. |
| `API_INTERNAL_URL` | Where Next.js proxies `/api/*` to. `http://localhost:4000` locally, `http://api:4000` in Docker. |
| `PUBLIC_API_BASE_URL` | Public origin for share links when a proxy rewrites `Host`. Leave empty to derive it from the request. |
| `STORAGE_DRIVER` | `local` (default, files under `apps/api/.storage`) or `s3` |
| `MAIL_DRIVER` | `console` (default, logs mail) or `smtp` |
| `SHARE_TTL_SECONDS` | Lifetime of public receipt links (default 7 days) |
| `DOCS_ENABLED` | Swagger UI at `/api/docs` (default `true`). Set `false` to take it down on a public deployment. |
| `PUPPETEER_EXECUTABLE_PATH` | Override the Chromium used for PDFs |

## Production build

```bash
npm run build
NODE_ENV=production JWT_SECRET=... DATABASE_URL=... npm start
```

`npm start` runs the compiled API (`apps/api/dist/index.js`) and `next start`.
The web server rewrites `/api/:path*` to `API_INTERNAL_URL`, so the browser
keeps a single origin and the session cookie stays first-party.

Terminate TLS in front of the app (nginx, Caddy, a load balancer) and make sure
`x-forwarded-proto`/`x-forwarded-host` are set — share links and signed URLs
are built from them.

## Docker (managed PostgreSQL)

This is the non-embedded-Postgres path: an official `postgres:17` service plus
API and web containers.

```bash
cp .env.example .env        # set JWT_SECRET
docker compose up --build
docker compose exec api npx prisma db seed   # optional demo tenant
```

Then open <http://localhost:3000>. Only the web container is published; the
browser never talks to the API directly. Uploaded logos and generated PDFs live
in the `storage` volume, the database in `pgdata`.

> `API_INTERNAL_URL` is baked into Next.js's route manifest at **build** time,
> which is why it is passed as a build arg — change it there if your service
> names differ.

## Deploy (Render)

`render.yaml` is a [Render Blueprint](https://render.com/docs/blueprint-spec):
push the repo to GitHub, then **New → Blueprint** in the Render dashboard and
pick the repository. It creates:

| Resource | Plan | Notes |
|----------|------|-------|
| Web service `eleosstyles-receipts` | `1c-2g` | Docker image from `./Dockerfile`, health check `GET /api/health` |
| PostgreSQL 17 `eleosstyles-db` | `0.1c-256mb` | `DATABASE_URL` wired in automatically |
| Disk `eleosstyles-files` | 1 GB | mounted at `/data/storage` → `STORAGE_DIR` |

**One service, one container.** The image runs Next.js on `$PORT` (public,
10000 on Render) and the API on `:4000`, which is never published — the browser
only talks to Next.js, which rewrites `/api/*` to it. That is exactly the
arrangement used in development, so cookies, CORS and share links behave
identically. On boot the container runs `prisma migrate deploy` first and only
then starts both processes, so nothing serves against a stale schema.

Things worth knowing:

- **`JWT_SECRET`** is generated by Render and stored as a secret. Rotating it
  invalidates every session, so do not regenerate it casually.
- **Public URLs** are derived from Render's own `RENDER_EXTERNAL_URL`
  (`apps/api/src/lib/env.ts`), so nothing is hard-coded — set
  `PUBLIC_API_BASE_URL` / `API_ORIGIN` only after adding a custom domain.
- **Mail** ships as `MAIL_DRIVER=console` (logged, not sent). Set
  `MAIL_DRIVER=smtp` plus `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
  to send for real.
- **Swagger UI** is public at `/api/docs`; `DOCS_ENABLED=false` takes it down.
- **Disks need a paid plan.** Render's `free` instances have none, so every
  re-deploy would silently delete uploaded logos and generated PDFs.
- **Optional demo tenant** (dev only — it creates a known password). Add
  `initialDeployHook: npm run db:seed --workspace @eleos/api` to the service.
  Otherwise just sign up at `/signup`, which creates the business and its owner
  account in one transaction.

Push only source and config — `.playwright-mcp/`, `.env`, build output and
`shots/` are gitignored and must never be committed (see `AGENTS.md`).

## Testing

```bash
npm test
```

The suite runs against a dedicated `eleosstyles_test` database (created and
migrated by the setup hook — the development database is never touched) and
asserts the rules the product depends on:

- **Auth** — uniform login failure, bcrypt hashing, tampered cookies rejected
- **Tenancy** — cross-tenant reads resolve to `404`, lists are scoped
- **Immutability** — money fields cannot be edited at the ORM boundary or over HTTP; void + reissue are the only legal corrections
- **Numbering** — 15 concurrent creates produce unique, contiguous receipt numbers
- **Validation** — server-side totals, empty/negative line items rejected
- **Share links** — signing, tamper, expiry, payload redaction
- **Documents** — brand colours present, user input HTML-escaped
- **Settings & customers** — validation, isolation, empty-string handling
- **Documentation** — the OpenAPI document is structurally valid and every endpoint it documents is routed

## Architecture

```
browser ──► Next.js (:3000) ── rewrite /api/* ──► Express (:4000) ──► Prisma ──► PostgreSQL
                                                                     │
                                                     Puppeteer ──────┤ (PDF)
                                                     LocalDisk / S3 ─┘ (files)
```

- **`packages/shared`** holds the Zod schemas, money maths (`computeTotals`),
  enums and DTO types used by both sides — the API validates with exactly the
  schema the form was built against.
- **Session** — `POST /api/auth/login` returns a JWT in an `httpOnly`,
  `SameSite=Lax` cookie. Nothing is kept in `localStorage`.
- **Tenancy** — a Prisma client extension refuses any write to `user`,
  `customer` or `receipt` that does not carry a `business_id`; reads always
  filter by the session's business.
- **Receipt documents** — `renderReceiptHtml()` is the single template for the
  on-screen preview, the live preview iframe (`POST /api/receipts/preview`) and
  the PDF, so all three are identical by construction.
- **Storage** — files are written under a private prefix and only reachable
  through `GET /api/files/:token`, an HMAC-signed expiring URL. The S3 driver
  swaps in presigned URLs without touching routes.
- **Sharing** — `base64url(receiptId.expiresAt).HMAC` carries no guessable id,
  cannot be forged without `JWT_SECRET`, and dies at `SHARE_TTL_SECONDS`.

## Business rules

1. **Issued receipts are immutable.** Totals, line items, dates, payment
   method and receipt number freeze the moment a receipt is created. Updates
   that touch them are rejected with `409 RECEIPT_IMMUTABLE`. Corrections are
   made by **voiding and reissuing** — voided receipts are never deleted, and a
   reissue links back through `original_receipt_id`.
2. **Everything is scoped by `business_id`.** Another tenant's receipt,
   customer or logo is simply "not found".
3. **Receipt numbers are unique and sequential per business**, allocated by
   incrementing `business.receipt_counter` inside the same transaction as the
   insert, backed by `UNIQUE (business_id, receipt_number)` — concurrent
   creates cannot collide or skip.
4. **Totals are computed on the server.** Client-supplied `subtotal`, `tax`,
   `total` and `paid_amount` are ignored/clamped; `computeTotals()` is the one
   source of truth.
5. **No password, no secret, no internal id ever leaves the API** in a public
   payload.

## API

All routes are prefixed `/api`. `me`, `login`… are open; everything else needs
the session cookie.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/signup` | Create business + owner |
| POST | `/auth/login` · `/auth/logout` | Session |
| GET | `/auth/me` | Current user + business |
| GET | `/business` · PATCH `/business` | Read/update settings |
| POST | `/business/logo` · DELETE `/business/logo` | Upload/remove logo |
| GET/POST | `/customers` · GET/PATCH/DELETE `/customers/:id` | Customer CRUD (+ search, count) |
| GET/POST | `/receipts` | List (search/filter) · create |
| POST | `/receipts/preview` | Render HTML for the builder preview |
| GET | `/receipts/:id` | Receipt with items + customer |
| GET | `/receipts/:id/document` | Raw receipt HTML |
| GET | `/receipts/:id/pdf` | Render + return the PDF |
| POST | `/receipts/:id/generate-pdf` | Render, store, return a signed URL |
| POST | `/receipts/:id/void` · `/reissue` | Corrections |
| GET/POST | `/receipts/:id/share` | Signed link |
| POST | `/receipts/:id/email` | Email with PDF attachment |
| GET | `/dashboard/summary` | Today / week / month figures |
| GET | `/public/r/:token` · `/document` · `/download` · POST `/regenerate` | Public share |
| GET | `/files/:token` | HMAC-signed private file |
| GET | `/docs` · `/docs/openapi.json` | Swagger UI · raw OpenAPI 3.1 document |
| GET | `/health` | Liveness |

Errors are always `{ message, code, details? }` with an HTTP status, so the UI
can render field-level messages.

## API documentation

Interactive **Swagger UI** is served by the API itself:

| URL | What |
|-----|------|
| <http://localhost:3000/api/docs> | Through the app — same origin, so the browser sends the session cookie and *Try it out* works immediately (sign in at `/login` first). |
| <http://localhost:4000/api/docs> | Straight against the API during development. |
| `GET /api/docs/openapi.json` | The raw OpenAPI 3.1 document, for codegen or linting. |

The document lives in `apps/api/src/openapi/`:

- **`schemas.ts`** — request bodies are generated from the Zod schemas in
  `packages/shared` via `z.toJSONSchema`, so the published contract cannot
  drift from the validation the API actually performs. Response bodies are the
  `@eleos/shared` DTOs.
- **`spec.ts`** — every path, operation, parameter, status and error message
  (25 paths / 32 operations across Auth, Business, Customers, Receipts,
  Dashboard, Files and the public share links).
- **`index.ts`** — the UI route. Assets come from the local `swagger-ui-dist`
  package instead of a CDN, so the page renders offline, and the spec is
  inlined into `swagger-ui-init.js` rather than fetched separately.

Set `DOCS_ENABLED=false` to take the documentation down. `tests/docs.test.ts`
keeps it honest: every `$ref` resolves, operation ids are unique, parameters
match their paths, and **every documented endpoint really is routed** by
Express (a route rename that leaves the docs behind fails the suite).

## Project layout

```
apps/
  api/          Express + Prisma + Puppeteer
    src/lib/    env, prisma (tenant guard), document (receipt HTML), pdf, storage, tokens, mail
    src/openapi/ OpenAPI document (schemas, paths) + the Swagger UI route
    src/routes/ auth, business, customers, receipts, dashboard, public, files
    prisma/     schema, migrations, seed
    tests/      vitest business-rule + documentation suites
  web/          Next.js app
    src/app/    login, signup, dashboard, receipts, customers, settings, r/[token]
    src/lib/    api client, session, ui helpers
packages/
  shared/       Zod schemas, money maths, enums, DTO types
docker-compose.yml
```

---

### Design reference

The layout follows the written specification (cream `#FBF7EE`, ink `#111111`,
gold `#B8912F` / `#D9B45C`, Inter/Manrope UI type, Playfair Display reserved
for the wordmark, thin gold rules, 8–12px radii, no heavy shadows).
