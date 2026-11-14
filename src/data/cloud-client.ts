import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseCloudConfig } from './cloud-config'

const authRequestTimeoutMs = 8000

/** Bound the actual request so a failed operation can be retried by the SDK. */
export function fetchWithAuthTimeout(authOrigin: string, fetcher: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.origin !== authOrigin || !url.pathname.startsWith('/auth/v1/')) return fetcher(input, init)
    const inheritedSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const timeout = AbortSignal.timeout(authRequestTimeoutMs)
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
    global: { fetch: fetchWithAuthTimeout(new URL(config.url).origin, globalThis.fetch.bind(globalThis)) },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}
