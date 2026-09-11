# Backend production image (multi-stage build).
#
# This is a pnpm monorepo, so the build context MUST be the repository root:
#   docker build -f docker/backend.Dockerfile -t hotel-revenue-backend .
#
# Data storage is intentionally cloud-agnostic: the app only reads
# DATABASE_URL at runtime (see backend/.env.example) and does not depend on
# any AWS/GCP SDK, so the same image works against AWS RDS, GCP Cloud SQL,
# or any other managed/self-hosted PostgreSQL instance.
#
# Runtime environment variables (all read via backend/src/lib/config.ts):
#   DATABASE_URL, JWT_SECRET (>= 32 chars), FRONTEND_URL (comma separated),
#   TRUST_PROXY (e.g. 1 behind a single load balancer), PORT (default 3001)
#   MIGRATE_ON_START=true  -> run `prisma migrate deploy` before starting.
#                             Leave unset when migrations are applied by a
#                             separate job (recommended with multiple replicas).

# ---------------------------------------
# Stage 1: install workspace dependencies
# ---------------------------------------
FROM node:20-slim AS deps
RUN corepack enable
WORKDIR /app

# Prisma's query engine needs openssl on Debian-based images.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Only copy manifests first so `pnpm install` is cached unless deps change.
# pnpm-workspace.yaml lists frontend/backend/shared, so all three
# package.json files must be present for the workspace install to resolve,
# even though this image only ships the backend.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY backend/package.json ./backend/package.json
COPY shared/package.json ./shared/package.json
COPY frontend/package.json ./frontend/package.json

RUN pnpm install --frozen-lockfile

# ---------------------------------------
# Stage 2: build backend (prisma generate + tsc)
# ---------------------------------------
FROM deps AS build
WORKDIR /app

COPY backend ./backend
COPY shared ./shared

# `pnpm --filter backend build` runs `prisma generate && tsc -p tsconfig.build.json`
RUN pnpm --filter backend build

# ---------------------------------------
# Stage 3: runtime image
# ---------------------------------------
FROM node:20-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Root-level workspace files (needed by pnpm's symlinked node_modules layout).
# node_modules is copied as-is (including the generated Prisma client and the
# prisma CLI used for `migrate deploy`); pruning devDependencies would drop
# the CLI and the generated engine paths, so it is intentionally kept.
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=node:node /app/node_modules ./node_modules

# Backend runtime artifacts: compiled JS, node_modules (symlinks into the
# root .pnpm store above), prisma/ (schema + migrations) for
# `prisma migrate deploy`, and assets/ (Japanese font used by PDF reports).
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/prisma ./backend/prisma
COPY --from=build --chown=node:node /app/backend/assets ./backend/assets
COPY --chown=node:node docker/backend-entrypoint.sh /app/backend/entrypoint.sh

# Local report storage (STORAGE_DRIVER=local) must be writable by the app user.
RUN mkdir -p /app/backend/storage && chown -R node:node /app/backend/storage \
  && chmod +x /app/backend/entrypoint.sh

WORKDIR /app/backend
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# DATABASE_URL, JWT_SECRET etc. are supplied at deploy time via the
# platform's secret manager / env injection — no cloud SDK is baked in.
ENTRYPOINT ["sh", "/app/backend/entrypoint.sh"]
