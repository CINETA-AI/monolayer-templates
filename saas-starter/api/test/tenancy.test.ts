import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BOOTSTRAP_SQL,
  SHARED_SCHEMA,
  assertRowLevelSecurity,
  scopeToTenant,
  tenantSchema,
  tenantTablesSQL,
  type Queryable,
} from '../src/db.js'
import type { TenancyMode } from '../src/config.js'

// Tenant isolation, proven against a real Postgres (PGlite = Postgres compiled to WASM).
// The connecting user is a superuser here, like the RDS master user is the table owner;
// isolation must hold anyway because tenant work runs as the RLS-bound app_tenant role.

let pg: PGlite
let db: Queryable

beforeEach(async () => {
  pg = new PGlite()
  // pg's simple protocol accepts multi-statement SQL without params; PGlite needs exec().
  db = {
    async query(text, params) {
      if (params && params.length > 0) return pg.query(text, params)
      const results = await pg.exec(text)
      return { rows: results.at(-1)?.rows ?? [] }
    },
  }
  await db.query(BOOTSTRAP_SQL)
})

afterEach(async () => {
  await pg.close()
})

async function asTenant<T>(mode: TenancyMode, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await db.query('BEGIN')
  try {
    await scopeToTenant(db, mode, tenantId)
    const out = await fn()
    await db.query('COMMIT')
    return out
  } catch (err) {
    await db.query('ROLLBACK')
    throw err
  }
}

const note = (title: string) => db.query('INSERT INTO notes (title, created_by) VALUES ($1, $2)', [title, 'u1'])
const titles = async () => (await db.query('SELECT title FROM notes ORDER BY title')).rows.map((r) => r.title)

describe.each(['rls', 'schema'] as const)('tenancy=%s', (mode) => {
  beforeEach(async () => {
    if (mode === 'rls') await db.query(tenantTablesSQL(SHARED_SCHEMA))
    await asTenant(mode, 'orgA', () => note('a1'))
    await asTenant(mode, 'orgA', () => note('a2'))
    await asTenant(mode, 'orgB', () => note('b1'))
  })

  it('each tenant sees only its own rows', async () => {
    expect(await asTenant(mode, 'orgA', titles)).toEqual(['a1', 'a2'])
    expect(await asTenant(mode, 'orgB', titles)).toEqual(['b1'])
  })

  it('a WHERE clause naming another tenant still returns nothing', async () => {
    const rows = await asTenant(mode, 'orgA', async () =>
      (await db.query(`SELECT * FROM notes WHERE tenant_id = $1`, ['orgB'])).rows,
    )
    expect(rows).toEqual([])
  })

  it("cannot write rows into another tenant", async () => {
    await expect(
      asTenant(mode, 'orgA', () =>
        db.query('INSERT INTO notes (tenant_id, title, created_by) VALUES ($1, $2, $3)', ['orgB', 'x', 'u1']),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it("cannot update or delete another tenant's rows", async () => {
    await asTenant(mode, 'orgA', async () => {
      await db.query(`UPDATE notes SET title = 'pwned'`)
      await db.query(`DELETE FROM notes`)
    })
    expect(await asTenant(mode, 'orgB', titles)).toEqual(['b1'])
  })

  it('without a tenant pinned, the tenant role sees nothing', async () => {
    const rows = await asTenant(mode, 'orgA', async () => {
      await db.query(`SELECT set_config('app.tenant_id', '', true)`)
      return (await db.query('SELECT * FROM notes')).rows
    })
    expect(rows).toEqual([])
  })

  it('rejects tenant ids that could inject SQL or escape the schema', async () => {
    await expect(asTenant(mode, `x"; DROP TABLE notes; --`, titles)).rejects.toThrow(/invalid tenant id/)
  })
})

describe('tenancy=schema', () => {
  it('gives each tenant its own schema', async () => {
    await asTenant('schema', 'orgA', () => note('a1'))
    await asTenant('schema', 'orgB', () => note('b1'))
    const { rows } = await db.query(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 't\\_%' ORDER BY 1`)
    expect(rows.map((r) => r.nspname)).toEqual([tenantSchema('orgA'), tenantSchema('orgB')])
  })

  it("reaching into another tenant's schema by name is still filtered by RLS", async () => {
    await asTenant('schema', 'orgA', () => note('a1'))
    await asTenant('schema', 'orgB', () => note('b1'))
    const rows = await asTenant('schema', 'orgA', async () =>
      (await db.query(`SELECT title FROM ${tenantSchema('orgB')}.notes`)).rows,
    )
    expect(rows).toEqual([])
  })
})

describe('row-level security lint', () => {
  it('passes for the tenant tables', async () => {
    await db.query(tenantTablesSQL(SHARED_SCHEMA))
    await expect(assertRowLevelSecurity(db, SHARED_SCHEMA)).resolves.toBeUndefined()
  })

  it('fails loudly for a table added without forced RLS', async () => {
    await db.query(tenantTablesSQL(SHARED_SCHEMA))
    await db.query(`CREATE TABLE ${SHARED_SCHEMA}.invoices (id int)`)
    await expect(assertRowLevelSecurity(db, SHARED_SCHEMA)).rejects.toThrow(/invoices/)
  })

  it('bootstrap and table setup are idempotent', async () => {
    await db.query(BOOTSTRAP_SQL)
    await db.query(tenantTablesSQL(SHARED_SCHEMA))
    await db.query(tenantTablesSQL(SHARED_SCHEMA))
    await expect(assertRowLevelSecurity(db, SHARED_SCHEMA)).resolves.toBeUndefined()
  })
})
