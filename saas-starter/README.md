# SaaS starter

A multi-tenant SaaS skeleton that is secure by default. Deployed by Monolayer as:

```
browser ──HTTPS──▶ gateway (CloudFront) ──▶ internal ALB ─┬─ /account/api/* ─▶ api ──TLS──▶ Postgres (RDS)
                                                          ├─ /account/*     ─▶ web: sign-in, members, SSO, security
                                                          ├─ /api/*         ─▶ your backend, if you picked one
                                                          └─ /*             ─▶ your frontend, if you picked one
                                                                               — otherwise web
```

Only the gateway is public. The ALB, the services and the database sit in the project's private
network. Adding the template to a project puts these nodes on its canvas as one group named
"SaaS starter"; they use that project's network and compliance settings, and removing the group
tears them all down.

Everything under `/account` belongs to the template: the dashboard at `/account/*` (a Next.js
`basePath`) and the API at `/account/api/*`. The rest of the URL is yours. Without your own
frontend the dashboard is also the gateway's catch-all, and `/` redirects to `/account`.

## Your own frontend

When adding the template you can pick a GitHub repository as the frontend. Monolayer builds it like
any other repo service (and redeploys it on every push to its branch), runs it privately, and the
gateway serves it at `/`. It shares the origin with the API, so it uses the template's sign-in and
sessions as they are, with no CORS and no tokens to store:

| Need | Do |
| --- | --- |
| Who is signed in | `GET /account/api/me` with `credentials: 'same-origin'`. 401 `unauthenticated` means signed out. |
| Sign in / sign up | Send the browser to `/account/login?next=/` (or `/account/signup?next=/`). Email, SSO and MFA all happen there, then it returns to `next`. |
| No organization yet | `/account/api/me` has `activeOrganizationId: null`. Send them to `/account/onboarding?next=/`. |
| MFA not enrolled | API calls answer 403 `mfa_required`. Send them to `/account/settings/security?next=/`. |
| Writes to the template API | Get a token from `GET /account/api/csrf` and send it as the `x-csrf-token` header. |
| Your backend (if you picked one) | Call it at `/api/*`, same origin. Server-side code can use `BACKEND_PRIVATE_URL` (injected). |
| Server-side calls to the template API | `API_PRIVATE_URL` (injected) reaches it inside the network. Forward the visitor's `cookie` header. |
| Admin pages (members, SSO, audit log) | Link to `/account/members`, `/account/settings/sso`, `/account/audit`. |

Your app must listen on `$PORT` (the platform sets it). Most frameworks do by default, and static
sites built by Railpack are served on it automatically. Keep `/account/*` (and `/api/*` if you
picked a backend) free: the gateway sends those paths elsewhere.

## Your own backend

You can also pick a GitHub repository as the backend. The gateway serves it at `/api/*`, so a
frontend that already calls `/api/...` works unchanged. It gets:

| What | How |
| --- | --- |
| Its own database | A database and login of its own inside the template's Postgres, injected as `DATABASE_URL` (plus `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`). The login owns that database and nothing else: it can't connect to the template's database (users, sessions, SSO secrets). The password is generated in your AWS account and never leaves it. |
| Its tables | Whatever "Before deploy, run" command you give (for example `npx prisma migrate deploy` or `npm run migrate`) runs in a one-off container from the new image, with the same env, before the new version replaces the old one. If it fails, the deploy stops and the old version keeps running. Monolayer suggests the command from what it finds in the repo. |
| Who the caller is | Forward the visitor's `cookie` header to `$API_PRIVATE_URL/account/api/me`: 200 gives the user, `activeOrganizationId` and `role`; 401 means signed out. Store that organization ID on your rows to keep each tenant's data apart. |
| Writes from the browser | The cookie is sent with every same-origin request, so protect your own `POST`/`PUT`/`PATCH`/`DELETE` routes against CSRF (at least check that `Origin` matches `PUBLIC_URL`). |

The database requires TLS. `PGSSLMODE=require` encrypts the connection; libpq-based clients
(psql, psycopg, Prisma) use it as is. For node-postgres, set `ssl` in code, because recent versions
treat `sslmode=require` in a URL as full certificate verification.

## What's built in

| Requirement | Where |
| --- | --- |
| Sign-in: email + password (12+ chars) | Better Auth, mounted in the API at `/account/api/auth/*` ([auth.ts](api/src/auth.ts)) |
| MFA (TOTP + backup codes), required by default | [routes.ts](api/src/routes.ts) guard; enrollment at `/account/settings/security` |
| SSO, OIDC or SAML, per organization | Admins connect their IdP at `/account/settings/sso`. It only works after the admin proves domain ownership with a DNS TXT record. |
| Secure cookies | `__Secure-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, 12h sessions |
| CSRF | Origin check plus a session-bound HMAC token on every mutating API call ([csrf.ts](api/src/csrf.ts)). Better Auth protects its own endpoints. |
| RBAC: owner / admin / member, deny by default | Every route declares `public`, `session` or a permission ([rbac.ts](api/src/rbac.ts)). Undeclared `/account/api/*` paths return 404. A test fails if a route bypasses the registry. |
| Tenant isolation | Postgres row-level security, enabled and FORCED, with tenant work run as a role without BYPASSRLS ([db.ts](api/src/db.ts)). Optionally a schema per tenant on top. |
| Only the gateway is public | Both services are deployed with `public: false` |
| Encrypted DB, backups, point-in-time recovery | The template's RDS node: encrypted storage, daily backups with PITR, TLS verified against the RDS CA |
| Synthetic seed (optional) | Set `SEED_MODE=synthetic` (with `APP_ENV` other than `production`) and every new user gets a "Demo Co" tenant of fake data. Refused in production. |
| Audit log | Per tenant, under RLS like everything else (`/account/audit`, admins) |

## Configuration

The platform injects all of these, so there is nothing to set by hand:

| Variable | Service | Source |
| --- | --- | --- |
| `DATABASE_URL` | api | the api → db canvas connection (the database's admin login) |
| `MONOLAYER_DB_APP_USERS` | api | the databases and logins to create for your backend ([app-databases.ts](api/src/app-databases.ts)); passwords generated in your account |
| `PUBLIC_URL` | api | the gateway's `https://…cloudfront.net` URL |
| `SESSION_SECRET`, `CSRF_SECRET` | api | generated in the customer's account (SSM, create-once) |
| `APP_ENV`, `TENANCY_MODE` | api | the template manifest (`APP_ENV` also goes to web) |
| `API_URL`, `API_PRIVATE_URL` | web, your frontend | the web → api and frontend → api connections |
| `PUBLIC_URL` | web, your frontend, your backend | the gateway's URL, as for the api |
| `DATABASE_URL`, `PG*` | your backend | its own database and login (see above) |
| `API_URL`, `API_PRIVATE_URL` | your backend | the backend → api connection |
| `BACKEND_URL`, `BACKEND_PRIVATE_URL` | your frontend | the frontend → backend connection |

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
cd web && npm install && npm run dev     # http://localhost:3000/account
```

With Docker, `docker compose up --build` runs the same three services.

```bash
cd api && npm test     # unit + RLS + end-to-end (real Postgres via PGlite)
cd web && npm run build
```
