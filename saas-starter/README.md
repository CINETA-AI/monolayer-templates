# SaaS starter

A multi-tenant SaaS skeleton that is secure by default. Deployed by Monolayer as:

```
browser ──HTTPS──▶ gateway (CloudFront) ──VPC origin──▶ internal ALB ─┬─ /api/* ─▶ api (ECS) ──TLS──▶ Postgres (RDS)
                                                                    └─ /*     ─▶ web (ECS)
```

Only the gateway is public. The ALB, both services and the database sit in the project's private
network. Each environment (production, staging, preview) is its own project with its own
database, credentials and secrets.

## What's built in

| Requirement | Where |
| --- | --- |
| Sign-in: email + password (12+ chars) | Better Auth, mounted in the API at `/api/auth/*` ([auth.ts](api/src/auth.ts)) |
| MFA (TOTP + backup codes), required by default | [routes.ts](api/src/routes.ts) guard; enrollment at `/settings/security` |
| SSO, OIDC or SAML, per organization | Admins connect their IdP at `/settings/sso`. It only works after the admin proves domain ownership with a DNS TXT record. |
| Secure cookies | `__Secure-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, 12h sessions |
| CSRF | Origin check plus a session-bound HMAC token on every mutating API call ([csrf.ts](api/src/csrf.ts)). Better Auth protects its own endpoints. |
| RBAC: owner / admin / member, deny by default | Every route declares `public`, `session` or a permission ([rbac.ts](api/src/rbac.ts)). Undeclared `/api/*` paths return 404. A test fails if a route bypasses the registry. |
| Tenant isolation | Postgres row-level security, enabled and FORCED, with tenant work run as a role without BYPASSRLS ([db.ts](api/src/db.ts)). Optionally a schema per tenant on top. |
| Only the gateway is public | Both services are deployed with `public: false` |
| Encrypted DB, backups, point-in-time recovery | The template's RDS node: encrypted storage, daily backups with PITR, TLS verified against the RDS CA |
| Synthetic seed in preview | `SEED_MODE=synthetic` gives every new preview user a "Demo Co" tenant of fake data. Refused in production. |
| Audit log | Per tenant, under RLS like everything else (`/audit`, admins) |

## Configuration

The platform injects all of these, so there is nothing to set by hand:

| Variable | Service | Source |
| --- | --- | --- |
| `DATABASE_URL` | api | the api → db canvas connection |
| `PUBLIC_URL` | api | the gateway's `https://…cloudfront.net` URL |
| `SESSION_SECRET`, `CSRF_SECRET` | api | generated in the customer's account (SSM, create-once) |
| `APP_ENV`, `TENANCY_MODE`, `SEED_MODE` | api | the template manifest (`APP_ENV` also goes to web) |
| `API_URL`, `API_PRIVATE_URL` | web | the web → api connection (used only by the local-dev `/api` proxy) |

Optional: `MFA_REQUIRED=false` turns off the MFA requirement. `PGSSLMODE` / `PGSSLROOTCERT`
override database TLS.

## Local development

No Docker needed. You need three terminals:

```bash
cd api && npm install && npm run db      # in-memory Postgres on :5432
```

```bash
cd api && npm run dev                    # API on :8080 (migrates on boot)
```

```bash
cd web && npm install && npm run dev     # http://localhost:3000
```

With Docker, `docker compose up --build` runs the same three services.

```bash
cd api && npm test     # unit + RLS + end-to-end (real Postgres via PGlite)
cd web && npm run build
```
