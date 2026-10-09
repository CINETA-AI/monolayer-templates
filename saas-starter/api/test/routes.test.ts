import fs from 'node:fs'
import path from 'node:path'
import type pg from 'pg'
import { describe, expect, it } from 'vitest'

import type { Auth } from '../src/auth.js'
import { loadConfig } from '../src/config.js'
import { issueCsrfToken } from '../src/csrf.js'
import { buildApp } from '../src/routes.js'

const ORIGIN = 'https://d123.cloudfront.net'
const cfg = loadConfig({
  APP_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@db:5432/app',
  PUBLIC_URL: ORIGIN,
  SESSION_SECRET: 's'.repeat(48),
  CSRF_SECRET: 'c'.repeat(32),
})

type Who = { mfa?: boolean; org?: string | null; role?: string }

/** Better Auth stand-in: just enough of auth.api for the guard. */
function fakeAuth(who?: Who): Auth {
  const session = who && {
    session: { id: 'sess-1', activeOrganizationId: who.org === undefined ? 'orgA' : who.org },
    user: { id: 'user-1', email: 'a@example.com', name: 'A', twoFactorEnabled: who.mfa ?? true },
  }
  return {
    handler: async () => new Response('better-auth'),
    api: {
      getSession: async () => session ?? null,
      getActiveMember: async () => (who?.role ? { role: who.role } : null),
      listMembers: async () => ({ members: [], total: 0 }),
      registerSSOProvider: async ({ body }: { body: unknown }) => body,
    },
  } as unknown as Auth
}

/** A pool whose client answers every query with one row, recording what ran. */
function fakePool(log: string[] = []): pg.Pool {
  const client = {
    query: async (text: string) => {
      log.push(text)
      return { rows: [{ id: '00000000-0000-0000-0000-000000000001', title: 't' }] }
    },
    release: () => {},
  }
  return { connect: async () => client } as unknown as pg.Pool
}

function call(who: Who | undefined, method: string, url: string, init: { csrf?: boolean; origin?: string } = {}) {
  const { app } = buildApp({ cfg, auth: fakeAuth(who), pool: fakePool() })
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.origin !== undefined) headers.origin = init.origin
  if (init.csrf) headers['x-csrf-token'] = issueCsrfToken(cfg.csrfSecret, 'sess-1')
  const body = method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify({ title: 'hello' })
  return app.request(url, { method, headers, body })
}

const routes = buildApp({ cfg, auth: fakeAuth(), pool: fakePool() }).routes
const concrete = (p: string) => p.replace(':id', '00000000-0000-0000-0000-000000000001')

describe('deny by default', () => {
  it('only the health check is public', () => {
    const open = routes.filter((r) => 'public' in r.access).map((r) => `${r.method} ${r.path}`)
    expect(open).toEqual(['GET /api/health'])
  })

  it.each(routes.filter((r) => !('public' in r.access)))('$method $path needs a session', async (r) => {
    const res = await call(undefined, r.method, concrete(r.path), { csrf: true, origin: ORIGIN })
    expect(res.status).toBe(401)
  })

  it('undeclared API paths are 404, not open', async () => {
    expect((await call({ role: 'owner' }, 'GET', '/api/admin/export')).status).toBe(404)
    expect((await call({ role: 'owner' }, 'PUT', '/api/notes')).status).toBe(404)
  })

  it('routes are only added through the guarded registry', () => {
    const dir = path.resolve(import.meta.dirname, '../src')
    for (const file of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8')
      expect(src, file).not.toMatch(/\bapp\.(get|post|put|patch|delete)\(/)
      const ons = src.match(/\bapp\.on\(/g) ?? []
      // routes.ts: the Better Auth mount + the registry's own app.on. Nowhere else.
      expect(ons.length, file).toBe(file === 'routes.ts' ? 2 : 0)
    }
  })
})

describe('MFA', () => {
  it('blocks tenant data until a second factor is enrolled', async () => {
    const res = await call({ mfa: false, role: 'owner' }, 'GET', '/api/notes')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'mfa_required' })
  })

  it('still lets the user reach the enrollment-flow endpoints', async () => {
    expect((await call({ mfa: false }, 'GET', '/api/me')).status).toBe(200)
    expect((await call({ mfa: false }, 'GET', '/api/csrf')).status).toBe(200)
  })
})

describe('RBAC', () => {
  it('requires an active organization', async () => {
    const res = await call({ org: null, role: 'owner' }, 'GET', '/api/notes')
    expect(await res.json()).toEqual({ error: 'no_active_organization' })
  })

  it('requires membership in it', async () => {
    expect((await call({}, 'GET', '/api/notes')).status).toBe(403)
  })

  it.each([
    ['member', 'GET', '/api/notes', 200],
    ['member', 'POST', '/api/notes', 201],
    ['member', 'DELETE', '/api/notes/:id', 403],
    ['admin', 'DELETE', '/api/notes/:id', 204],
    ['member', 'GET', '/api/audit', 403],
    ['admin', 'GET', '/api/audit', 200],
    ['member', 'POST', '/api/sso/providers', 403],
    ['owner', 'POST', '/api/sso/providers', 201],
    ['member,admin', 'GET', '/api/audit', 200],
    ['superuser', 'GET', '/api/notes', 403],
  ] as const)('%s %s %s -> %i', async (role, method, url, status) => {
    const res = await call({ role }, method, concrete(url), { csrf: true, origin: ORIGIN })
    expect(res.status).toBe(status)
  })

  it('binds a new SSO provider to the caller organization, ignoring the body', async () => {
    const { app } = buildApp({ cfg, auth: fakeAuth({ role: 'admin' }), pool: fakePool() })
    const res = await app.request('/api/sso/providers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        'x-csrf-token': issueCsrfToken(cfg.csrfSecret, 'sess-1'),
      },
      body: JSON.stringify({ providerId: 'okta', organizationId: 'orgB' }),
    })
    expect(((await res.json()) as any).provider.organizationId).toBe('orgA')
  })
})

describe('CSRF', () => {
  it('rejects a mutation without the token', async () => {
    const res = await call({ role: 'owner' }, 'POST', '/api/notes', { origin: ORIGIN })
    expect(await res.json()).toEqual({ error: 'csrf' })
  })

  it('rejects a mutation from another origin', async () => {
    const res = await call({ role: 'owner' }, 'POST', '/api/notes', { csrf: true, origin: 'https://evil.example' })
    expect(await res.json()).toEqual({ error: 'bad_origin' })
  })

  it('runs tenant queries as the RLS role with the tenant pinned', async () => {
    const log: string[] = []
    const { app } = buildApp({ cfg, auth: fakeAuth({ role: 'member' }), pool: fakePool(log) })
    await app.request('/api/notes')
    expect(log).toContain('SET LOCAL ROLE app_tenant')
    expect(log.some((q) => q.includes("set_config('app.tenant_id'"))).toBe(true)
  })
})

describe('headers', () => {
  it('never lets API responses be cached', async () => {
    const res = await call(undefined, 'GET', '/api/health')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
