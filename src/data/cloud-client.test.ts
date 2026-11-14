import { describe, expect, it, vi } from 'vitest'
import { createCloudClient, fetchWithAuthTimeout } from './cloud-client'

describe('Supabase browser client setup', () => {
  it('keeps the existing app local-only without cloud configuration', () => {
    expect(createCloudClient(undefined, undefined)).toBeNull()
  })
  it('rejects privileged keys before creating a client', () => {
    expect(() => createCloudClient('https://example.supabase.co', 'sb_secret_example')).toThrow()
  })
  it('creates a client with a public auth API', () => {
    const client = createCloudClient('https://example.supabase.co', 'sb_publishable_test')
    expect(client).not.toBeNull()
    expect(client?.auth.signInWithPassword).toBeTypeOf('function')
    expect(client?.auth.onAuthStateChange).toBeTypeOf('function')
  })
})

it('sets an abort deadline for Auth and preserves the caller signal', async () => {
  const deadline = new AbortController()
  const caller = new AbortController()
  const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response())
  try {
    const boundedFetch = fetchWithAuthTimeout('https://example.supabase.co', request)
    await boundedFetch('https://example.supabase.co/auth/v1/logout', { signal: caller.signal })
    const signal = request.mock.calls[0][1]?.signal
    expect(spy).toHaveBeenCalledWith(8000)
    expect(signal?.aborted).toBe(false)
    caller.abort()
    expect(signal?.aborted).toBe(true)
    await boundedFetch('https://example.supabase.co/rest/v1/shopping_lists')
    expect(request.mock.calls[1][1]).toBeUndefined()
  } finally {
    spy.mockRestore()
  }
})
