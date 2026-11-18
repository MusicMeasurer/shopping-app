import { describe, expect, it } from 'vitest'
import { parseCloudConfig } from './cloud-config'

describe('public cloud configuration', () => {
  it('preserves local-only mode without configuration', () => {
    expect(parseCloudConfig()).toBeNull()
  })
  it('rejects incomplete configuration', () => {
    expect(() => parseCloudConfig('https://example.supabase.co')).toThrow()
  })
  it('accepts a public project endpoint and publishable key', () => {
    expect(parseCloudConfig('https://example.supabase.co/', 'sb_publishable_test')).toEqual({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' })
  })
  it('rejects insecure endpoints and privileged keys', () => {
    expect(() => parseCloudConfig('http://example.supabase.co/', 'sb_publishable_test')).toThrow()
    expect(() => parseCloudConfig('https://example.supabase.co/', 'service_role_secret')).toThrow()
    expect(() => parseCloudConfig('https://example.supabase.co.evil.test/', 'sb_publishable_test')).toThrow()
  })
})
