'use client'

import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { useState, type FormEvent } from 'react'

import { AppShell, useMe } from '@/components/app-shell'
import { authClient } from '@/lib/auth-client'
import { go, nextParam } from '@/lib/paths'

function Security() {
  const router = useRouter()
  const { me, refresh } = useMe()
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<{ qr: string; secret: string; backupCodes: string[] } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  async function start(e: FormEvent) {
    e.preventDefault()
    setError('')
    // SSO users have no password; the API allows enrolling without one in that case.
    const { data, error } = await authClient.twoFactor.enable({
      password: password || undefined,
      method: 'totp',
    } as { password: string; method: 'totp' })
    if (error || !data || data.method !== 'totp') return setError(error?.message ?? 'Could not start enrollment')
    const secret = new URL(data.totpURI).searchParams.get('secret') ?? ''
    setSetup({ qr: await QRCode.toDataURL(data.totpURI), secret, backupCodes: data.backupCodes })
  }

  async function confirm(e: FormEvent) {
    e.preventDefault()
    setError('')
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') })
    if (error) return setError(error.message ?? 'That code did not work')
    await refresh()
    go(router, nextParam())
  }

  if (me.mfaEnabled) {
    return (
      <section className="card">
        <h1>Security</h1>
        <p>
          <span className="badge ok">On</span> Two-factor authentication protects your account.
        </p>
      </section>
    )
  }

  return (
    <section className="card">
      <h1>Set up two-factor authentication</h1>
      {me.mfaRequired && <p className="notice">Two-factor authentication is required before you continue.</p>}

      {!setup ? (
        <form onSubmit={start} className="stack narrow">
          <label>
            Confirm your password <span className="muted">(leave empty if you sign in with SSO)</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button>Continue</button>
        </form>
      ) : (
        <div className="stack">
          <p>Scan this with your authenticator app (1Password, Google Authenticator, Authy…):</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="Authenticator QR code" width={200} height={200} />
          <p className="muted">
            Can&apos;t scan? Enter this key: <code>{setup.secret}</code>
          </p>
          <details>
            <summary>Backup codes — save these somewhere safe</summary>
            <ul className="codes">
              {setup.backupCodes.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
          </details>
          <form onSubmit={confirm} className="stack narrow">
            <label>
              Enter the 6-digit code to finish
              <input required autoComplete="one-time-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button>Turn on two-factor</button>
          </form>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export default function SecurityPage() {
  return (
    <AppShell requireMfa={false} requireOrg={false}>
      <Security />
    </AppShell>
  )
}
