import type { SupabaseClient } from '@supabase/supabase-js'

/** Minimal public cooldown check: intentionally device-independent. */
export type RegistrationEmailStatus = 'available' | 'cooldown'

export const signupCooldownMessage =
  'Регистрация с этим адресом временно недоступна. После удаления аккаунта повторная регистрация возможна через 24 часа с момента завершения удаления.'

export async function registrationEmailStatus(
  client: Pick<SupabaseClient, 'rpc'>, email: string,
): Promise<RegistrationEmailStatus> {
  const { data, error } = await client.rpc('registration_email_status', { p_email: email.trim() })
  if (error) throw error
  if (data !== 'available' && data !== 'cooldown') throw new Error('Invalid registration email status')
  return data
}
