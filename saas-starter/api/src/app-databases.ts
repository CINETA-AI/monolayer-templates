// Databases for the customer's own apps (e.g. the backend they bring to the template).
//
// The platform names each app's database and login, generates the password inside the
// customer's AWS account, and hands the list to this API as MONOLAYER_DB_APP_USERS. This
// API is the database's admin (it connects as the master user), so on every boot it:
//   - creates each app's login role, or re-applies its password (so a rotated password
//     takes effect), with no special powers: no superuser, no CREATEDB/CREATEROLE, no
//     BYPASSRLS;
//   - creates each app's database, owned by that role and closed to everyone else;
//   - closes the template's own database to them, so an app can never read sign-in data.
// The app then connects with its own DATABASE_URL and creates its tables itself.

export type AppDatabase = { user: string; database: string; password: string }

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }

const NAME_RE = /^[a-z][a-z0-9_]{0,62}$/
// Names an app must never take: Postgres/RDS internals and the template's own roles.
const RESERVED = new Set([
  'postgres', 'rdsadmin', 'rds_superuser', 'rdsrepladmin', 'rds_iam', 'rds_replication', 'rds_password',
  'monolayer', 'app', 'app_tenant', 'template0', 'template1', 'public',
])

/** Parse and validate MONOLAYER_DB_APP_USERS (a JSON array). Unset → no app databases. */
export function parseAppDatabases(raw: string | undefined): AppDatabase[] {
  if (!raw || !raw.trim()) return []
  let list: unknown
  try {
    list = JSON.parse(raw)
  } catch {
    throw new Error('MONOLAYER_DB_APP_USERS is not valid JSON')
  }
  if (!Array.isArray(list)) throw new Error('MONOLAYER_DB_APP_USERS must be a JSON array')
  const seenUsers = new Set<string>()
  const seenDbs = new Set<string>()
  return list.map((item, i) => {
    const { user, database, password } = (item ?? {}) as Record<string, unknown>
    for (const [field, value] of [['user', user], ['database', database]] as const) {
      if (typeof value !== 'string' || !NAME_RE.test(value) || RESERVED.has(value)) {
        throw new Error(`MONOLAYER_DB_APP_USERS[${i}].${field} is not an allowed Postgres name`)
      }
    }
    if (typeof password !== 'string' || password.length < 16) {
      throw new Error(`MONOLAYER_DB_APP_USERS[${i}].password is missing or too short`)
    }
    if (seenUsers.has(user as string) || seenDbs.has(database as string)) {
      throw new Error(`MONOLAYER_DB_APP_USERS[${i}] repeats a user or database`)
    }
    seenUsers.add(user as string)
    seenDbs.add(database as string)
    return { user: user as string, database: database as string, password }
  })
}

const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"'
const literal = (value: string) => "'" + value.replace(/'/g, "''") + "'"

/**
 * Create or update every app's role and database. Runs as the master user, outside a
 * transaction (CREATE DATABASE can't run inside one), under the caller's migration lock.
 */
export async function provisionAppDatabases(db: Queryable, apps: AppDatabase[]): Promise<void> {
  if (apps.length === 0) return
  const { rows } = await db.query('SELECT current_database() AS name')
  const templateDb = String(rows[0]?.name ?? '')
  if (!templateDb) throw new Error('could not read the current database name')

  for (const app of apps) {
    const role = ident(app.user)
    const exists = (await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [app.user])).rows.length > 0
    const powers = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION'
    if (exists) {
      await db.query(`ALTER ROLE ${role} WITH ${powers} PASSWORD ${literal(app.password)}`)
    } else {
      await db.query(`CREATE ROLE ${role} WITH ${powers} PASSWORD ${literal(app.password)}`)
    }

    const hasDb = (await db.query('SELECT 1 FROM pg_database WHERE datname = $1', [app.database])).rows.length > 0
    if (!hasDb) {
      // Giving a database to another role needs membership in it (PostgreSQL 16+ also
      // needs the SET option; older versions reject that syntax, hence the fallback).
      await db.query(`GRANT ${role} TO CURRENT_USER WITH SET TRUE`).catch(() => db.query(`GRANT ${role} TO CURRENT_USER`))
      await db.query(`CREATE DATABASE ${ident(app.database)} OWNER ${role}`)
    }
    // Only its owner (and the admin) may connect.
    await db.query(`REVOKE ALL ON DATABASE ${ident(app.database)} FROM PUBLIC`)
    console.log(`app database ${app.database} ready for ${app.user}`)
  }
  // Apps get their own database; the template's (sign-in data, tenants) stays closed.
  await db.query(`REVOKE CONNECT ON DATABASE ${ident(templateDb)} FROM PUBLIC`)
  // The empty default "postgres" database is open to every login out of the box. Close
  // it too, but only if we own it (then we keep our own access); otherwise leave it.
  const ownsDefault = await db.query(
    `SELECT 1 FROM pg_database WHERE datname = 'postgres' AND datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
  )
  if (ownsDefault.rows.length > 0 && templateDb !== 'postgres') {
    await db.query('REVOKE CONNECT ON DATABASE "postgres" FROM PUBLIC')
  }
}
