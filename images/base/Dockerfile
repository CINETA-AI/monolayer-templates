# syntax=docker/dockerfile:1.7
#
# monolayer/base — the ONE OS layer every Monolayer template image builds on.
# Patched, scanned and approved once; reused by every template and environment.
#
#  - Debian 12 slim, fully upgraded at build time (rebuilt weekly in CI)
#  - CA certificates, timezone data, tini as PID 1, and the Amazon RDS CA bundle
#    (so database TLS can be verified, not just encrypted)
#  - non-root `app` user, uid/gid 10001
#  - no shell, no package manager at runtime: the final image is a flattened copy
#    with them removed. dpkg's database stays so scanners (ECR, Trivy) still see
#    every installed package and its version.

FROM debian:bookworm-slim AS rootfs
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get -y upgrade \
 && apt-get install -y --no-install-recommends ca-certificates tzdata tini libstdc++6 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt /var/log/*
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
# Strip setuid bits, package managers and finally the shells (this RUN's own shell is
# already in memory, so removing it last is safe).
RUN chmod 0644 /etc/ssl/certs/rds-global-bundle.pem \
 && grep -q "BEGIN CERTIFICATE" /etc/ssl/certs/rds-global-bundle.pem \
 && groupadd --gid 10001 app \
 && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin app \
 && mkdir -p /app && chmod 0755 /app && chmod 1777 /tmp \
 && rm -rf /usr/share/doc /usr/share/man /usr/share/info /usr/share/lintian \
 && rm -f /usr/bin/apt /usr/bin/apt-get /usr/bin/apt-cache /usr/bin/apt-config /usr/bin/apt-key /usr/bin/apt-mark \
          /usr/bin/dpkg /usr/bin/dpkg-deb /usr/bin/dpkg-query /usr/bin/dpkg-split /usr/bin/dpkg-divert \
          /usr/bin/su /usr/bin/passwd /usr/bin/chsh /usr/bin/chfn /usr/bin/newgrp /usr/bin/gpasswd \
 && find / -xdev -perm /6000 -type f -exec chmod a-s {} + \
 && rm -f /usr/bin/bash /usr/bin/rbash /usr/bin/dash /usr/bin/sh /bin/sh /bin/bash /bin/dash

FROM scratch
COPY --from=rootfs / /
ENV TZ=UTC \
    LANG=C.UTF-8 \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
WORKDIR /app
USER 10001:10001
ENTRYPOINT ["/usr/bin/tini", "--"]
LABEL org.opencontainers.image.title="monolayer/base" \
      org.opencontainers.image.description="Hardened Debian 12 base for Monolayer template images" \
      org.opencontainers.image.source="https://github.com/CINETA-AI/monolayer-templates"
