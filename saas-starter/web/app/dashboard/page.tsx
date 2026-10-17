'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { AppShell, useMe } from '@/components/app-shell'
import { api, atLeast } from '@/lib/api'
import { API } from '@/lib/paths'

type Note = { id: string; title: string; body: string; created_at: string }

function Notes() {
  const { me } = useMe()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setNotes((await api<{ notes: Note[] }>(`${API}/notes`)).notes)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api(`${API}/notes`, { method: 'POST', body: { title, body } })
      setTitle('')
      setBody('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this note?')) return
    try {
      await api(`${API}/notes/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <section className="card">
        <h1>Notes</h1>
        <p className="muted">
          Only members of your organization can see these — Postgres enforces it ({me.tenancy === 'rls' ? 'row-level security' : 'a schema per organization'}).
        </p>
        <form onSubmit={add} className="stack">
          <input required maxLength={200} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea rows={3} placeholder="Write something…" value={body} onChange={(e) => setBody(e.target.value)} />
          <button>Add note</button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      {notes === null ? (
        <p className="muted">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="muted">No notes yet.</p>
      ) : (
        notes.map((n) => (
          <article key={n.id} className="card note">
            <header>
              <h3>{n.title}</h3>
              {atLeast(me.role, 'admin') && (
                <button className="link danger" onClick={() => remove(n.id)}>
                  Delete
                </button>
              )}
            </header>
            {n.body && <p>{n.body}</p>}
            <time className="muted">{new Date(n.created_at).toLocaleString()}</time>
          </article>
        ))
      )}
    </>
  )
}

export default function DashboardPage() {
  return (
    <AppShell>
      <Notes />
    </AppShell>
  )
}
