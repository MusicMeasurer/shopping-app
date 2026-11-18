import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseCloudConfig } from './cloud-config'

const authRequestTimeoutMs = 8000
const dataRequestTimeoutMs = 12000

/** Bound Auth and Data API requests so their UI actions can be retried. */
export function fetchWithCloudTimeout(authOrigin: string, fetcher: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.origin !== authOrigin) return fetcher(input, init)
    const timeoutMs = url.pathname.startsWith('/auth/v1/') ? authRequestTimeoutMs
      : url.pathname.startsWith('/rest/v1/') ? dataRequestTimeoutMs : null
    if (timeoutMs === null) return fetcher(input, init)
    const inheritedSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = inheritedSignal ? AbortSignal.any([inheritedSignal, timeout]) : timeout
    return fetcher(input, { ...init, signal })
  }
}

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
    global: { fetch: fetchWithCloudTimeout(new URL(config.url).origin, globalThis.fetch.bind(globalThis)) },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}
