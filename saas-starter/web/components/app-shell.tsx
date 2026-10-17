'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { ApiError, api, atLeast, resetCsrf, type Me } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { API, here } from '@/lib/paths'

const MeContext = createContext<{ me: Me; refresh: () => Promise<void> } | null>(null)

export function useMe() {
  const v = useContext(MeContext)
  if (!v) throw new Error('useMe() used outside <AppShell>')
  return v
}

/**
 * Wraps every signed-in page. Sends the visitor where they need to be first:
 * sign in → enroll MFA (when required) → pick or create an organization.
 */
export function AppShell({
  children,
  requireMfa = true,
  requireOrg = true,
}: {
  children: ReactNode
  requireMfa?: boolean
  requireOrg?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const m = await api<Me>(`${API}/me`)
      // Each step carries ?next= so the visitor ends up where they were going.
      if (requireMfa && m.mfaRequired && !m.mfaEnabled) return router.replace(`/settings/security?next=${here(pathname)}`)
      if (requireOrg && !m.activeOrganizationId) return router.replace(`/onboarding?next=${here(pathname)}`)
      setMe(m)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        return router.replace(`/login?next=${here(pathname)}`)
      }
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }, [router, pathname, requireMfa, requireOrg])

  useEffect(() => {
    void load()
  }, [load])

  async function signOut() {
    await authClient.signOut()
    resetCsrf()
    router.replace('/login')
  }

  if (error) return <main className="center error">{error}</main>
  if (!me) return <main className="center muted">Loading…</main>

  const hasOrg = Boolean(me.activeOrganizationId)
  const nav = [
    { href: '/dashboard', label: 'Notes', show: hasOrg },
    { href: '/members', label: 'Members', show: hasOrg },
    { href: '/audit', label: 'Audit log', show: hasOrg && atLeast(me.role, 'admin') },
    { href: '/settings/sso', label: 'SSO', show: hasOrg && atLeast(me.role, 'admin') },
    { href: '/settings/security', label: 'Security', show: true },
  ]

  return (
    <MeContext.Provider value={{ me, refresh: load }}>
      <header className="topbar">
        <Link href="/dashboard" className="brand">
          SaaS starter
        </Link>
        {me.environment !== 'production' && <span className="badge env">{me.environment}</span>}
        <nav>
          {nav
            .filter((n) => n.show)
            .map((n) => (
              <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : undefined}>
                {n.label}
              </Link>
            ))}
        </nav>
        <div className="who">
          <span>{me.user.email}</span>
          {me.role && <span className="badge">{me.role}</span>}
          <button className="link" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="content">{children}</main>
    </MeContext.Provider>
  )
}

/** Centered card for the signed-out pages. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="center">
      <div className="card auth">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  )
}
