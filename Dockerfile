# Sagolik Close — web app container (Next.js standalone output).
#   docker build -t sagolik-close .
#   docker run -p 3000:3000 --env-file .env.production sagolik-close
# The worker uses the same image:  docker run --env-file … sagolik-close node_modules/.bin/tsx apps/worker/src/main.ts
# (see docs/deployment.md; not needed in demo mode).

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
CMD ["pnpm", "worker"]
