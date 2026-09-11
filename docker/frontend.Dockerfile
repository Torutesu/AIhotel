# Frontend production image (multi-stage build).
#
# This is a pnpm monorepo, so the build context MUST be the repository root:
#   docker build -f docker/frontend.Dockerfile -t hotel-revenue-frontend .
#
# next.config.mjs does not set output: 'standalone', so this image ships the
# regular `.next` build output plus node_modules and runs `next start`
# (rather than the standalone server.js approach).
#
# Environment variables:
#   BACKEND_URL           (runtime, server-side) origin the /api/* rewrite proxies
#                         to, e.g. http://backend:3001. Browser code always calls
#                         same-origin /api/*, so no CORS configuration is needed.
#   NEXT_PUBLIC_DEMO_MODE (build-time, optional) "true" enables the demo fallback
#                         that shows sample data when the backend is unreachable.
#                         Leave unset for real deployments.

# ---------------------------------------
# Stage 1: install workspace dependencies
# ---------------------------------------
FROM node:20-slim AS deps
RUN corepack enable
WORKDIR /app

# pnpm-workspace.yaml lists frontend/backend/shared, so all three
# package.json files must be present for the workspace install to resolve,
# even though this image only ships the frontend.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY frontend/package.json ./frontend/package.json
COPY shared/package.json ./shared/package.json
COPY backend/package.json ./backend/package.json

RUN pnpm install --frozen-lockfile

# ---------------------------------------
# Stage 2: build frontend (next build)
# ---------------------------------------
FROM deps AS build
WORKDIR /app

COPY frontend ./frontend
COPY shared ./shared

ARG NEXT_PUBLIC_DEMO_MODE
ENV NEXT_PUBLIC_DEMO_MODE=${NEXT_PUBLIC_DEMO_MODE}
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter frontend build

# ---------------------------------------
# Stage 3: runtime image
# ---------------------------------------
FROM node:20-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Root-level workspace files (needed by pnpm's symlinked node_modules layout).
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=node:node /app/node_modules ./node_modules

# Frontend runtime artifacts: node_modules (symlinks into the root .pnpm
# store above), the Next.js build output, and static assets.
COPY --from=build --chown=node:node /app/frontend/package.json ./frontend/package.json
COPY --from=build --chown=node:node /app/frontend/node_modules ./frontend/node_modules
COPY --from=build --chown=node:node /app/frontend/next.config.mjs ./frontend/next.config.mjs
COPY --from=build --chown=node:node /app/frontend/.next ./frontend/.next
COPY --from=build --chown=node:node /app/frontend/public ./frontend/public

WORKDIR /app/frontend
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# BACKEND_URL is read at runtime by next.config.mjs rewrites().
CMD ["npx", "next", "start", "-p", "3000"]
