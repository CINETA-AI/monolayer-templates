# syntax=docker/dockerfile:1.7
ARG RUNTIME=public.ecr.aws/monolayer/node:22

FROM node:22-bookworm-slim AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
# Only docker compose sets this: it bakes a /api proxy into the build (next.config.ts).
# The published image is built without it — behind the gateway /api/* never reaches web.
ARG API_URL=
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && mkdir -p .next/standalone/.next/cache

# Runtime: the shared hardened base. Next's standalone server needs only node.
# App files are root-owned and read-only; only the cache dir is writable.
FROM ${RUNTIME}
COPY --from=build /src/.next/standalone /app
COPY --from=build /src/.next/static /app/.next/static
COPY --from=build /src/public /app/public
COPY --from=build --chown=10001:10001 /src/.next/standalone/.next/cache /app/.next/cache
ENV PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["node", "server.js"]
