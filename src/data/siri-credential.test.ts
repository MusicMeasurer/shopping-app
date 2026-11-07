import { describe, expect, it, vi } from 'vitest'
import { enrollSiriCredential, revokeSiriCredential } from './siri-credential'

const listId = '550e8400-e29b-41d4-a716-446655440001'
const credentialId = '550e8400-e29b-41d4-a716-446655440002'
const token = 'a'.repeat(64)

describe('Siri credential client contract', () => {
  it('enrolls an explicit cloud list and validates one-time secret', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      credential_id: credentialId, token, expires_in_days: 90,
    }, error: null })
    const result = await enrollSiriCredential({ rpc } as never, listId)
    expect(result).toEqual({ credentialId, token, expiresInDays: 90 })
    expect(rpc).toHaveBeenCalledWith('enroll_siri_shortcut', { p_list: listId })
  })

  it('does not contact server for invalid list IDs', async () => {
    const rpc = vi.fn()
    await expect(enrollSiriCredential({ rpc } as never, 'local-list')).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed enrollment responses', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      credential_id: credentialId, token: 'weak', expires_in_days: 90,
    }, error: null })
    await expect(enrollSiriCredential({ rpc } as never, listId)).rejects.toThrow()
  })

  it('revokes only by explicit credential identifier', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await expect(revokeSiriCredential({ rpc } as never, credentialId)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('revoke_siri_shortcut', { p_credential: credentialId })
  })
})
