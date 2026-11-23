import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrationEmailStatus, signupCooldownMessage } from './registration-email-status'

describe('server registration cooldown status', () => {
  function client(data: unknown, error: unknown = null) {
    const rpc = vi.fn().mockResolvedValue({ data, error })
    return { rpc } as unknown as Pick<SupabaseClient, 'rpc'> & { rpc: typeof rpc }
  }
  it('requests the status for the supplied address, without any device identity', async () => {
    const api = client('cooldown')
    expect(await registrationEmailStatus(api, ' Test@Example.Invalid ')).toBe('cooldown')
    expect(api.rpc).toHaveBeenCalledWith('registration_email_status', { p_email: 'Test@Example.Invalid' })
    expect(signupCooldownMessage).toContain('24 часа с момента завершения удаления')
  })
  it('allows an available status and rejects invalid or unavailable responses', async () => {
    expect(await registrationEmailStatus(client('available'), 'new@example.invalid')).toBe('available')
    await expect(registrationEmailStatus(client([]), 'x@example.invalid')).rejects.toThrow('Invalid')
    await expect(registrationEmailStatus(client(null, { code: 'PGRST202', message: 'not found' }), 'x@example.invalid'))
      .rejects.toMatchObject({ code: 'PGRST202' })
  })
})
