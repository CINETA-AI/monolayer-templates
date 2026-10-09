# syntax=docker/dockerfile:1.7
#
# monolayer/node:22 — Node.js 22 LTS on monolayer/base. Only the `node` binary is
# copied in (no npm/npx/corepack at runtime). Build your app in a node:22 build stage
# and COPY the output onto this image.

ARG BASE=public.ecr.aws/monolayer/base:debian12-slim
FROM node:22-bookworm-slim AS node

FROM ${BASE}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production
LABEL org.opencontainers.image.title="monolayer/node" \
      org.opencontainers.image.description="Node.js 22 on monolayer/base" \
      org.opencontainers.image.source="https://github.com/CINETA-AI/monolayer-templates"
CMD ["node", "--version"]
