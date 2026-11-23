import { describe, expect, it } from 'vitest'
import { rememberDeletedEmail, wasRecentlyDeletedEmail } from './recent-deleted-email'

function fakeStorage() {
  const data = new Map<string, string>()
  return {
    data,
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) },
    } as Storage,
  }
}

describe('recent deletion email hints', () => {
  it('stores only a salted fingerprint and matches normalized email on this device', async () => {
    const { data, storage } = fakeStorage()
    const start = Date.parse('2026-11-23T06:33:27Z')
    await rememberDeletedEmail(' Deleted.Example@Mail.Test ', start, storage)
    const raw = [...data.values()].join(' ')
    expect(raw).not.toContain('Deleted.Example')
    expect(raw).not.toContain('mail.test')
    expect(await wasRecentlyDeletedEmail('deleted.example@mail.test', start + 1000, storage)).toBe(true)
    expect(await wasRecentlyDeletedEmail('another@mail.test', start + 1000, storage)).toBe(false)
  })

  it('expires the local hint after 24 hours without claiming a server unblock', async () => {
    const { storage } = fakeStorage()
    await rememberDeletedEmail('example@domain.test', 10_000, storage)
    expect(await wasRecentlyDeletedEmail('example@domain.test', 10_000 + 24 * 60 * 60 * 1000 - 1, storage)).toBe(true)
    expect(await wasRecentlyDeletedEmail('example@domain.test', 10_000 + 24 * 60 * 60 * 1000, storage)).toBe(false)
  })

  it('keeps several independent recent hints and handles inaccessible browser storage', async () => {
    const { storage } = fakeStorage()
    await rememberDeletedEmail('first@example.test', 20_000, storage)
    await rememberDeletedEmail('second@example.test', 21_000, storage)
    expect(await wasRecentlyDeletedEmail('first@example.test', 22_000, storage)).toBe(true)
    expect(await wasRecentlyDeletedEmail('second@example.test', 22_000, storage)).toBe(true)
    const unavailable = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } as unknown as Storage
    await expect(rememberDeletedEmail('third@example.test', 22_000, unavailable)).resolves.toBeUndefined()
    await expect(wasRecentlyDeletedEmail('third@example.test', 22_000, unavailable)).resolves.toBe(false)
  })
})
