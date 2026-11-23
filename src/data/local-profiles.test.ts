import { describe, expect, it } from 'vitest'
import { activeProfile, addProfile, bindProfile, defaultArchiveRecipient, initializeProfiles, removeProfileMetadata, switchProfile } from './local-profiles'

describe('local profile model', () => {
  it('creates an offline profile before any cloud account exists', () => {
    const state = initializeProfiles('owner-local', 1)
    expect(activeProfile(state)).toEqual({ id: 'owner-local', cloudAccountId: null, createdAt: 1 })
  })
  it('keeps an unregistered owner profile when a friend signs in and deletes their local profile', () => {
    const owner = initializeProfiles('owner-local', 1)
    const friend = addProfile(owner, { id: 'friend-local', cloudAccountId: 'friend-account', createdAt: 2 })
    expect(activeProfile(friend).cloudAccountId).toBe('friend-account')
    const afterSignOut = switchProfile(friend, 'owner-local')
    const afterDeletion = removeProfileMetadata(afterSignOut, 'friend-local')
    expect(afterDeletion).toEqual(owner)
  })
  it('preserves account binding and prevents cross-account reassignment', () => {
    const owner = bindProfile(initializeProfiles('local-a', 1), 'local-a', 'account-a')
    expect(() => bindProfile(owner, 'local-a', 'account-b')).toThrow('another account')
    const both = addProfile(owner, { id: 'local-b', cloudAccountId: 'account-b', createdAt: 2 })
    expect(() => bindProfile(both, 'local-a', 'account-b')).toThrow()
    expect(switchProfile(both, 'local-a').profiles).toEqual(both.profiles)
  })
  it('does not allow duplicate profiles, duplicate accounts or deleting the last profile', () => {
    const owner = initializeProfiles('owner', 1)
    expect(() => addProfile(owner, { id: 'owner', cloudAccountId: null, createdAt: 2 })).toThrow()
    expect(() => removeProfileMetadata(owner, 'owner')).toThrow()
    const bound = bindProfile(owner, 'owner', 'account-a')
    expect(() => addProfile(bound, { id: 'second', cloudAccountId: 'account-a', createdAt: 2 })).toThrow()
  })
  it('rejects invalid profile metadata before it can enter the registry', () => {
    const owner = initializeProfiles('owner', 1)
    expect(() => addProfile(owner, { id: 'bad-time', cloudAccountId: null, createdAt: Number.NaN })).toThrow('timestamp')
    expect(() => addProfile(owner, { id: 'bad-account', cloudAccountId: '   ', createdAt: 2 })).toThrow('cloud account')
    expect(owner.profiles).toHaveLength(1)
  })
  it('does not modify the original registry when switching', () => {
    const owner = initializeProfiles('owner', 1)
    const friend = addProfile(owner, { id: 'friend', cloudAccountId: null, createdAt: 2 })
    expect(owner.activeProfileId).toBe('owner')
    expect(friend.activeProfileId).toBe('friend')
  })
})


describe('archive recipient preference', () => {
  const a = { id: 'a', cloudAccountId: 'cloud-a', createdAt: 1, lastCloudActivatedAt: 30 }
  const b = { id: 'b', cloudAccountId: 'cloud-b', createdAt: 20, lastCloudActivatedAt: 25, lastActivatedAt: 100 }
  const local = { id: 'local', cloudAccountId: null, createdAt: 40, lastActivatedAt: 200 }
  it('prefers the active cloud account, then the last activated cloud profile, even over newer local activity', () => {
    expect(defaultArchiveRecipient([a, b, local], local.id)?.id).toBe(a.id)
    expect(defaultArchiveRecipient([a, b, local], local.id, b.cloudAccountId)?.id).toBe(b.id)
    expect(defaultArchiveRecipient([b, local], local.id)?.id).toBe(b.id)
  })
  it('falls back to the current or last activated remaining local profile and handles no recipient', () => {
    const older = { id: 'older', cloudAccountId: null, createdAt: 2, lastActivatedAt: 300 }
    expect(defaultArchiveRecipient([local, older], local.id)?.id).toBe(local.id)
    expect(defaultArchiveRecipient([local, older], 'deleted')?.id).toBe(older.id)
    expect(defaultArchiveRecipient([], 'deleted')).toBeUndefined()
  })
  it('records local activation without modifying the original registry', () => {
    const initial = initializeProfiles('a', 1)
    const both = addProfile(initial, { id: 'b', cloudAccountId: null, createdAt: 2 })
    const next = switchProfile(both, 'a', 100)
    expect(next.profiles[0].lastActivatedAt).toBe(100)
    expect(both.profiles[0].lastActivatedAt).toBeUndefined()
  })
})
