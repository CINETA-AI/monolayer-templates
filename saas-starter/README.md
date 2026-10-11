# SaaS starter

A multi-tenant SaaS skeleton that is secure by default. Deployed by Monolayer as:

```
browser ──HTTPS──▶ gateway (CloudFront) ──VPC origin──▶ internal ALB ─┬─ /api/*     ─▶ api (ECS) ──TLS──▶ Postgres (RDS)
                                                                    ├─ /account/* ─▶ web (ECS): sign-in, members, SSO, security
                                                                    └─ /*         ─▶ your frontend (ECS), if you picked one
                                                                                     — otherwise web
```

Only the gateway is public. The ALB, the services and the database sit in the project's private
network. Adding the template to a project puts these nodes on its canvas as one group named
"SaaS starter"; they use that project's network and compliance settings, and removing the group
tears them all down.

The web app always lives under `/account` (a Next.js `basePath`). Without your own frontend it is
also the gateway's catch-all, and `/` redirects to `/account`.

## Your own frontend

When adding the template you can pick a GitHub repository as the frontend. Monolayer builds it like
any other repo service (and redeploys it on every push to its branch), runs it privately on ECS, and
the gateway serves it at `/`. It shares the origin with the API, so it uses the template's sign-in
and sessions as they are, with no CORS and no tokens to store:

| Need | Do |
| --- | --- |
| Who is signed in | `GET /api/me` with `credentials: 'same-origin'`. 401 `unauthenticated` means signed out. |
| Sign in / sign up | Send the browser to `/account/login?next=/` (or `/account/signup?next=/`). Email, SSO and MFA all happen there, then it returns to `next`. |
| No organization yet | `/api/me` has `activeOrganizationId: null`. Send them to `/account/onboarding?next=/`. |
| MFA not enrolled | API calls answer 403 `mfa_required`. Send them to `/account/settings/security?next=/`. |
| Writes (`POST`, `PUT`, `PATCH`, `DELETE`) | Get a token from `GET /api/csrf` and send it as the `x-csrf-token` header. |
| Server-side calls (SSR) | `API_PRIVATE_URL` (injected) reaches the API inside the network. Forward the visitor's `cookie` header. |
| Admin pages (members, SSO, audit log) | Link to `/account/members`, `/account/settings/sso`, `/account/audit`. |

Your app must listen on `$PORT` (the platform sets it). Most frameworks do by default, and static
sites built by Railpack are served on it automatically. Keep `/account/*` and `/api/*` free; the
gateway sends those paths to the template's services, not to your app.

## What's built in

| Requirement | Where |
| --- | --- |
| Sign-in: email + password (12+ chars) | Better Auth, mounted in the API at `/api/auth/*` ([auth.ts](api/src/auth.ts)) |
| MFA (TOTP + backup codes), required by default | [routes.ts](api/src/routes.ts) guard; enrollment at `/account/settings/security` |
| SSO, OIDC or SAML, per organization | Admins connect their IdP at `/account/settings/sso`. It only works after the admin proves domain ownership with a DNS TXT record. |
| Secure cookies | `__Secure-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, 12h sessions |
| CSRF | Origin check plus a session-bound HMAC token on every mutating API call ([csrf.ts](api/src/csrf.ts)). Better Auth protects its own endpoints. |
| RBAC: owner / admin / member, deny by default | Every route declares `public`, `session` or a permission ([rbac.ts](api/src/rbac.ts)). Undeclared `/api/*` paths return 404. A test fails if a route bypasses the registry. |
| Tenant isolation | Postgres row-level security, enabled and FORCED, with tenant work run as a role without BYPASSRLS ([db.ts](api/src/db.ts)). Optionally a schema per tenant on top. |
| Only the gateway is public | Both services are deployed with `public: false` |
| Encrypted DB, backups, point-in-time recovery | The template's RDS node: encrypted storage, daily backups with PITR, TLS verified against the RDS CA |
| Synthetic seed (optional) | Set `SEED_MODE=synthetic` (with `APP_ENV` other than `production`) and every new user gets a "Demo Co" tenant of fake data. Refused in production. |
| Audit log | Per tenant, under RLS like everything else (`/account/audit`, admins) |

## Configuration

The platform injects all of these, so there is nothing to set by hand:

| Variable | Service | Source |
| --- | --- | --- |
| `DATABASE_URL` | api | the api → db canvas connection |
| `PUBLIC_URL` | api | the gateway's `https://…cloudfront.net` URL |
| `SESSION_SECRET`, `CSRF_SECRET` | api | generated in the customer's account (SSM, create-once) |
| `APP_ENV`, `TENANCY_MODE` | api | the template manifest (`APP_ENV` also goes to web) |
| `API_URL`, `API_PRIVATE_URL` | web, your frontend | the web → api and frontend → api connections |
| `PUBLIC_URL` | web, your frontend | the gateway's URL, as for the api |

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
