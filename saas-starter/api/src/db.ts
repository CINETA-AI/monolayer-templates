import fs from 'node:fs'
import pg from 'pg'

import type { Config, TenancyMode } from './config.js'

// Database access. Every tenant-data query runs inside withTenant(): a transaction that
// drops to the RLS-bound role `app_tenant` (no BYPASSRLS) with app.tenant_id pinned, so
// Postgres itself filters rows — a forgotten WHERE clause cannot leak another tenant.
// Schema-per-tenant mode additionally points search_path at the tenant's own schema.

export const TENANT_ROLE = 'app_tenant'
export const SHARED_SCHEMA = 'app'

/** The minimal client surface we use — satisfied by pg.PoolClient and by PGlite in tests. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>
}

export function createPool(cfg: Config): pg.Pool {
  let ssl: pg.PoolConfig['ssl'] = false
  if (cfg.pgSsl !== 'disable') {
    ssl = {
      rejectUnauthorized: cfg.pgSsl === 'verify-full',
      ca: fs.existsSync(cfg.pgSslCaFile) ? fs.readFileSync(cfg.pgSslCaFile, 'utf8') : undefined,
    }
  }
  return new pg.Pool({ connectionString: cfg.databaseUrl, ssl, max: 10 })
}

const TENANT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function assertTenantId(id: string): string {
  if (!TENANT_ID_RE.test(id)) throw new Error('invalid tenant id')
  return id
}

/** Postgres schema for a tenant in schema-per-tenant mode. */
export function tenantSchema(tenantId: string): string {
  return 't_' + assertTenantId(tenantId).toLowerCase().replace(/[^a-z0-9]/g, '_')
}

export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * Tenant tables. Identical in both modes: in RLS mode they live once in the shared
 * schema; in schema mode once per tenant schema. RLS is enabled AND forced in both, so
 * even the table owner is filtered (defense in depth for schema mode).
 */
export function tenantTablesSQL(schema: string): string {
  const s = quoteIdent(schema)
  const table = (name: string, columns: string) => `
CREATE TABLE IF NOT EXISTS ${s}.${name} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT current_setting('app.tenant_id'),
  ${columns},
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ${name}_tenant_idx ON ${s}.${name} (tenant_id);
ALTER TABLE ${s}.${name} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${s}.${name} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ${s}.${name};
CREATE POLICY tenant_isolation ON ${s}.${name}
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON ${s}.${name} TO ${TENANT_ROLE};`
  return `
CREATE SCHEMA IF NOT EXISTS ${s};
GRANT USAGE ON SCHEMA ${s} TO ${TENANT_ROLE};
${table('notes', `title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '',
  created_by text NOT NULL`)}
${table('audit_log', `actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL DEFAULT ''`)}`
}

/** One-time, shared setup: the RLS-bound role and the shared schema. Idempotent. */
export const BOOTSTRAP_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TENANT_ROLE}') THEN
    CREATE ROLE ${TENANT_ROLE} NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
-- The connecting user may switch to it (SET ROLE) but app_tenant can never log in.
GRANT ${TENANT_ROLE} TO CURRENT_USER;
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);`

/**
 * Lint: every table a tenant can reach must have RLS enabled AND forced. Run at boot and
 * in tests, so a new table without a policy fails loudly instead of leaking.
 */
export async function assertRowLevelSecurity(db: Queryable, schema: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = 'r'`,
    [schema],
  )
  const bad = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity).map((r) => r.relname)
  if (bad.length > 0) throw new Error(`tables without forced row-level security in ${schema}: ${bad.join(', ')}`)
}

/**
 * Ensure a tenant's schema exists (schema mode). Runs as the owner, before SET ROLE.
 * The common case is one catalog lookup; creation is serialized per schema with a
 * transaction-scoped advisory lock so two first requests for a tenant can't race.
 */
export async function ensureTenantSchema(db: Queryable, tenantId: string): Promise<string> {
  const schema = tenantSchema(tenantId)
  const { rows } = await db.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema])
  if (rows.length === 0) {
    await db.query('SELECT pg_advisory_xact_lock(726163002, hashtext($1))', [schema])
    await db.query(tenantTablesSQL(schema))
  }
  return schema
}

/**
 * Scope a unit of work to one tenant. The callback's queries see ONLY that tenant's rows.
 */
export async function scopeToTenant(db: Queryable, mode: TenancyMode, tenantId: string): Promise<void> {
  assertTenantId(tenantId)
  const schema = mode === 'schema' ? await ensureTenantSchema(db, tenantId) : SHARED_SCHEMA
  await db.query(`SET LOCAL search_path TO ${quoteIdent(schema)}`)
  await db.query(`SET LOCAL ROLE ${TENANT_ROLE}`)
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
}

export async function withTenant<T>(
  pool: pg.Pool,
  mode: TenancyMode,
  tenantId: string,
  fn: (db: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await scopeToTenant(client, mode, tenantId)
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
