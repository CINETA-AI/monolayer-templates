'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { AuthCard } from '@/components/app-shell'
import { resetCsrf, safeNext } from '@/lib/api'
import { authClient } from '@/lib/auth-client'

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function signUp(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await authClient.signUp.email({ name, email, password })
    setBusy(false)
    if (error) return setError(error.message ?? 'Sign-up failed')
    resetCsrf()
    router.replace(safeNext(new URLSearchParams(window.location.search).get('next')))
  }

  return (
    <AuthCard title="Create your account">
      <form onSubmit={signUp} className="stack">
        <label>
          Name
          <input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password <span className="muted">(12+ characters)</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="muted">
        Have an account? <Link href="/login">Sign in</Link>
      </p>
    </AuthCard>
  )
}
