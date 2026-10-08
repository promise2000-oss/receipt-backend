# Eleosstyles Receipt System

Create, brand, send and track sales receipts: a boutique receipt API for a
single business — customers, receipts, branded PDFs, expiry-protected sharing
links, history with void/reissue, and dashboard figures.

This is a **backend only**. There is no browser UI to deploy or maintain. The
API is the whole product, and it serves everything a client needs:

- JSON under `/api`
- **Standalone receipt pages** behind every share link — real HTML, branded, printable
- Generated PDFs
- **Swagger UI** at `/api/docs` for exploring and calling the API

**Cream page · black header · gold accents** — the same HTML template backs both
the share-link page and the PDF, so a customer viewing a link and a customer
holding the printout see an identical document.

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

| # | Feature | Endpoint |
|---|---------|----------|
| 1 | Email + password sign-in, JWT in an `httpOnly` cookie, sign-up creates business + owner atomically | `POST /api/auth/login` · `/signup` |
| 2 | Business settings: name, contact details, logo upload, brand colours, currency, receipt number prefix | `GET`/`PATCH /api/business` · `/logo` |
| 3 | Customers: create, edit, search, delete, receipts-per-customer count | `/api/customers` |
| 4 | Receipts with line items and per-business gap-free sequential numbers (`ES-0000214`); totals computed server-side | `POST /api/receipts` |
| 5 | Branded PDF: black header band + logo, cream body, itemised table, gold total row, gold frame, footer disclaimer | `GET /api/receipts/:id/pdf` |
| 6 | Share: expiring signed link to a standalone receipt page, plus PDF download | `GET /api/public/r/:token/document` · `/download` |
| 7 | History: search + status/period/amount filters | `GET /api/receipts` |
| 8 | Void + reissue: voided receipts are retained and marked, reissue creates a linked replacement with a fresh number | `POST /api/receipts/:id/void` · `/reissue` |
| 9 | Dashboard figures: Today / This Week / This Month + recent receipts | `GET /api/dashboard/summary` |

## Stack

- **API** — Node.js, Express 5, Zod v4 validation, Prisma 6 → PostgreSQL 17
- **Documents** — one HTML template for share pages, fed to Puppeteer for PDFs
- **Storage** — private disk by default (`LocalDiskStorage`), S3-compatible driver behind env vars
- **Mail** — console transport by default, SMTP in production
- **Monorepo** — npm workspaces: `apps/api`, `packages/shared`

## Quick start (local)

Requires Node 20+.

```bash
npm install

cp .env.example .env
# then set JWT_SECRET to something long and random:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm run db:start     # terminal 1 — embedded PostgreSQL 17 on :5433, leave it running
npm run db:setup     # terminal 2 — creates the databases, migrates, seeds the business
npm run dev          # terminal 2 — API on :4000
```

The seed creates one business and one owner login, and it needs your own
credentials — there is no built-in demo password. Set these in `.env` first:

```
SEED_OWNER_EMAIL=you@yourdomain.com
SEED_OWNER_PASSWORD=change-me-to-something-strong
```

The seed creates the business and its owner and **no** receipts or customers —
a real install should not open on a ledger of invented sales. Set
`SEED_SAMPLE_DATA=true` in `.env` when you deliberately want throwaway rows to
exercise the filters and PDF rendering.

Then browse the API:

| URL | What |
|-----|------|
| <http://localhost:4000/api/health> | Liveness check |
| <http://localhost:4000/api/docs> | Swagger UI — sign in at *Authorize* to call protected endpoints |
| `GET /api/docs/openapi.json` | The raw OpenAPI 3.1 document, for codegen or linting |

> No system PostgreSQL is needed: `npm run db:start` runs real PostgreSQL from
> a project-local data directory (`apps/api/.pgdata`) with a UTF-8 cluster.
> Delete that folder to start from scratch, then run `db:start` + `db:setup`.

## Scripts

Run from the repository root:

