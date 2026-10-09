'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { AppShell } from '@/components/app-shell'
import { api } from '@/lib/api'

type Provider = {
  providerId: string
  domain: string
  issuer: string
  domainVerified?: boolean
  oidcConfig?: unknown
  samlConfig?: unknown
}
type DnsRecord = { type: string; name: string; value: string }

const DNS_PREFIX = 'saas-sso' // matches SSO_DNS_PREFIX in the API

/** Better Auth's own SSO endpoints (admin-checked by Better Auth). */
async function betterAuth<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/auth/sso/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { message?: string }
  if (!res.ok) throw new Error(data.message ?? res.statusText)
  return data
}

function Sso() {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const [providers, setProviders] = useState<Provider[]>([])
  const [protocol, setProtocol] = useState<'oidc' | 'saml'>('oidc')
  const [form, setForm] = useState({ providerId: '', domain: '', issuer: '', clientId: '', clientSecret: '', entryPoint: '', cert: '' })
  const [dns, setDns] = useState<Record<string, DnsRecord>>({})
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setProviders((await betterAuth<{ providers: Provider[] }>('providers')).providers)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const id = form.providerId || '<connection-id>'

  async function connect(e: FormEvent) {
    e.preventDefault()
    setError('')
    const base = { providerId: form.providerId, domain: form.domain, issuer: form.issuer }
    const body =
      protocol === 'oidc'
        ? { ...base, oidcConfig: { clientId: form.clientId, clientSecret: form.clientSecret } }
        : {
            ...base,
            samlConfig: {
              entryPoint: form.entryPoint,
              cert: form.cert,
              callbackUrl: `${origin}/api/auth/sso/saml2/sp/acs/${form.providerId}`,
              idpMetadata: { entityID: form.issuer },
              spMetadata: {},
            },
          }
    try {
      const out = await api<{ dnsRecord: DnsRecord }>('/api/sso/providers', { method: 'POST', body })
      setDns({ ...dns, [form.providerId]: out.dnsRecord })
      setForm({ providerId: '', domain: '', issuer: '', clientId: '', clientSecret: '', entryPoint: '', cert: '' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function showDns(p: Provider) {
    try {
      const { domainVerificationToken } = await betterAuth<{ domainVerificationToken: string }>('request-domain-verification', {
        providerId: p.providerId,
      })
      setDns({ ...dns, [p.providerId]: { type: 'TXT', name: `_${DNS_PREFIX}-${p.providerId}.${p.domain}`, value: domainVerificationToken } })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function verify(p: Provider) {
    setError('')
    try {
      await betterAuth('verify-domain', { providerId: p.providerId })
      await load()
    } catch (e) {
      setError(`${(e as Error).message} — DNS changes can take a few minutes.`)
    }
  }

  async function remove(p: Provider) {
    if (!confirm(`Remove the ${p.domain} SSO connection? Its users fall back to password sign-in.`)) return
    try {
      await api(`/api/sso/providers/${encodeURIComponent(p.providerId)}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <section className="card">
        <h1>Single sign-on</h1>
        <p className="muted">
          Connect your identity provider (Okta, Entra ID, Google Workspace…). People with an email at the verified domain
          sign in through it.
        </p>
        {providers.length === 0 && <p className="muted">No connections yet.</p>}
        <ul className="list">
          {providers.map((p) => (
            <li key={p.providerId} className="provider">
              <div>
                <strong>{p.domain}</strong> <span className="muted">{p.oidcConfig ? 'OIDC' : 'SAML'} · {p.providerId}</span>
                {dns[p.providerId] && !p.domainVerified && <DnsBox record={dns[p.providerId]!} />}
              </div>
              <div className="row">
                {p.domainVerified ? (
                  <span className="badge ok">Verified</span>
                ) : (
                  <>
                    <span className="badge warn">Domain not verified</span>
                    {!dns[p.providerId] && (
                      <button className="link" onClick={() => showDns(p)}>
                        Show DNS record
                      </button>
                    )}
                    <button className="secondary" onClick={() => verify(p)}>
                      Verify
                    </button>
                  </>
                )}
                <button className="link danger" onClick={() => remove(p)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>New connection</h2>
        <div className="row tabs">
          <button className={protocol === 'oidc' ? '' : 'secondary'} onClick={() => setProtocol('oidc')}>
            OIDC
          </button>
          <button className={protocol === 'saml' ? '' : 'secondary'} onClick={() => setProtocol('saml')}>
            SAML
          </button>
        </div>

        <div className="notice">
          In your identity provider, use:
          {protocol === 'oidc' ? (
            <p>
              Redirect URI <code>{`${origin}/api/auth/sso/callback/${id}`}</code>
            </p>
          ) : (
            <p>
              ACS URL <code>{`${origin}/api/auth/sso/saml2/sp/acs/${id}`}</code>
              <br />
              SP metadata <code>{`${origin}/api/auth/sso/saml2/sp/metadata?providerId=${id}`}</code>
            </p>
          )}
        </div>

        <form onSubmit={connect} className="stack">
          <label>
            Connection ID <span className="muted">(letters, numbers, dashes)</span>
            <input required pattern="[a-z0-9-]{2,40}" placeholder="okta" value={form.providerId} onChange={set('providerId')} />
          </label>
          <label>
            Email domain
            <input required placeholder="company.com" value={form.domain} onChange={set('domain')} />
          </label>
          <label>
            {protocol === 'oidc' ? 'Issuer URL' : 'IdP entity ID (URL)'}
            <input required type="url" placeholder="https://company.okta.com" value={form.issuer} onChange={set('issuer')} />
          </label>
          {protocol === 'oidc' ? (
            <>
              <label>
                Client ID
                <input required value={form.clientId} onChange={set('clientId')} />
              </label>
              <label>
                Client secret
                <input required type="password" value={form.clientSecret} onChange={set('clientSecret')} />
              </label>
            </>
          ) : (
            <>
              <label>
                IdP sign-in URL
                <input required type="url" value={form.entryPoint} onChange={set('entryPoint')} />
              </label>
              <label>
                IdP signing certificate (PEM)
                <textarea required rows={5} value={form.cert} onChange={set('cert')} />
              </label>
            </>
          )}
          <button>Connect</button>
        </form>
      </section>
    </>
  )
}

function DnsBox({ record }: { record: DnsRecord }) {
  return (
    <div className="notice">
      Prove you own this domain — add a DNS record, then press Verify:
      <p>
        <code>{record.type}</code> <code>{record.name}</code> <code>{record.value}</code>
      </p>
    </div>
  )
}

export default function SsoPage() {
  return (
    <AppShell>
      <Sso />
    </AppShell>
  )
}
