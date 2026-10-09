'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'

import { AppShell, useMe } from '@/components/app-shell'
import { authClient } from '@/lib/auth-client'

type Org = { id: string; name: string }
type Invitation = { id: string; organizationId: string; role: string; status: string }

function Onboarding() {
  const router = useRouter()
  const { refresh } = useMe()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [invites, setInvites] = useState<Invitation[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void authClient.organization.list().then(({ data }) => setOrgs((data as Org[] | null) ?? []))
    void authClient.organization
      .listUserInvitations()
      .then(({ data }) => setInvites(((data as Invitation[] | null) ?? []).filter((i) => i.status === 'pending')))
  }, [])

  async function open(organizationId: string) {
    const { error } = await authClient.organization.setActive({ organizationId })
    if (error) return setError(error.message ?? 'Could not open that organization')
    await refresh()
    router.replace('/dashboard')
  }

  async function accept(invitationId: string, organizationId: string) {
    const { error } = await authClient.organization.acceptInvitation({ invitationId })
    if (error) return setError(error.message ?? 'Could not accept the invitation')
    await open(organizationId)
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    setError('')
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org'
    const { data, error } = await authClient.organization.create({ name, slug: `${base}-${crypto.randomUUID().slice(0, 6)}` })
    if (error || !data) return setError(error?.message ?? 'Could not create the organization')
    await open(data.id)
  }

  return (
    <section className="card">
      <h1>Choose an organization</h1>
      {orgs.length > 0 && (
        <ul className="list">
          {orgs.map((o) => (
            <li key={o.id}>
              <span>{o.name}</span>
              <button className="secondary" onClick={() => open(o.id)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
      {invites.length > 0 && (
        <>
          <h2>Invitations</h2>
          <ul className="list">
            {invites.map((i) => (
              <li key={i.id}>
                <span>Join as {i.role}</span>
                <button onClick={() => accept(i.id, i.organizationId)}>Accept</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2>Create a new organization</h2>
      <form onSubmit={create} className="row">
        <input required placeholder="Acme Inc." value={name} onChange={(e) => setName(e.target.value)} />
        <button>Create</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export default function OnboardingPage() {
  return (
    <AppShell requireOrg={false}>
      <Onboarding />
    </AppShell>
  )
}
