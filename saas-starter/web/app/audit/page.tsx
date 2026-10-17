'use client'

import { useEffect, useState } from 'react'

import { AppShell } from '@/components/app-shell'
import { api } from '@/lib/api'
import { API } from '@/lib/paths'

type Event = { id: string; actor: string; action: string; target: string; created_at: string }

function Audit() {
  const [events, setEvents] = useState<Event[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ events: Event[] }>(`${API}/audit`)
      .then((r) => setEvents(r.events))
      .catch((e: Error) => setError(e.message === 'forbidden' ? 'Only admins can see the audit log.' : e.message))
  }, [])

  return (
    <section className="card">
      <h1>Audit log</h1>
      {error && <p className="error">{error}</p>}
      {events && events.length === 0 && <p className="muted">Nothing yet.</p>}
      {events && events.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td>
                  <code>{e.actor}</code>
                </td>
                <td>{e.action}</td>
                <td>
                  <code>{e.target}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default function AuditPage() {
  return (
    <AppShell>
      <Audit />
    </AppShell>
  )
}
