# syntax=docker/dockerfile:1.7
ARG RUNTIME=public.ecr.aws/monolayer/node:22

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production dependencies only, installed clean. --omit=optional matters: better-auth
# lists vitest as an optional peer, so `npm prune --omit=dev` would keep the whole test
# toolchain (vitest, vite, esbuild…) in the image. Nothing the API runs is optional.
FROM node:22-bookworm-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund

# Runtime: the shared hardened base. App files are root-owned and read-only to the
# non-root user the base runs as.
FROM ${RUNTIME}
COPY --from=deps /src/package.json /app/package.json
COPY --from=deps /src/node_modules /app/node_modules
COPY --from=build /src/dist /app/dist
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server.js"]
