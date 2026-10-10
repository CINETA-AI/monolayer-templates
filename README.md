# Monolayer templates

One-click application templates for Monolayer, plus the hardened image family they all run on.
Deploying a template creates the whole stack in the customer's AWS account: networking, database,
services, and a public HTTPS gateway. There is nothing to configure by hand.

| Path | What it is |
| --- | --- |
| [`images/base`](images/base/Dockerfile) | `monolayer/base:debian12-slim`, the one OS layer every template image builds on |
| [`images/node22`](images/node22/Dockerfile) | `monolayer/node:22`, Node.js 22 on that base |
| [`saas-starter/`](saas-starter/README.md) | SaaS starter: Next.js web, API, Postgres and a gateway, secure by default |
| [`.github/workflows/build.yml`](.github/workflows/build.yml) | Tests every template, builds base → runtime → apps, scans, publishes |

The template **manifests** live in the Monolayer app repo
(`backend/internal/svc/core/templates/*.json`). A manifest says which images to run, how the
services connect, and the questions asked when the template is added to a project. This repo
holds the code and images those manifests point at.

## One base image, reused everywhere

Every template image is built `FROM` the same base:

```
debian:bookworm-slim ─▶ monolayer/base:debian12-slim ─▶ monolayer/node:22 ─▶ saas-starter-api
                                                                         └─▶ saas-starter-web
                                                     (later: monolayer/python:3.12, …)
```

Reusing one base means:

- **Patched once.** An OS fix means one base rebuild. CI rebuilds everything on top of it every
  week.
- **Scanned once.** It is a single thing to approve and to show auditors.
- **Pulled once.** Layers are shared across templates and environments.
- **Consistent everywhere.** Same glibc, CA bundle, timezone data, user and PID 1 in every image.

What the base contains:

- **Packages:** the OS packages, fully upgraded at build time, plus `ca-certificates`, `tzdata`
  and `tini` as PID 1.
- **RDS CA bundle:** the Amazon RDS CA bundle, so database TLS is verified and not only
  encrypted.
- **User:** a non-root `app` user, uid 10001.
- **Hardening:** no shell, no apt/dpkg binaries and no setuid bits at runtime. The image is
  flattened `FROM scratch`. dpkg's database is kept so ECR and Trivy still see every package.

## Publishing

On every push to `main` and every Monday, CI builds and scans all images. It publishes them to
ECR Public under `public.ecr.aws/monolayer/…`, each with a moving tag and a dated immutable tag.
See the header of [`build.yml`](.github/workflows/build.yml) for the one secret it needs.
