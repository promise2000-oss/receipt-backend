# Eleosstyles Receipt System — single-service image
#
# One container runs the whole product, which is what Render (and any host
# that hands you a single public port) expects:
#
#   * Next.js      → $PORT (10000 on Render)  ← the only public listener
#   * Express API  → :4000, private to the container
#
# The browser only ever talks to Next.js, which rewrites /api/* to the API, so
# the session cookie stays first-party — exactly as it does in development.
#
#   docker build -t eleosstyles .
#   docker run -p 10000:10000 \
#     -e DATABASE_URL=postgresql://... -e JWT_SECRET=<32+ chars> eleosstyles
#
# Build context is the repository root (see .dockerignore).

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install dependencies first so this layer survives source changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Puppeteer downloads its matching Chrome for Testing while `npm ci` runs. The
# path must be pinned *here*: the default is $HOME/.cache, which the runtime
# stage's COPY would not find.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web

# Next.js bakes the rewrite target into .next/routes-manifest.json, so the API
# address has to be known before `next build` runs.
ARG API_INTERNAL_URL=http://localhost:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build:shared \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build --workspace @eleos/api \
 && npm run build --workspace @eleos/web

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Shared libraries Chromium needs at runtime to print PDFs (kept in sync with
# apps/api/Dockerfile).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libglib2.0-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libx11-6 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      xdg-utils \
 && rm -rf /var/lib/apt/lists/*

# PORT is what Next.js binds to (Render overwrites it with the service's port);
# the API stays on API_PORT, which is never published.
ENV NODE_ENV=production \
    PORT=10000 \
    API_PORT=4000 \
    API_INTERNAL_URL=http://localhost:4000 \
    STORAGE_DIR=/data/storage \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/web ./apps/web
# Chrome for Testing, fetched during `npm ci` above.
COPY --from=build /app/.cache/puppeteer ./.cache/puppeteer

# The persistent disk mounts here; seed it so a fresh volume is never empty.
RUN mkdir -p /data/storage

# Migrate first — idempotent, and nothing serves until the schema is current.
# `exec` hands PID 1 to concurrently, which forwards SIGTERM to both children,
# so Render's shutdown is graceful instead of a 30s wait for SIGKILL.
CMD npm run db:deploy && exec node_modules/.bin/concurrently --kill-others -n api,web -c black,blue "npm:start:api" "npm:start:web"