| Script | What it does |
|--------|--------------|
| `npm run dev` | Build the shared package, then run the API in watch mode |
| `npm run build` | Production build: shared → API (`tsc`) |
| `npm start` | Run the production build (`dist/index.js`) |
| `npm test` | API test suite (business rules, tenancy, auth, numbering…) |
| `npm run typecheck` | Type-check every workspace, including the tests |
| `npm run db:start` | Start the embedded PostgreSQL (foreground, leave running) |
| `npm run db:setup` | Create databases if missing, apply migrations, seed |
| `npm run db:migrate` | `prisma migrate dev` (create/apply migrations interactively) |
| `npm run db:seed` | Seed the business and owner (idempotent) |
| `npm run db:reset` | Drop, recreate and re-migrate the database, then seed |

## Configuration

Everything is read from the repo-root `.env` (see `.env.example` for the full,
commented list). The important ones:

| Variable | Notes |
|----------|-------|
| `JWT_SECRET` | **Required**, ≥ 32 chars. Signs session cookies *and* share links. |
| `DATABASE_URL` | `postgresql://user:pass@host:port/dbname` |
| `API_ORIGIN` | CORS allowlist for browser clients (comma separated). Only needed if a browser app calls the API from another origin — requests with no `Origin` header (curl, server-to-server) are never checked. Defaults to `RENDER_EXTERNAL_URL` when set, otherwise empty, which rejects every browser origin. |
| `PORT` / `API_PORT` | Listen port. `PORT` is what PaaS providers set; `API_PORT` wins when set explicitly and defaults to 4000. |
| `PUBLIC_API_BASE_URL` | Public origin for share links when a proxy rewrites `Host`. Leave empty to derive it from the request. |
| `STORAGE_DRIVER` | `local` (default, files under `apps/api/.storage`) or `s3` |
| `MAIL_DRIVER` | `console` (default, logs mail) or `smtp` |
| `SHARE_TTL_SECONDS` | Lifetime of public receipt links (default 7 days) |
| `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` | Owner login created by `npm run db:seed`. No default — the seed refuses to run without them. |
| `DOCS_ENABLED` | Swagger UI at `/api/docs` (default `true`). Set `false` to take it down on a public deployment. |
| `PUPPETEER_EXECUTABLE_PATH` | Override the Chromium used for PDFs |

## Production build

```bash
npm run build
NODE_ENV=production JWT_SECRET=... DATABASE_URL=... npm start
```

`npm start` runs the compiled API (`apps/api/dist/index.js`), which listens on
`API_PORT` (4000 by default, or `PORT` when the platform sets it).

Terminate TLS in front of the app (nginx, Caddy, a load balancer) and make sure
`x-forwarded-proto`/`x-forwarded-host` are set — share links and signed URLs
are built from them.

## Docker (managed PostgreSQL)

This is the non-embedded-Postgres path: an official `postgres:17` service plus
the API.

```bash
cp .env.example .env        # set JWT_SECRET
docker compose up --build
docker compose exec api npm run db:seed   # create the business and owner
```

Then browse <http://localhost:4000/api/docs>. Uploaded logos and generated PDFs
live in the `storage` volume, the database in `pgdata`.

## Deploy (Render)

