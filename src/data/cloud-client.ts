import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseCloudConfig } from './cloud-config'

/**
 * Browser-only public client. Never pass a service-role or secret API key here.
 * No cloud client is created when the build has no cloud configuration.
 */
export function createCloudClient(
  url: string | undefined = import.meta.env.VITE_SUPABASE_URL,
  key: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
): SupabaseClient | null {
  const config = parseCloudConfig(url, key)
  if (!config) return null
  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}
