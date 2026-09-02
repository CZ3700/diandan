# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

FROM ${NODE_IMAGE} AS builder

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm fetch --frozen-lockfile

COPY . .

RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter @fan-support/config build \
  && pnpm --filter @fan-support/storefront build \
  && pnpm --filter @fan-support/admin build \
  && pnpm --filter @fan-support/api build \
  && pnpm --filter @fan-support/worker build
RUN pnpm --filter @fan-support/api --prod deploy --legacy /runtime/api \
  && pnpm --filter @fan-support/worker --prod deploy --legacy /runtime/worker

FROM ${NODE_IMAGE} AS storefront

ENV HOSTNAME=0.0.0.0 \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3000
WORKDIR /app

COPY --from=builder --chown=node:node /workspace/apps/storefront/.next/standalone ./
COPY --from=builder --chown=node:node /workspace/apps/storefront/.next/static ./apps/storefront/.next/static

USER node
WORKDIR /app/apps/storefront
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]

FROM ${NODE_IMAGE} AS admin

ENV HOSTNAME=0.0.0.0 \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3000
WORKDIR /app

COPY --from=builder --chown=node:node /workspace/apps/admin/.next/standalone ./
COPY --from=builder --chown=node:node /workspace/apps/admin/.next/static ./apps/admin/.next/static

USER node
WORKDIR /app/apps/admin
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]

FROM ${NODE_IMAGE} AS api

ENV PORT=3002
WORKDIR /app

COPY --from=builder --chown=node:node /runtime/api ./

USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3002/healthz').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]

FROM ${NODE_IMAGE} AS worker

ENV PORT=3003
WORKDIR /app

COPY --from=builder --chown=node:node /runtime/worker ./

USER node
EXPOSE 3003
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3003/healthz').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
