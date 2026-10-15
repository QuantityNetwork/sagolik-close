# Sagolik Close — two images from one Dockerfile:
#   web     the Next.js app (standalone output), non-root
#             docker build --target web -t sagolik-web .
#   worker  the worker, plus the migrate and keys commands (Azure jobs), non-root
#             docker build --target worker -t sagolik-worker .
#             docker run sagolik-worker                                   # the worker loop
#             docker run sagolik-worker node --import tsx apps/worker/src/migrate.ts
# See docs/azure/runbook.md (Azure) or docs/deployment.md.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN pnpm --filter @sagolik/web build \
 && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static \
 && mkdir -p apps/web/.next/standalone/apps/web/public \
 && cp -r apps/web/public/. apps/web/.next/standalone/apps/web/public/

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]

FROM deps AS worker
COPY . .
ENV NODE_ENV=production
USER node
# node is the process itself (not pnpm), so SIGTERM reaches the worker's own handler.
CMD ["node", "--import", "tsx", "apps/worker/src/main.ts"]
