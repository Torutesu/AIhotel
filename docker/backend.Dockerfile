# Backend production image (multi-stage build).
#
# This is a pnpm monorepo, so the build context MUST be the repository root:
#   docker build -f docker/backend.Dockerfile -t hotel-revenue-backend .
#
# Data storage is intentionally cloud-agnostic: the app only reads
# DATABASE_URL at runtime (see backend/.env.example) and does not depend on
# any AWS/GCP SDK, so the same image works against AWS RDS, GCP Cloud SQL,
# or any other managed/self-hosted PostgreSQL instance.

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
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/node_modules ./node_modules

# Backend runtime artifacts: compiled JS, node_modules (symlinks into the
# root .pnpm store above), and prisma/ (schema + migrations) needed by
# `prisma migrate deploy` at container startup.
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma

WORKDIR /app/backend

EXPOSE 3001

# Apply any pending migrations, then start the server. DATABASE_URL (and
# JWT_SECRET, etc.) are supplied at deploy time via the platform's secret
# manager / env injection — no cloud SDK is baked into the image.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
