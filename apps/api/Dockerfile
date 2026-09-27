# Eleosstyles Receipt System — API
#
# Build context is the repository root (see docker-compose.yml), because the
# API compiles the shared package it imports:
#
#   docker build -f apps/api/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install dependencies first so this layer survives source changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Puppeteer downloads its matching Chrome for Testing while `npm ci` runs; the
# path has to be pinned here so the runtime stage's COPY finds it (the default
# is $HOME/.cache, which does not survive the stage boundary).
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build:shared \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build --workspace @eleos/api

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Shared libraries Chromium needs at runtime (PDF rendering).
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

ENV NODE_ENV=production \
    API_PORT=4000 \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api
# Puppeteer downloads its matching Chromium into the cache during `npm ci`.
COPY --from=build /app/.cache/puppeteer ./.cache/puppeteer

WORKDIR /app/apps/api
EXPOSE 4000

# Migrations are idempotent, so a restart also picks up new schema changes.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/index.js"]
