'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { AuthCard } from '@/components/app-shell'
import { resetCsrf } from '@/lib/api'
import { authClient } from '@/lib/auth-client'

export default function TwoFactorPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [backup, setBackup] = useState(false)
  const [trustDevice, setTrustDevice] = useState(false)
  const [error, setError] = useState('')

  async function verify(e: FormEvent) {
    e.preventDefault()
    setError('')
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ''), trustDevice })
    if (error) return setError(error.message ?? 'That code did not work')
    resetCsrf()
    router.replace('/dashboard')
  }

  return (
    <AuthCard title="Two-factor authentication">
      <form onSubmit={verify} className="stack">
        <label>
          {backup ? 'Backup code' : 'Code from your authenticator app'}
          <input
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={backup ? 'text' : 'numeric'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label className="row">
          <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
          Trust this device for 30 days
        </label>
        <button>Verify</button>
      </form>
      {error && <p className="error">{error}</p>}
      <button className="link" onClick={() => setBackup(!backup)}>
        {backup ? 'Use your authenticator app' : 'Use a backup code instead'}
      </button>
    </AuthCard>
  )
}
