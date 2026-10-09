import type pg from 'pg'
import { betterAuth, getCurrentAdapter, type BetterAuthOptions } from 'better-auth'
import { organization, twoFactor } from 'better-auth/plugins'
import { sso } from '@better-auth/sso'

import type { Config } from './config.js'

// Authentication: Better Auth, running inside this API, data in our own Postgres.
//  - email + password (12+ chars), TOTP two-factor (required by the route guard in routes.ts)
//  - organizations = tenants, with owner / admin / member roles and invitations
//  - enterprise SSO (OIDC + SAML), configured per organization by its admins at runtime
//  - HttpOnly, Secure, SameSite=Lax session cookies; Better Auth's own CSRF defences
//    (Origin + Fetch-Metadata checks) on its endpoints, ours (csrf.ts) on the app's.

/** DNS TXT record for SSO domain verification: _saas-sso-<providerId>.<domain> */
export const SSO_DNS_PREFIX = 'saas-sso'

export function authOptions(cfg: Config, pool: pg.Pool) {
  return {
    appName: 'SaaS starter',
    database: pool,
    secret: cfg.sessionSecret,
    baseURL: cfg.publicUrl || undefined,
    basePath: '/api/auth',
    trustedOrigins: cfg.publicUrl ? [cfg.publicUrl] : [],
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    session: {
      expiresIn: 60 * 60 * 12, // 12h
      updateAge: 60 * 60, // refreshed hourly while active
    },
    databaseHooks: {
      session: {
        create: {
          // A new sign-in lands in the user's organization (their oldest membership),
          // not on the "choose an organization" screen.
          // Reads through Better Auth's adapter so it joins the sign-in's own transaction.
          before: async (session, ctx) => {
            if (!ctx || session.activeOrganizationId) return
            const db = await getCurrentAdapter(ctx.context.adapter)
            const [first] = await db.findMany<{ organizationId: string }>({
              model: 'member',
              where: [{ field: 'userId', value: session.userId }],
              sortBy: { field: 'createdAt', direction: 'asc' },
              limit: 1,
            })
            if (first) return { data: { ...session, activeOrganizationId: first.organizationId } }
          },
        },
      },
    },
    advanced: {
      useSecureCookies: cfg.appEnv !== 'local',
      cookiePrefix: 'saas',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    plugins: [
      organization({ allowUserToCreateOrganization: true }),
      // allowPasswordless: SSO users (no password) can still enroll TOTP.
      twoFactor({ issuer: 'SaaS starter', allowPasswordless: true }),
      // Org admins connect their own IdP. Sign-in through it only works once the admin
      // proves they own the email domain (DNS TXT record), so nobody can claim another
      // company's domain.
      sso({ domainVerification: { enabled: true, tokenPrefix: SSO_DNS_PREFIX } }),
    ],
  } satisfies BetterAuthOptions
}

export function createAuth(cfg: Config, pool: pg.Pool) {
  return betterAuth(authOptions(cfg, pool))
}

export type Auth = ReturnType<typeof createAuth>
