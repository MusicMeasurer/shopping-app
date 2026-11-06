import { describe, expect, it } from 'vitest'
import { createCloudClient } from './cloud-client'

describe('Supabase browser client setup', () => {
  it('keeps the existing app local-only without cloud configuration', () => {
    expect(createCloudClient(undefined, undefined)).toBeNull()
  })
  it('rejects privileged keys before creating a client', () => {
    expect(() => createCloudClient('https://example.supabase.co', 'sb_secret_example')).toThrow()
  })
  it('creates a client with the configured public endpoint', () => {
    const client = createCloudClient('https://example.supabase.co', 'sb_publishable_test')
    expect(client?.supabaseUrl).toBe('https://example.supabase.co')
    expect(client?.auth).toBeDefined()
  })
})
