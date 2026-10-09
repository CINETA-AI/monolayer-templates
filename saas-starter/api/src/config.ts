// Runtime configuration. Everything the platform provides (DATABASE_URL from the canvas
// connection, PUBLIC_URL from the gateway, generated SESSION_SECRET / CSRF_SECRET, and
// the template's APP_ENV / TENANCY_MODE / SEED_MODE) arrives as env vars — nothing to
// configure by hand.

export type TenancyMode = 'rls' | 'schema'
export type AppEnv = 'production' | 'staging' | 'preview' | 'local'

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string, fallback?: string): string => {
    const v = env[name] ?? fallback
    if (!v) throw new Error(`missing required env ${name}`)
    return v
  }
  const appEnv = (env.APP_ENV ?? 'local') as AppEnv
  const local = appEnv === 'local'
  const tenancy = (env.TENANCY_MODE ?? 'rls') as TenancyMode
  if (tenancy !== 'rls' && tenancy !== 'schema') throw new Error(`TENANCY_MODE must be rls or schema, got ${tenancy}`)
  const sessionSecret = env.SESSION_SECRET ?? (local ? 'local-dev-session-secret-change-me-0123456789' : undefined)
  const csrfSecret = env.CSRF_SECRET ?? (local ? 'local-dev-csrf-secret-change-me-0123456789' : undefined)
  if (!sessionSecret || sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  if (!csrfSecret || csrfSecret.length < 32) throw new Error('CSRF_SECRET must be at least 32 characters')
  return {
    appEnv,
    port: Number(env.PORT ?? 8080),
    databaseUrl: required('DATABASE_URL', local ? 'postgres://postgres:postgres@localhost:5432/app' : undefined),
    // The public URL of the gateway (https://dxxxx.cloudfront.net). Before the gateway is
    // live the platform hasn't injected it yet; the app still boots.
    publicUrl: (env.PUBLIC_URL ?? (local ? 'http://localhost:3000' : '')).replace(/\/$/, ''),
    sessionSecret,
    csrfSecret,
    tenancy,
    seedMode: env.SEED_MODE === 'synthetic' ? 'synthetic' : 'none',
    // MFA is required for every member by default; set MFA_REQUIRED=false to relax it.
    mfaRequired: env.MFA_REQUIRED !== 'false',
    // TLS to Postgres: verified against the Amazon RDS CA bundle baked into the image.
    pgSslCaFile: env.PGSSLROOTCERT ?? '/etc/ssl/certs/rds-global-bundle.pem',
    pgSsl: env.PGSSLMODE ?? (local ? 'disable' : 'verify-full'),
  }
}

export type Config = ReturnType<typeof loadConfig>
