'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { AppShell, useMe } from '@/components/app-shell'
import { api, atLeast } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { withBase } from '@/lib/paths'

type Member = { id: string; role: string; user: { email: string; name: string } }

function Members() {
  const { me } = useMe()
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [inviteLink, setInviteLink] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setMembers((await api<{ members: Member[] }>('/api/members')).members)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function invite(e: FormEvent) {
    e.preventDefault()
    setError('')
    setInviteLink('')
    const { data, error } = await authClient.organization.inviteMember({ email, role })
    if (error || !data) return setError(error?.message ?? 'Could not invite')
    setInviteLink(`${window.location.origin}${withBase('/accept-invite')}?id=${data.id}`)
    setEmail('')
  }

  return (
    <section className="card">
      <h1>Members</h1>
      <ul className="list">
        {members.map((m) => (
          <li key={m.id}>
            <span>
              {m.user.name} <span className="muted">{m.user.email}</span>
            </span>
            <span className="badge">{m.role}</span>
          </li>
        ))}
      </ul>

      {atLeast(me.role, 'admin') && (
        <>
          <h2>Invite someone</h2>
          <form onSubmit={invite} className="row">
            <input type="email" required placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button>Invite</button>
          </form>
          {inviteLink && (
            <p className="notice">
              Send them this link (it only works for that email address): <code>{inviteLink}</code>
            </p>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export default function MembersPage() {
  return (
    <AppShell>
      <Members />
    </AppShell>
  )
}
