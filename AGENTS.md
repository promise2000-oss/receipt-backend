# Agent instructions — Eleosstyles Receipt System

Project instructions for anyone (human or AI) working in this repository.
**Read this before staging, committing or pushing anything.**

---

## ⚠️ Git rules — hard requirements

### Never commit or push `.playwright-mcp/`

`.playwright-mcp/` is browser-session scratch data (page snapshots written by
the Playwright MCP tool). It is **not source code** and must never reach GitHub.

- It is listed in `.gitignore` (`.playwright-mcp/`).
- Before **every** `git add` / `git commit`, run `git status --porcelain` and
  confirm `.playwright-mcp/` is **not** in the list of staged or untracked
  files. `git status --ignored` should show it under the ignored section.
- If it ever appears as untracked, either delete the directory or add it back
  to `.gitignore`. **Never** stage it to "include everything else" — stage
  explicit paths instead.
- Preferred habit: stage by path (`git add <dir-or-file>`), not `git add -A`,
  when the tree is dirty.

### Also never committed

| Path | Why |
|------|-----|
| `.env` | Secrets (JWT_SECRET, database URL, SMTP password) |
| `node_modules/`, `dist/`, `.next/`, `build/`, `coverage/` | Build output |
| `apps/api/.pgdata/` | Embedded PostgreSQL data directory |
| `apps/api/.storage/` | Uploaded logos and generated PDFs |
| `shots/` | Local screenshots / verification artefacts |
| `*.log`, `.DS_Store`, `Thumbs.db`, editors' folders | Noise |

### Always committed

Everything else: source (`apps/`, `packages/`), tests, configs, docs
(`README.md`, `AGENTS.md`, `.env.example`), Docker files, `docker-compose.yml`
and `render.yaml`. `.gitignore` is committed too — ignoring a file is not the
same as committing it.

---

## Where things are

| Path | What |
|------|------|
| `apps/api` | Express 5 + Prisma + Puppeteer (`src/routes`, `src/lib`, `src/openapi`) — the whole product |
| `packages/shared` | Zod schemas, money maths, enums, DTO types |
| `render.yaml` | Render Blueprint: one web service (Docker) + managed Postgres + disk |
| `Dockerfile` | Single-container image for Render (the API + Chromium) |
| `apps/api/Dockerfile` | The image `docker-compose.yml` builds |

There is no frontend. The API serves the JSON, the standalone receipt pages
behind share links, the PDFs and Swagger UI at `/api/docs`.

## Commands

```bash
npm run typecheck   # all workspaces, including tests
npm test            # API suite — needs the database from `npm run db:start`
npm run build       # shared → api (tsc)
```

## Rules the code is built on

1. Issued receipts are immutable — correct with **void + reissue**.
2. Everything is scoped by `business_id`; another tenant resolves to `404`.
3. Totals are computed on the server (`computeTotals`), never trusted from the client.
4. Request schemas are generated from `packages/shared`'s Zod schemas
   (`apps/api/src/openapi/schemas.ts`) — change the schema, not the docs.
5. No secret, password or internal id ever appears in a public payload.

## Deployment notes (Render)

- One web service, one container: the Express API is the only process and
  listens on `$PORT` (`API_PORT` wins when set explicitly, otherwise `PORT`
  falls back to 4000). `PID 1` is node, so SIGTERM reaches the graceful
  shutdown in `index.ts`.
- **Blueprint is configured for the `free` tier**: no disk (free services
  cannot have one), so `STORAGE_DIR` is ephemeral — re-deploys and the
  15-minute spin-down delete uploaded logos and PDFs. Moving off `free`
  means setting a paid `plan:` and re-enabling the commented `disk:` block.
- Free Postgres expires **30 days after creation**; export or upgrade.
- Swagger UI lives at `/api/docs`, raw spec at `/api/docs/openapi.json`
  (`DOCS_ENABLED=false` turns it off).
