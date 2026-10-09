import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config.js'

const base = {
  APP_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@db:5432/app',
  SESSION_SECRET: 's'.repeat(48),
  CSRF_SECRET: 'c'.repeat(32),
}

describe('config', () => {
  it('reads what the platform injects', () => {
    const cfg = loadConfig({ ...base, PUBLIC_URL: 'https://d1.cloudfront.net/', TENANCY_MODE: 'schema' })
    expect(cfg.publicUrl).toBe('https://d1.cloudfront.net')
    expect(cfg.tenancy).toBe('schema')
    expect(cfg.pgSsl).toBe('verify-full')
    expect(cfg.mfaRequired).toBe(true)
    expect(cfg.seedMode).toBe('none')
  })

  it('has no secret fallbacks outside local dev', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET/)
    expect(() => loadConfig({ ...base, CSRF_SECRET: 'short' })).toThrow(/CSRF_SECRET/)
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/)
  })

  it('rejects an unknown tenancy mode', () => {
    expect(() => loadConfig({ ...base, TENANCY_MODE: 'none' })).toThrow(/TENANCY_MODE/)
  })

  it('boots locally with zero configuration', () => {
    const cfg = loadConfig({})
    expect(cfg.appEnv).toBe('local')
    expect(cfg.pgSsl).toBe('disable')
  })
})
