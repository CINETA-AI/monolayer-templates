import { randomUUID } from 'node:crypto'
import type pg from 'pg'

import type { Auth } from './auth.js'
import type { Config } from './config.js'
import { withTenant } from './db.js'

// Synthetic data for PREVIEW environments only. Each new preview user gets their own
// "Demo Co" tenant pre-filled with made-up notes — never real data, never in production.

const NOTES = [
  ['Welcome to your preview', 'Everything here is synthetic. Production never runs this seed.'],
  ['Quarterly planning', 'Draft agenda: roadmap review, hiring plan, budget.'],
  ['Customer feedback', 'Acme Corp asked for SSO with Okta — supported out of the box.'],
  ['Release checklist', 'Run migrations, verify health, announce in #releases.'],
] as const

export async function ensurePreviewTenant(
  deps: { cfg: Config; auth: Auth; pool: pg.Pool },
  headers: Headers,
  userId: string,
): Promise<string> {
  if (deps.cfg.appEnv === 'production' || deps.cfg.seedMode !== 'synthetic') {
    throw new Error('synthetic seed refused outside preview')
  }
  const org = await deps.auth.api.createOrganization({
    body: { name: 'Demo Co (synthetic data)', slug: `demo-${userId.slice(0, 8)}-${randomUUID().slice(0, 4)}` },
    headers,
  })
  if (!org) throw new Error('could not create the demo organization')
  await deps.auth.api.setActiveOrganization({ body: { organizationId: org.id }, headers })
  await withTenant(deps.pool, deps.cfg.tenancy, org.id, async (db) => {
    for (const [title, body] of NOTES) {
      await db.query('INSERT INTO notes (title, body, created_by) VALUES ($1, $2, $3)', [title, body, userId])
    }
  })
  return org.id
}
