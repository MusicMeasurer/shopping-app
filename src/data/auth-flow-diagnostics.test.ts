import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportAuthStages, markAuthStage } from './auth-flow-diagnostics'

afterEach(() => vi.unstubAllGlobals())

describe('privacy-safe account diagnostics', () => {
  it('stores only approved stage names and sanitized error codes, never credentials', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    })
    markAuthStage('credentials_requested')
    markAuthStage('identity_unavailable', {
      code: 'postgrest_503', status: 503,
      message: 'hidden@example.invalid password=super-secret userId=98765',
    })
    markAuthStage('identity_rejected', {
      code: 'hidden@example.invalid', status: 403,
      message: 'never record backend messages',
    })
    const diagnostic = exportAuthStages()
    expect(diagnostic).toContain('credentials_requested')
    expect(diagnostic).toContain('postgrest_503')
    expect(diagnostic).toContain('http_403')
    expect(diagnostic).not.toContain('hidden@example.invalid')
    expect(diagnostic).not.toContain('super-secret')
    expect(diagnostic).not.toContain('98765')
  })

  it('never interrupts login if Safari denies access to session storage', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('storage denied') },
      setItem: () => { throw new Error('storage denied') },
    })
    expect(() => markAuthStage('session_recheck')).not.toThrow()
    expect(JSON.parse(exportAuthStages())).toEqual({ version: 1, events: [] })
  })
})
