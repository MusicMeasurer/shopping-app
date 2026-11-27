import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudClient, fetchWithCloudTimeout } from './cloud-client'
import { exportAuthStages } from './auth-flow-diagnostics'

afterEach(() => vi.unstubAllGlobals())

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
    const boundedFetch = fetchWithCloudTimeout('https://example.supabase.co', request)
    await boundedFetch('https://example.supabase.co/auth/v1/logout', { signal: caller.signal })
    const signal = request.mock.calls[0][1]?.signal
    expect(spy).toHaveBeenCalledWith(8000)
    expect(signal?.aborted).toBe(false)
    caller.abort()
    expect(signal?.aborted).toBe(true)
    await boundedFetch('https://example.supabase.co/rest/v1/e4_archive_items?select=name')
    expect(spy).toHaveBeenLastCalledWith(12000)
    expect(request.mock.calls[1][1]?.signal).toBe(deadline.signal)
    await boundedFetch('https://example.supabase.co/rest/v1/shopping_lists')
    expect(request.mock.calls[2][1]?.signal).toBe(deadline.signal)
    await boundedFetch('https://cdn.example.org/data')
    expect(request.mock.calls[3][1]).toBeUndefined()
  } finally {
    spy.mockRestore()
  }
})

it('distinguishes a deadline before headers from an HTTP success without reading sensitive bodies', async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) } })
  const deadline = new AbortController()
  const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const response = new Response('private response', { status: 200 })
  const request = vi.fn<typeof fetch>()
    .mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    .mockResolvedValueOnce(response)
  try {
    const bounded = fetchWithCloudTimeout('https://example.supabase.co', request)
    const pending = bounded('https://example.supabase.co/auth/v1/token?grant_type=password', { body: 'private password' })
    deadline.abort(new DOMException('private cause', 'TimeoutError'))
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    spy.mockReturnValue(new AbortController().signal)
    expect(await bounded('https://example.supabase.co/auth/v1/token?grant_type=password')).toBe(response)
    expect(response.bodyUsed).toBe(false)
    const raw = exportAuthStages()
    const events = JSON.parse(raw).events
    expect(events).toEqual([
      expect.objectContaining({ stage: 'fetch_start', endpoint: 'password' }),
      expect.objectContaining({ stage: 'fetch_timeout', request: events[0].request }),
      expect.objectContaining({ stage: 'fetch_start', endpoint: 'password' }),
      expect.objectContaining({ stage: 'fetch_headers', request: events[2].request, status: 200 }),
    ])
    expect(events[0].request).not.toBe(events[2].request)
    expect(raw).not.toContain('private')
    expect(raw).not.toContain('supabase.co')
  } finally { spy.mockRestore() }
})
