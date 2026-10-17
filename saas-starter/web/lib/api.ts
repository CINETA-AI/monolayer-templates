'use client'

import { API } from '@/lib/paths'

// Calls to the template's API (same origin, cookies). Mutations carry the session-bound
// CSRF token from GET /account/api/csrf.

export type Role = 'owner' | 'admin' | 'member'

export type Me = {
  user: { id: string; email: string; name: string }
  mfaEnabled: boolean
  mfaRequired: boolean
  activeOrganizationId: string | null
  role: Role | null
  tenancy: 'rls' | 'schema'
  environment: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

let csrf: string | null = null

/** Call after sign-in/out: the token is bound to the session. */
export function resetCsrf() {
  csrf = null
}

async function csrfToken(): Promise<string> {
  if (!csrf) csrf = (await api<{ token: string }>(`${API}/csrf`)).token
  return csrf
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET') headers['x-csrf-token'] = await csrfToken()
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    if (data.error === 'csrf') resetCsrf()
    throw new ApiError(res.status, data.error ?? res.statusText)
  }
  return data as T
}

export const atLeast = (role: Role | null, min: Role) =>
  role !== null && { member: 1, admin: 2, owner: 3 }[role] >= { member: 1, admin: 2, owner: 3 }[min]
