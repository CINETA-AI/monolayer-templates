// Authorization. Roles come from the caller's membership in the active organization
// (tenant). Every API route declares its access up front in routes.ts — public, session
// only, or a named permission — and anything not declared is unreachable (404), so no
// route is unauthenticated unless someone explicitly marked it public.

export type Role = 'owner' | 'admin' | 'member'

const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 }

/** Permission → the lowest role that has it. */
export const PERMISSIONS = {
  'notes:read': 'member',
  'notes:write': 'member',
  'notes:delete': 'admin',
  'members:read': 'member',
  'sso:manage': 'admin',
  'audit:read': 'admin',
} as const satisfies Record<string, Role>

export type Permission = keyof typeof PERMISSIONS

export function isRole(v: unknown): v is Role {
  return v === 'owner' || v === 'admin' || v === 'member'
}

export function allows(role: Role, permission: Permission): boolean {
  return RANK[role] >= RANK[PERMISSIONS[permission]]
}

/** How a route may be reached. */
export type Access =
  | { public: true }
  // Signed in; no tenant role needed. allowWithoutMfa: reachable before MFA enrollment.
  | { session: true; allowWithoutMfa?: boolean }
  // Signed in, MFA done, active organization, and a role that has the permission.
  | { permission: Permission }

export function describeAccess(a: Access): string {
  if ('public' in a) return 'public'
  if ('session' in a) return a.allowWithoutMfa ? 'session (MFA not required)' : 'session'
  return `permission ${a.permission} (${PERMISSIONS[a.permission]}+)`
}
