FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun-tool

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS node-runtime
ENV NODE_ENV=production
WORKDIR /app

FROM node-runtime AS manifests
COPY --from=bun-tool /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
COPY apps/extension/package.json apps/extension/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/scanner/package.json packages/scanner/
COPY packages/scoring/package.json packages/scoring/
COPY packages/ui/package.json packages/ui/

FROM manifests AS migrate-deps
RUN bun install --frozen-lockfile --production --filter @datadeal/database

FROM node-runtime AS migrate
COPY --from=migrate-deps /app /app
COPY packages/database/migrate.mjs packages/database/compose-migrate.mjs packages/database/
COPY packages/database/migrations packages/database/migrations
USER node
CMD ["node", "packages/database/compose-migrate.mjs"]

FROM manifests AS worker-deps
RUN bun install --frozen-lockfile --production --filter @datadeal/worker
COPY apps/worker apps/worker
COPY packages/ai packages/ai
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY packages/scanner packages/scanner
COPY packages/scoring packages/scoring
COPY tsconfig.base.json ./

FROM node-runtime AS worker
COPY --from=worker-deps /app /app
WORKDIR /app/apps/worker
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
# The non-root worker uses deploy/chromium-seccomp.json, based on
# https://raw.githubusercontent.com/microsoft/playwright/v1.65.1/utils/docker/seccomp_profile.json
# It additionally permits the zygote's chroot syscall inside a user namespace
# with all capabilities dropped in the outer container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates poppler-utils \
    && node node_modules/playwright/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*
USER node
CMD ["node", "--import", "tsx", "index.ts"]

FROM worker-deps AS egress-build
RUN bun --no-env-file build apps/worker/browser-egress.mts --target=node --format=esm --outfile=/tmp/browser-egress.mjs \
    && mkdir -p /tmp/egress-licenses \
    && cp packages/scanner/node_modules/ipaddr.js/LICENSE /tmp/egress-licenses/ipaddr.js.txt \
    && cp packages/contracts/node_modules/zod/LICENSE /tmp/egress-licenses/zod.txt

FROM node-runtime AS egress
COPY --from=egress-build /tmp/browser-egress.mjs ./browser-egress.mjs
COPY --from=egress-build /tmp/egress-licenses ./licenses
USER node
CMD ["node", "browser-egress.mjs"]
