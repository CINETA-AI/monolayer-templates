import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { authOptions, createAuth } from '../src/auth.js'
import { loadConfig, type Config } from '../src/config.js'
import { migrate } from '../src/migrate.js'
import { buildApp } from '../src/routes.js'

// End to end against real Postgres (PGlite over the wire protocol): Better Auth's own
// migrations + sign-up + organizations, then the app's guarded, tenant-scoped routes.

const ORIGIN = 'https://d123.cloudfront.net'

/** Boots Postgres (PGlite over the wire), runs all migrations, returns the app. */
async function bootStack(env: Record<string, string>) {
  const db = await PGlite.create()
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 10 })
  await server.start()
  const port = (server as unknown as { server: { address(): { port: number } } }).server.address().port
  const cfg: Config = loadConfig({
    APP_ENV: 'staging',
    DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    PGSSLMODE: 'disable',
    PUBLIC_URL: ORIGIN,
    SESSION_SECRET: 's'.repeat(48),
    CSRF_SECRET: 'c'.repeat(32),
    MFA_REQUIRED: 'false', // the MFA gate itself is covered in routes.test.ts
    ...env,
  })
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 4 })
  await migrate(pool, cfg, authOptions(cfg, pool))
  const app = buildApp({ cfg, auth: createAuth(cfg, pool), pool }).app
  const close = async () => {
    await pool.end()
    await server.stop()
    await db.close()
  }
  return { app, close }
}

type App = Awaited<ReturnType<typeof bootStack>>['app']

/** A browser-ish client: keeps cookies, sends the app's Origin. */
function clientFor(app: App) {
  const jar = new Map<string, string>()
  let csrf = ''
  const send = async (method: string, url: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: ORIGIN }
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (csrf) headers['x-csrf-token'] = csrf
    const res = await app.request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const i = pair!.indexOf('=')
      jar.set(pair!.slice(0, i), pair!.slice(i + 1))
    }
    return res
  }
  return {
    send,
    jar,
    async signUpWithOrg(email: string, org: string) {
      expect((await send('POST', '/api/auth/sign-up/email', { email, password: 'correct horse battery', name: email })).status).toBe(200)
      const res = await send('POST', '/api/auth/organization/create', { name: org, slug: org.toLowerCase() })
      expect(res.status).toBe(200)
      const created = (await res.json()) as { id: string }
      await send('POST', '/api/auth/organization/set-active', { organizationId: created.id })
      csrf = ((await (await send('GET', '/api/csrf')).json()) as { token: string }).token
      return created.id
    },
  }
}

