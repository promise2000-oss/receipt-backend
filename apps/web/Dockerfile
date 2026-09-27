# Eleosstyles Receipt System — Web (Next.js)
#
# Build context is the repository root (see docker-compose.yml):
#
#   docker build -f apps/web/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# The web app never renders PDFs, so skip Puppeteer's ~150MB Chromium download.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# Next.js bakes rewrites into .next/routes-manifest.json, so the API address
# has to be known at build time — pass it as a build arg in docker-compose.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL

RUN npm run build:shared && npm run build --workspace @eleos/web

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    API_INTERNAL_URL=http://api:4000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/web ./apps/web

WORKDIR /app/apps/web
EXPOSE 3000

CMD ["npx", "next", "start", "-p", "3000"]
