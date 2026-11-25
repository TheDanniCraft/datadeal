# syntax=docker/dockerfile:1.10
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS node

FROM node AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/scanner/package.json packages/scanner/package.json
COPY packages/scoring/package.json packages/scoring/package.json
COPY packages/ui/package.json packages/ui/package.json

# The licensed installer reads this process variable. Its home and cache are ephemeral.
RUN --mount=type=secret,id=heroui_auth_token,env=HEROUI_AUTH_TOKEN,required=true \
    --mount=type=tmpfs,target=/root \
    test -n "$HEROUI_AUTH_TOKEN" && bun --no-env-file install --frozen-lockfile

ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY apps/web/ apps/web/
COPY packages/ packages/
RUN bun --no-env-file run --cwd apps/web build:standalone

FROM node AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone/ ./
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