describe.each(['rls', 'schema'] as const)('e2e tenancy=%s', (tenancy) => {
  let stack: Awaited<ReturnType<typeof bootStack>>
  let app: App
  const client = () => clientFor(app)

  beforeAll(async () => {
    stack = await bootStack({ TENANCY_MODE: tenancy })
    app = stack.app
  }, 60_000)

  afterAll(async () => {
    await stack?.close()
  })

  it('signs up, gets a secure session cookie and an owner role', async () => {
    const a = client()
    await a.signUpWithOrg(`owner-${tenancy}@a.example`, `Acme-${tenancy}`)
    expect([...a.jar.keys()].some((k) => k.startsWith('__Secure-saas.'))).toBe(true)
    const me = (await (await a.send('GET', '/api/me')).json()) as { role: string; tenancy: string }
    expect(me.role).toBe('owner')
    expect(me.tenancy).toBe(tenancy)
  })

  it('signing in again lands back in the organization', async () => {
    const email = `back-${tenancy}@a.example`
    const orgId = await client().signUpWithOrg(email, `Back-${tenancy}`)
    const again = client()
    expect((await again.send('POST', '/api/auth/sign-in/email', { email, password: 'correct horse battery' })).status).toBe(200)
    const me = (await (await again.send('GET', '/api/me')).json()) as { activeOrganizationId: string; role: string }
    expect(me.activeOrganizationId).toBe(orgId)
    expect(me.role).toBe('owner')
  })

  it("keeps each organization's notes to itself", async () => {
    const a = client()
    const b = client()
    await a.signUpWithOrg(`a-${tenancy}@a.example`, `OrgA-${tenancy}`)
    await b.signUpWithOrg(`b-${tenancy}@b.example`, `OrgB-${tenancy}`)

    expect((await a.send('POST', '/api/notes', { title: 'a secret' })).status).toBe(201)
    expect((await b.send('POST', '/api/notes', { title: 'b secret' })).status).toBe(201)

    const notes = async (c: ReturnType<typeof clientFor>) =>
      ((await (await c.send('GET', '/api/notes')).json()) as { notes: { id: string; title: string }[] }).notes
    expect((await notes(a)).map((n) => n.title)).toEqual(['a secret'])
    expect((await notes(b)).map((n) => n.title)).toEqual(['b secret'])

    // B can't delete A's note even knowing its id.
    const aNote = (await notes(a))[0]!
    expect((await b.send('DELETE', `/api/notes/${aNote.id}`)).status).toBe(404)
    expect((await notes(a)).length).toBe(1)

    // Audit trail is per tenant too.
    const audit = (await (await a.send('GET', '/api/audit')).json()) as { events: { action: string }[] }
    expect(audit.events.map((e) => e.action)).toEqual(['note.create'])
  })

  it('lets an admin connect an OIDC IdP, usable only after DNS domain verification', async () => {
    const a = client()
    const orgId = await a.signUpWithOrg(`sso-${tenancy}@corp.example`, `Corp-${tenancy}`)
    const idp = 'https://idp.example.com'
    const body = {
      providerId: `okta-${tenancy}`,
      issuer: idp,
      domain: `corp-${tenancy}.example`,
      organizationId: 'someone-elses-org',
      oidcConfig: {
        clientId: 'client',
        clientSecret: 'secret',
        skipDiscovery: true,
        authorizationEndpoint: `${idp}/authorize`,
        tokenEndpoint: `${idp}/token`,
        jwksEndpoint: `${idp}/jwks`,
      },
    }
    // Better Auth's own register endpoint only checks membership — it's closed.
    expect((await a.send('POST', '/api/auth/sso/register', body)).status).toBe(404)

    const res = await a.send('POST', '/api/sso/providers', body)
    expect(res.status).toBe(201)
    const out = (await res.json()) as {
      provider: { organizationId: string; domainVerified?: boolean }
      dnsRecord: { type: string; name: string; value: string }
    }
    expect(out.provider.organizationId).toBe(orgId)
    expect(out.provider.domainVerified ?? false).toBe(false)
    expect(out.dnsRecord.type).toBe('TXT')
    expect(out.dnsRecord.name).toBe(`_saas-sso-okta-${tenancy}.corp-${tenancy}.example`)
    expect(out.dnsRecord.value.length).toBeGreaterThanOrEqual(16)

    expect((await a.send('DELETE', `/api/sso/providers/okta-${tenancy}`)).status).toBe(204)
    expect((await a.send('DELETE', `/api/sso/providers/okta-${tenancy}`)).status).toBe(404)
  })

  it('rejects a mutation without the CSRF token', async () => {
    const a = client()
    await a.signUpWithOrg(`c-${tenancy}@a.example`, `OrgC-${tenancy}`)
    const res = await app.request('/api/notes', {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        cookie: [...a.jar].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: JSON.stringify({ title: 'x' }),
    })
    expect(res.status).toBe(403)
  })

  it('a plain member cannot delete or read the audit log', async () => {
    const owner = client()
    const orgId = await owner.signUpWithOrg(`o-${tenancy}@d.example`, `OrgD-${tenancy}`)
    const member = client()
    const memberEmail = `m-${tenancy}@d.example`
    await member.send('POST', '/api/auth/sign-up/email', { email: memberEmail, password: 'correct horse battery', name: 'M' })
    const inv = (await (
      await owner.send('POST', '/api/auth/organization/invite-member', { email: memberEmail, role: 'member', organizationId: orgId })
    ).json()) as { id: string }
    expect((await member.send('POST', '/api/auth/organization/accept-invitation', { invitationId: inv.id })).status).toBe(200)
    await member.send('POST', '/api/auth/organization/set-active', { organizationId: orgId })
    const csrf = ((await (await member.send('GET', '/api/csrf')).json()) as { token: string }).token

    const mreq = (method: string, url: string) =>
      app.request(url, {
        method,
        headers: {
          origin: ORIGIN,
          'x-csrf-token': csrf,
          cookie: [...member.jar].map(([k, v]) => `${k}=${v}`).join('; '),
        },
      })
    expect((await mreq('GET', '/api/notes')).status).toBe(200)
    expect((await mreq('GET', '/api/audit')).status).toBe(403)
    expect((await mreq('DELETE', '/api/notes/00000000-0000-0000-0000-000000000001')).status).toBe(403)
  })
})

describe('e2e preview environment', () => {
  let stack: Awaited<ReturnType<typeof bootStack>>

  beforeAll(async () => {
    stack = await bootStack({ APP_ENV: 'preview', SEED_MODE: 'synthetic' })
  }, 60_000)

  afterAll(async () => {
    await stack?.close()
  })

  it('gives a brand-new user a tenant full of synthetic data', async () => {
    const u = clientFor(stack.app)
    await u.send('POST', '/api/auth/sign-up/email', { email: 'p@preview.example', password: 'correct horse battery', name: 'P' })
    const me = (await (await u.send('GET', '/api/me')).json()) as { activeOrganizationId: string | null; role: string }
    expect(me.activeOrganizationId).toBeTruthy()
    expect(me.role).toBe('owner')
    const { notes } = (await (await u.send('GET', '/api/notes')).json()) as { notes: { title: string }[] }
    expect(notes.length).toBe(4)
    // Idempotent: a second /api/me doesn't make another demo org.
    const again = (await (await u.send('GET', '/api/me')).json()) as { activeOrganizationId: string }
    expect(again.activeOrganizationId).toBe(me.activeOrganizationId)
  })
})

describe('e2e MFA required (the default)', () => {
  let stack: Awaited<ReturnType<typeof bootStack>>

  beforeAll(async () => {
    stack = await bootStack({ MFA_REQUIRED: 'true' })
  }, 60_000)

  afterAll(async () => {
    await stack?.close()
  })

  it('keeps tenant data closed until TOTP is enrolled', async () => {
    const u = clientFor(stack.app)
    await u.signUpWithOrg('mfa@a.example', 'MfaOrg')
    expect(((await (await u.send('GET', '/api/notes')).json()) as { error: string }).error).toBe('mfa_required')
    const me = (await (await u.send('GET', '/api/me')).json()) as { mfaEnabled: boolean; mfaRequired: boolean }
    expect(me).toMatchObject({ mfaEnabled: false, mfaRequired: true })
    // Enrollment itself is reachable: Better Auth hands back a TOTP URI.
    const enable = await u.send('POST', '/api/auth/two-factor/enable', { password: 'correct horse battery' })
    expect(enable.status).toBe(200)
    expect(((await enable.json()) as { totpURI: string }).totpURI).toMatch(/^otpauth:\/\/totp\//)
  })
})