`render.yaml` is a [Render Blueprint](https://render.com/docs/blueprint-spec):
push the repo to GitHub, then **New → Blueprint** in the Render dashboard and
pick the repository. It creates:

| Resource | Plan | Notes |
|----------|------|-------|
| Web service `eleosstyles-receipts` | `free` — 0.1 CPU / 512 MB | Docker image from `./Dockerfile`, health check `GET /api/health` |
| PostgreSQL 17 `eleosstyles-db` | `free` — 1 GB, **expires after 30 days** | `DATABASE_URL` wired in automatically |

No disk: free services don't support them, so uploads live in the container's
filesystem (see the caveats below).

**One service, one container.** The API is the only process, and it listens on
`$PORT` (public, 10000 on Render). On boot the container runs
`prisma migrate deploy` first and only then starts the server, so nothing serves
against a stale schema. `PID 1` is node itself, so Render's SIGTERM reaches the
graceful shutdown in `index.ts` instead of being swallowed by an npm wrapper.

### Free-tier caveats

- **Files don't survive.** Without a disk (paid only), every re-deploy,
  restart *and* the automatic spin-down after 15 idle minutes wipes
  `STORAGE_DIR` — uploaded logos and generated PDFs included. When that
  matters, either set `STORAGE_DRIVER=s3` with `S3_ENDPOINT`, `S3_REGION`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`
  (Cloudflare R2 has a free tier), or move off `free` and re-enable the
  commented `disk:` block in `render.yaml`.
- **Cold starts.** The first request after 15 idle minutes takes ~60 s while
  Render wakes the instance. Spun-down time doesn't count against the 750 free
  instance-hours granted per month.
- **512 MB for two processes plus Chromium.** PDF generation is the memory
  peak. If `GET /api/receipts/:id/pdf` fails on Render, the instance is out of
  RAM — bump `plan` to `0.5c-512mb` ($7/mo) or `1c-2g` ($25/mo).
- **Mail cannot send.** Free instances block outbound SMTP (25/465/587), so
  `MAIL_DRIVER=console` (the default) logs mail instead of sending it. Sending
  requires a paid plan plus `MAIL_DRIVER=smtp` and `SMTP_*`.
- **Free Postgres expires 30 days after creation**, then a 14-day grace period
  before Render deletes the database. Export the data or upgrade the instance
  before that. It also has no backups and may restart for maintenance.

Things worth knowing:

- **`JWT_SECRET`** is generated by Render and stored as a secret. Rotating it
  invalidates every session, so do not regenerate it casually.
- **Public URLs** are derived from Render's own `RENDER_EXTERNAL_URL`
  (`apps/api/src/lib/env.ts`), so nothing is hard-coded — set
  `PUBLIC_API_BASE_URL` / `API_ORIGIN` only after adding a custom domain.
- **Swagger UI** is public at `/api/docs`; `DOCS_ENABLED=false` takes it down.
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
client ──► Express (:4000) ──► Prisma ──► PostgreSQL
                                                                     │
                                                     Puppeteer ──────┤ (PDF)
                                                     LocalDisk / S3 ─┘ (files)
```

- **`packages/shared`** holds the Zod schemas, money maths (`computeTotals`),
  enums and DTO types. The API validates against these, and the OpenAPI request
  bodies are generated from them, so the published contract cannot drift from
  the validation actually performed.
- **Session** — `POST /api/auth/login` returns a JWT in an `httpOnly`,
  `SameSite=Lax` cookie. Nothing is kept in `localStorage`.
- **Tenancy** — a Prisma client extension refuses any write to `user`,
  `customer` or `receipt` that does not carry a `business_id`; reads always
  filter by the session's business.
- **Receipt documents** — `renderReceiptHtml()` is the single template behind
  the share-link page (`GET /api/public/r/:token/document`), the owner's preview
  (`POST /api/receipts/preview`) and the PDF, so all three are identical by
  construction.
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

Errors are always `{ message, code, details? }` with an HTTP status, so a client
can render field-level messages.

## API documentation

Interactive **Swagger UI** is served by the API itself:

| URL | What |
|-----|------|
| `GET /api/docs` | The interactive UI. Sign in with *Authorize* first, then *Try it out* sends your session cookie. |
| `GET /api/docs/openapi.json` | The raw OpenAPI 3.1 document, for codegen or linting. |

Set `DOCS_ENABLED=false` to take the documentation down — worth doing on a public
deployment. `tests/docs.test.ts` keeps it honest: every `$ref` resolves, operation
ids are unique, parameters match their paths, and **every documented endpoint
really is routed** by Express (a route rename that leaves the docs behind fails
the suite).

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
packages/
  shared/       Zod schemas, money maths, enums, DTO types
Dockerfile          single-container image (API + Chromium) for Render
render.yaml         Render Blueprint: one web service + managed Postgres
docker-compose.yml  local Postgres + API
```

---

### Design reference

The receipt document follows the written specification (cream `#FBF7EE`, ink
`#111111`, gold `#B8912F` / `#D9B45C`, Playfair Display for the wordmark, thin
gold rules, 8–12px radii, no heavy shadows). The two brand colours are per
business, so a tenant's own palette replaces the defaults.
