import { describe, expect, it } from 'vitest'

import { parseAppDatabases, provisionAppDatabases } from '../src/app-databases.js'

const pw = 'p'.repeat(32)

describe('parseAppDatabases', () => {
  it('is empty when the platform sends nothing', () => {
    expect(parseAppDatabases(undefined)).toEqual([])
    expect(parseAppDatabases('  ')).toEqual([])
  })

  it('keeps valid entries', () => {
    expect(parseAppDatabases(JSON.stringify([{ user: 'backend_app', database: 'backend', password: pw }]))).toEqual([
      { user: 'backend_app', database: 'backend', password: pw },
    ])
  })

  it.each([
    ['not JSON', '{'],
    ['not an array', '{}'],
    ['a reserved user', JSON.stringify([{ user: 'postgres', database: 'b', password: pw }])],
    ["the template's own database", JSON.stringify([{ user: 'b', database: 'app', password: pw }])],
    ['an unsafe name', JSON.stringify([{ user: 'b"; DROP', database: 'b', password: pw }])],
    ['uppercase', JSON.stringify([{ user: 'Backend', database: 'b', password: pw }])],
    ['a short password', JSON.stringify([{ user: 'b', database: 'b', password: 'x' }])],
    ['a repeated user', JSON.stringify([{ user: 'b', database: 'b1', password: pw }, { user: 'b', database: 'b2', password: pw }])],
  ])('rejects %s', (_, raw) => {
    expect(() => parseAppDatabases(raw)).toThrow(/MONOLAYER_DB_APP_USERS/)
  })
})

// A fake connection that records statements and answers the existence checks.
function recorder(existing: { roles?: string[]; dbs?: string[]; ownsDefault?: boolean } = {}) {
  const sql: string[] = []
  const db = {
    query: async (text: string, params: unknown[] = []) => {
      sql.push(text)
      if (text.includes('current_database()')) return { rows: [{ name: 'app' }] }
      if (text.includes("datname = 'postgres'")) return { rows: existing.ownsDefault ? [{}] : [] }
      if (text.includes('FROM pg_roles')) return { rows: (existing.roles ?? []).includes(String(params[0])) ? [{}] : [] }
      if (text.includes('FROM pg_database')) return { rows: (existing.dbs ?? []).includes(String(params[0])) ? [{}] : [] }
      return { rows: [] }
    },
  }
  return { db, sql }
}

describe('provisionAppDatabases', () => {
  it('does nothing without apps', async () => {
    const { db, sql } = recorder()
    await provisionAppDatabases(db, [])
    expect(sql).toEqual([])
  })

  it('creates a powerless login, its own closed database, and closes the template database', async () => {
    const { db, sql } = recorder()
    await provisionAppDatabases(db, [{ user: 'backend_app', database: 'backend', password: pw }])
    const ddl = sql.filter((s) => !s.startsWith('SELECT'))
    expect(ddl).toEqual([
      `CREATE ROLE "backend_app" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD '${pw}'`,
      'GRANT "backend_app" TO CURRENT_USER WITH SET TRUE',
      'CREATE DATABASE "backend" OWNER "backend_app"',
      'REVOKE ALL ON DATABASE "backend" FROM PUBLIC',
      'REVOKE CONNECT ON DATABASE "app" FROM PUBLIC',
    ])
  })

  it('on later boots only re-applies the password and the lockdown', async () => {
    const { db, sql } = recorder({ roles: ['backend_app'], dbs: ['backend'] })
    await provisionAppDatabases(db, [{ user: 'backend_app', database: 'backend', password: pw }])
    const ddl = sql.filter((s) => !s.startsWith('SELECT'))
    expect(ddl[0]).toMatch(/^ALTER ROLE "backend_app" WITH LOGIN .* PASSWORD /)
    expect(ddl.some((s) => s.startsWith('CREATE'))).toBe(false)
  })

  it('runs on real Postgres (PGlite), twice, and locks the app into its own database', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const pg = new PGlite()
    const db = { query: async (text: string, params?: unknown[]) => ({ rows: (await pg.query(text, params)).rows as Record<string, unknown>[] }) }
    const apps = [{ user: 'backend_app', database: 'backend', password: pw }]
    await provisionAppDatabases(db, apps)
    await provisionAppDatabases(db, apps) // every boot runs it again

    const role = (
      await db.query(
        `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = 'backend_app'`,
      )
    ).rows[0]
    expect(role).toEqual({ rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false })
    const owner = (
      await db.query(`SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'backend'`)
    ).rows[0]
    expect(owner).toEqual({ owner: 'backend_app' })
    const template = String((await db.query('SELECT current_database() AS name')).rows[0]?.name)
    const access = (
      await db.query(
        `SELECT has_database_privilege('backend_app', $1, 'CONNECT') AS template, has_database_privilege('backend_app', 'backend', 'CONNECT') AS own`,
        [template],
      )
    ).rows[0]
    expect(access).toEqual({ template: false, own: true })
    await pg.close()
  })

  it("closes the empty default database only when it's ours", async () => {
    const owned = recorder({ ownsDefault: true })
    await provisionAppDatabases(owned.db, [{ user: 'b', database: 'b', password: pw }])
    expect(owned.sql).toContain('REVOKE CONNECT ON DATABASE "postgres" FROM PUBLIC')
    const notOwned = recorder()
    await provisionAppDatabases(notOwned.db, [{ user: 'b', database: 'b', password: pw }])
    expect(notOwned.sql.some((s) => s.includes('DATABASE "postgres"'))).toBe(false)
  })

  it('quotes a password containing a quote', async () => {
    const { db, sql } = recorder()
    await provisionAppDatabases(db, [{ user: 'b', database: 'b', password: "it's-" + pw }])
    expect(sql.find((s) => s.startsWith('CREATE ROLE'))).toContain(`PASSWORD 'it''s-${pw}'`)
  })
})
