import type pg from 'pg'
import { getMigrations } from 'better-auth/db/migration'
import type { BetterAuthOptions } from 'better-auth'

import type { Config } from './config.js'
import { BOOTSTRAP_SQL, SHARED_SCHEMA, assertRowLevelSecurity, tenantTablesSQL } from './db.js'

// Migrations run on boot. Every task of every environment starts at once, so they take
// a Postgres advisory lock — exactly one runs them, the others wait and find nothing to do.

const LOCK_KEY = 726_163_001 // arbitrary, stable

/** Versioned app migrations (append-only). */
export function appMigrations(cfg: Pick<Config, 'tenancy'>): { version: string; sql: string }[] {
  return [
    { version: '001_bootstrap', sql: BOOTSTRAP_SQL },
    // Schema mode creates tenant tables per tenant on first use (ensureTenantSchema);
    // the shared schema still exists (empty) so search_path resolution is uniform.
    {
      version: '002_tenant_tables',
      sql: cfg.tenancy === 'rls' ? tenantTablesSQL(SHARED_SCHEMA) : `CREATE SCHEMA IF NOT EXISTS ${SHARED_SCHEMA};`,
    },
  ]
}

export async function migrate(pool: pg.Pool, cfg: Config, authOptions: BetterAuthOptions): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    // Auth tables (users, sessions, organizations, members, 2FA, SSO providers).
    const { runMigrations } = await getMigrations(authOptions)
    await runMigrations()

    await client.query(BOOTSTRAP_SQL) // creates schema_migrations on a fresh database
    const { rows } = await client.query('SELECT version FROM public.schema_migrations')
    const applied = new Set(rows.map((r) => r.version as string))
    for (const m of appMigrations(cfg)) {
      if (applied.has(m.version)) continue
      await client.query('BEGIN')
      try {
        await client.query(m.sql)
        await client.query('INSERT INTO public.schema_migrations (version) VALUES ($1)', [m.version])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${m.version} failed: ${(err as Error).message}`)
      }
    }
    if (cfg.tenancy === 'rls') await assertRowLevelSecurity(client, SHARED_SCHEMA)
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    client.release()
  }
}
