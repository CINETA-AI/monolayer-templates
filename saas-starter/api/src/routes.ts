import { Hono, type Context } from 'hono'
import type pg from 'pg'

import { SSO_DNS_PREFIX, type Auth } from './auth.js'
import type { Config } from './config.js'
import { MUTATING, issueCsrfToken, originAllowed, verifyCsrfToken } from './csrf.js'
import { withTenant, type Queryable } from './db.js'
import { allows, isRole, type Access, type Role } from './rbac.js'
import { ensurePreviewTenant } from './seed.js'
import { API } from './paths.js'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type RouteSpec = { method: Method; path: string; access: Access }

type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

/** What a guarded handler gets. tenantId/role/db are set for permission routes. */
export type RouteContext = {
  session?: Session
  tenantId?: string
  role?: Role
  /** Run queries scoped to the caller's tenant (RLS / tenant schema). */
  tenant?: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>
}

type Handler = (c: Context, ctx: RouteContext) => Response | Promise<Response>

export type Deps = { cfg: Config; auth: Auth; pool: pg.Pool }

/** A member can hold several comma-separated roles; the highest one counts. */
function highestRole(raw: unknown): Role | undefined {
  const roles = String(raw ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(isRole)
  for (const r of ['owner', 'admin', 'member'] as const) if (roles.includes(r)) return r
  return undefined
}

export function buildApp({ cfg, auth, pool }: Deps): { app: Hono; routes: RouteSpec[] } {
  const app = new Hono()
  const routes: RouteSpec[] = []

  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
  })

  // Better Auth owns /api/auth/* (sign-up/in, sessions, organizations, 2FA, SSO) —
  // except SSO provider management: Better Auth only checks org membership there, so
  // those go through the admin-only routes below instead.
  const ssoAdminEndpoints = new Set([`${API}/auth/sso/register`, `${API}/auth/sso/update-provider`, `${API}/auth/sso/delete-provider`])
  app.on(['GET', 'POST'], `${API}/auth/*`, async (c): Promise<Response> => {
    if (ssoAdminEndpoints.has(c.req.path)) return c.json({ error: 'not_found' }, 404)
    return auth.handler(c.req.raw)
  })

  const guard =
    (spec: RouteSpec, handler: Handler) =>
    async (c: Context): Promise<Response> => {
      const { access } = spec
      if ('public' in access) return handler(c, {})

      const headers = c.req.raw.headers
      const session = await auth.api.getSession({ headers })
      if (!session) return c.json({ error: 'unauthenticated' }, 401)

      if (MUTATING.has(spec.method)) {
        if (!originAllowed(spec.method, c.req.header('origin'), cfg.publicUrl)) {
          return c.json({ error: 'bad_origin' }, 403)
        }
        if (!verifyCsrfToken(cfg.csrfSecret, session.session.id, c.req.header('x-csrf-token'))) {
          return c.json({ error: 'csrf' }, 403)
        }
      }

      const mfaDone = !cfg.mfaRequired || Boolean(session.user.twoFactorEnabled)
      if ('session' in access) {
        if (!mfaDone && !access.allowWithoutMfa) return c.json({ error: 'mfa_required' }, 403)
        return handler(c, { session })
      }
      if (!mfaDone) return c.json({ error: 'mfa_required' }, 403)

      const tenantId = session.session.activeOrganizationId
      if (!tenantId) return c.json({ error: 'no_active_organization' }, 403)
      const member = await auth.api.getActiveMember({ headers }).catch(() => null)
      const role = highestRole(member?.role)
      if (!role || !allows(role, access.permission)) return c.json({ error: 'forbidden' }, 403)

      return handler(c, {
        session,
        tenantId,
        role,
        tenant: (fn) => withTenant(pool, cfg.tenancy, tenantId, fn),
      })
    }

  /** The ONLY way to add an API route: access is mandatory, so nothing is open by accident. */
  const route = (method: Method, path: string, access: Access, handler: Handler) => {
    const spec = { method, path, access }
    routes.push(spec)
    app.on(method, path, guard(spec, handler))
  }

  route('GET', `${API}/health`, { public: true }, (c) => c.json({ ok: true }))

  route('GET', `${API}/csrf`, { session: true, allowWithoutMfa: true }, (c, { session }) =>
    c.json({ token: issueCsrfToken(cfg.csrfSecret, session!.session.id) }),
  )

  route('GET', `${API}/me`, { session: true, allowWithoutMfa: true }, async (c, { session }) => {
    const s = session!
    let activeOrganizationId = s.session.activeOrganizationId ?? null
    // Preview environments give each new user a tenant full of synthetic data.
    if (!activeOrganizationId && cfg.seedMode === 'synthetic' && cfg.appEnv !== 'production') {
      activeOrganizationId = await ensurePreviewTenant({ cfg, auth, pool }, c.req.raw.headers, s.user.id)
    }
    const member = activeOrganizationId
      ? await auth.api.getActiveMember({ headers: c.req.raw.headers }).catch(() => null)
      : null
    return c.json({
      user: { id: s.user.id, email: s.user.email, name: s.user.name },
      mfaEnabled: Boolean(s.user.twoFactorEnabled),
      mfaRequired: cfg.mfaRequired,
      activeOrganizationId,
      role: highestRole(member?.role) ?? null,
      tenancy: cfg.tenancy,
      environment: cfg.appEnv,
    })
  })

  route('GET', `${API}/notes`, { permission: 'notes:read' }, async (c, { tenant }) => {
    const rows = await tenant!(async (db) => {
      const { rows } = await db.query(
        'SELECT id, title, body, created_by, created_at FROM notes ORDER BY created_at DESC LIMIT 100',
      )
      return rows
    })
    return c.json({ notes: rows })
  })

  route('POST', `${API}/notes`, { permission: 'notes:write' }, async (c, { tenant, session }) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: unknown; body?: unknown }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const text = typeof body.body === 'string' ? body.body : ''
    if (title.length < 1 || title.length > 200) return c.json({ error: 'title must be 1-200 characters' }, 400)
    const note = await tenant!(async (db) => {
      const { rows } = await db.query(
        'INSERT INTO notes (title, body, created_by) VALUES ($1, $2, $3) RETURNING id, title, body, created_by, created_at',
        [title, text, session!.user.id],
      )
      await db.query(`INSERT INTO audit_log (actor, action, target) VALUES ($1, 'note.create', $2)`, [
        session!.user.id,
        rows[0].id,
      ])
      return rows[0]
    })
    return c.json({ note }, 201)
  })

  route('DELETE', `${API}/notes/:id`, { permission: 'notes:delete' }, async (c, { tenant, session }) => {
    const id = c.req.param('id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'not_found' }, 404)
    const deleted = await tenant!(async (db) => {
      const { rows } = await db.query('DELETE FROM notes WHERE id = $1 RETURNING id', [id])
      if (rows.length > 0) {
        await db.query(`INSERT INTO audit_log (actor, action, target) VALUES ($1, 'note.delete', $2)`, [
          session!.user.id,
          id,
        ])
      }
      return rows.length > 0
    })
    return deleted ? c.body(null, 204) : c.json({ error: 'not_found' }, 404)
  })

  route('GET', `${API}/members`, { permission: 'members:read' }, async (c, { tenantId }) => {
    const res = await auth.api.listMembers({ query: { organizationId: tenantId }, headers: c.req.raw.headers })
    return c.json(res)
  })

  // Enterprise SSO: an org admin registers their IdP (OIDC or SAML). It is always bound
  // to the caller's own organization, whatever the body says.
  route('POST', `${API}/sso/providers`, { permission: 'sso:manage' }, async (c, { tenantId }) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const provider = await auth.api.registerSSOProvider({
      body: { ...(body as any), organizationId: tenantId },
      headers: c.req.raw.headers,
    })
    return c.json(
      {
        provider,
        // Publish this, then call POST /account/api/auth/sso/verify-domain { providerId }.
        dnsRecord: {
          type: 'TXT',
          name: `_${SSO_DNS_PREFIX}-${provider.providerId}.${provider.domain}`,
          value: provider.domainVerificationToken,
        },
      },
      201,
    )
  })

  route('DELETE', `${API}/sso/providers/:providerId`, { permission: 'sso:manage' }, async (c, { tenantId }) => {
    const providerId = c.req.param('providerId') ?? ''
    const { providers } = await auth.api.listSSOProviders({ headers: c.req.raw.headers })
    if (!providers.some((p) => p.providerId === providerId && p.organizationId === tenantId)) {
      return c.json({ error: 'not_found' }, 404)
    }
    await auth.api.deleteSSOProvider({ body: { providerId }, headers: c.req.raw.headers })
    return c.body(null, 204)
  })

  route('GET', `${API}/audit`, { permission: 'audit:read' }, async (c, { tenant }) => {
    const rows = await tenant!(async (db) => {
      const { rows } = await db.query(
        'SELECT id, actor, action, target, created_at FROM audit_log ORDER BY created_at DESC LIMIT 200',
      )
      return rows
    })
    return c.json({ events: rows })
  })

  // Deny by default: anything under /api that wasn't declared above.
  app.all(`${API}/*`, (c) => c.json({ error: 'not_found' }, 404))

  return { app, routes }
}
