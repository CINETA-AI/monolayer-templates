'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { AppShell, useMe } from '@/components/app-shell'
import { authClient } from '@/lib/auth-client'

function Accept() {
  const router = useRouter()
  const { refresh } = useMe()
  const [error, setError] = useState('')

  useEffect(() => {
    const invitationId = new URLSearchParams(window.location.search).get('id') ?? ''
    void (async () => {
      const { data, error } = await authClient.organization.acceptInvitation({ invitationId })
      if (error || !data) return setError(error?.message ?? 'This invitation is invalid or was sent to another email')
      await authClient.organization.setActive({ organizationId: data.invitation.organizationId })
      await refresh()
      router.replace('/dashboard')
    })()
    // Accept once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <section className="card">{error ? <p className="error">{error}</p> : <p className="muted">Joining…</p>}</section>
}

export default function AcceptInvitePage() {
  return (
    <AppShell requireMfa={false} requireOrg={false}>
      <Accept />
    </AppShell>
  )
}
