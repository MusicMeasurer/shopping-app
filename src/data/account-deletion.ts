import type { SupabaseClient } from '@supabase/supabase-js'

export interface DeletionChallenge {
  status: 'requested'
  id: string
  expiresAt: string
}

export type DeletionStatus = 'active' | 'deleted' | 'unconfirmed'
type Installation = { id: string; proof: string }
type RpcClient = Pick<SupabaseClient, 'rpc'>

export function accountDeletionApi(client: RpcClient, installationClient: RpcClient) {
  async function request(name: string, options: Record<string, unknown>, rpcClient = client) {
    const { data, error } = await rpcClient.rpc(name, options)
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
    async register(account: string, device: Installation) {
      if (await request('register_account_deletion_installation',
        { p_account: account, p_device: device.id, p_proof: device.proof }) !== true)
        throw new Error('Installation not registered')
    },
    async status(account: string, device: Installation): Promise<DeletionStatus> {
      const status = await request('account_deletion_installation_status',
        { p_account: account, p_device: device.id, p_proof: device.proof }, installationClient)
      if (status !== 'active' && status !== 'deleted' && status !== 'unconfirmed')
        throw new Error('Invalid installation status')
      return status
    },
    async acknowledge(account: string, device: Installation) {
      if (await request('acknowledge_account_deletion_installation',
        { p_account: account, p_device: device.id, p_proof: device.proof }, installationClient) !== true)
        throw new Error('Installation cleanup was not acknowledged')
    },
  }
}

export type AccountDeletionApi = ReturnType<typeof accountDeletionApi>
