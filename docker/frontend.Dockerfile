# Frontend production image (multi-stage build).
#
# This is a pnpm monorepo, so the build context MUST be the repository root:
#   docker build -f docker/frontend.Dockerfile -t hotel-revenue-frontend .
#
# next.config.mjs does not set output: 'standalone', so this image ships the
# regular `.next` build output plus node_modules and runs `next start`
# (rather than the standalone server.js approach).

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

# NEXT_PUBLIC_BACKEND_URL is optional: if unset, the rewrite in
# next.config.mjs falls back to http://localhost:3001 and the actual
# backend origin can still be supplied at runtime for client requests
# routed through /api/* rewrites.
ARG NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}

RUN pnpm --filter frontend build

# ---------------------------------------
# Stage 3: runtime image
# ---------------------------------------
FROM node:20-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Root-level workspace files (needed by pnpm's symlinked node_modules layout).
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/node_modules ./node_modules

# Frontend runtime artifacts: node_modules (symlinks into the root .pnpm
# store above), the Next.js build output, and static assets.
COPY --from=build /app/frontend/package.json ./frontend/package.json
COPY --from=build /app/frontend/node_modules ./frontend/node_modules
COPY --from=build /app/frontend/next.config.mjs ./frontend/next.config.mjs
COPY --from=build /app/frontend/.next ./frontend/.next
COPY --from=build /app/frontend/public ./frontend/public

WORKDIR /app/frontend

EXPOSE 3000

# NEXT_PUBLIC_BACKEND_URL can be overridden at deploy time; it only affects
# the /api/* rewrite target used by the browser, not any bundled cloud SDK.
CMD ["npx", "next", "start", "-p", "3000"]
