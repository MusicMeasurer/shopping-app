import type { SupabaseClient } from '@supabase/supabase-js'

export interface DeletionChallenge {
  status: 'requested'
  id: string
  expiresAt: string
}

export function accountDeletionApi(client: Pick<SupabaseClient, 'rpc'>) {
  async function request(name: string, options: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, options)
    if (error) throw error
    return data
  }

  return {
    async start(remind: boolean): Promise<DeletionChallenge | { status: 'wait' }> {
      const response = await request('request_account_deletion', { p_remind: remind })
      if (response?.status === 'wait') return { status: 'wait' }
      if (response?.status !== 'requested' || typeof response.id !== 'string' || typeof response.expiresAt !== 'string')
        throw new Error('Invalid account deletion response')
      return { status: 'requested', id: response.id, expiresAt: response.expiresAt }
    },
    async confirm(challenge: string, code: string): Promise<'invalid' | 'expired' | 'deleted'> {
      const result = await request('confirm_account_deletion', { p_challenge: challenge, p_code: code })
      if (result !== 'invalid' && result !== 'expired' && result !== 'deleted') throw new Error('Invalid deletion confirmation')
      return result
    },
    async cancel(challenge: string) {
      await request('cancel_account_deletion', { p_challenge: challenge })
    },
    async register(device: { id: string; proof: string }) {
      if (await request('register_account_deletion_device', { p_device: device.id, p_proof: device.proof }) !== true)
        throw new Error('Installation not registered')
    },
    async isDeleted(account: string): Promise<boolean> {
      return await request('account_deletion_status', { p_account: account }) === true
    },
    async acknowledge(account: string, device: { id: string; proof: string }) {
      await request('acknowledge_account_deletion', { p_account: account, p_device: device.id, p_proof: device.proof })
    },
  }
}

export type AccountDeletionApi = ReturnType<typeof accountDeletionApi>
