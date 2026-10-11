'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { AuthCard } from '@/components/app-shell'
import { resetCsrf } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { go, nextParam } from '@/lib/paths'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ssoEmail, setSsoEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error } = await authClient.signIn.email({ email, password })
    setBusy(false)
    if (error) return setError(error.message ?? 'Sign-in failed')
    resetCsrf()
    // With 2FA on, Better Auth answers twoFactorRedirect and the client sends us to /two-factor.
    if (!(data && 'twoFactorRedirect' in data && data.twoFactorRedirect)) go(router, nextParam())
  }

  async function signInSso(e: FormEvent) {
    e.preventDefault()
    setError('')
    const { error } = await authClient.signIn.sso({ email: ssoEmail, callbackURL: nextParam() })
    if (error) setError(error.message ?? 'No SSO connection for that email domain')
  }

  return (
    <AuthCard title="Sign in">
      <form onSubmit={signIn} className="stack">
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>

      <div className="divider">or</div>

      <form onSubmit={signInSso} className="stack">
        <label>
          Work email (single sign-on)
          <input type="email" required value={ssoEmail} onChange={(e) => setSsoEmail(e.target.value)} />
        </label>
        <button className="secondary">Continue with SSO</button>
      </form>

      {error && <p className="error">{error}</p>}
      <p className="muted">
        No account? <Link href="/signup">Create one</Link>
      </p>
    </AuthCard>
  )
}
