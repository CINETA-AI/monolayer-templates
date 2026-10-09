import { describe, expect, it } from 'vitest'

import { issueCsrfToken, originAllowed, verifyCsrfToken } from '../src/csrf.js'

const SECRET = 'x'.repeat(32)

describe('csrf token', () => {
  it('round-trips for the session it was issued to', () => {
    const t = issueCsrfToken(SECRET, 'sess-1')
    expect(verifyCsrfToken(SECRET, 'sess-1', t)).toBe(true)
  })

  it('is useless with another session or secret', () => {
    const t = issueCsrfToken(SECRET, 'sess-1')
    expect(verifyCsrfToken(SECRET, 'sess-2', t)).toBe(false)
    expect(verifyCsrfToken('y'.repeat(32), 'sess-1', t)).toBe(false)
  })

  it('rejects missing, malformed and tampered tokens', () => {
    const t = issueCsrfToken(SECRET, 'sess-1')
    for (const bad of [undefined, null, '', 'abc', '.', `${t}x`, `x${t}`, t.split('.')[0] + '.']) {
      expect(verifyCsrfToken(SECRET, 'sess-1', bad)).toBe(false)
    }
  })
})

describe('origin check', () => {
  const app = 'https://d123.cloudfront.net'
  it('lets safe methods through', () => {
    expect(originAllowed('GET', undefined, app)).toBe(true)
  })
  it('requires the app origin on mutating methods', () => {
    expect(originAllowed('POST', app, app)).toBe(true)
    expect(originAllowed('POST', 'https://evil.example', app)).toBe(false)
    expect(originAllowed('DELETE', undefined, app)).toBe(false)
  })
})
