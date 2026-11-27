import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseCloudConfig } from './cloud-config'
import { markAuthTransport, nextAuthRequest, type AuthEndpoint } from './auth-flow-diagnostics'

const authRequestTimeoutMs = 8000
const dataRequestTimeoutMs = 12000

// Only fixed, privacy-safe labels. Never retain the URL or any request content.
function diagnosticEndpoint(url: URL): AuthEndpoint | undefined {
  switch (url.pathname) {
    case '/auth/v1/token': return url.searchParams.get('grant_type') === 'password' ? 'password' : 'token'
    case '/auth/v1/user': return 'user'
    case '/auth/v1/logout': return 'logout'
    case '/auth/v1/verify': return 'verify'
    case '/auth/v1/recover': return 'recover'
    case '/auth/v1/resend': return 'resend'
    case '/rest/v1/rpc/account_deletion_installation_status': return 'installation_status'
    default: return undefined
  }
}

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
    const endpoint = diagnosticEndpoint(url)
    if (!endpoint) return fetcher(input, { ...init, signal })
    const request = nextAuthRequest()
    const started = performance.now()
    const fields = () => ({ request, endpoint, elapsedMs: Math.max(0, Math.round(performance.now() - started)) })
    markAuthTransport('fetch_start', fields())
    // Fetch resolves at headers, not at body consumption. Keep the existing
    // SDK/body path intact; the higher-level Auth stages record its outcome.
    // Do not clone, read or buffer the sensitive response.
    const failure = (cause: unknown): never => {
      markAuthTransport(signal.aborted
        ? (timeout.aborted && signal.reason === timeout.reason ? 'fetch_timeout' : 'fetch_aborted')
        : 'fetch_failed', fields())
      throw cause
    }
    try {
      return fetcher(input, { ...init, signal }).then(response => {
        markAuthTransport('fetch_headers', { ...fields(), status: response.status })
        return response
      }, failure)
    } catch (cause) {
      return Promise.reject(cause).catch(failure)
    }
  }
}

/**
 * Browser-only public client. Never pass a service-role or secret API key here.
 * No cloud client is created when the build has no cloud configuration.
 */
export function createCloudClient(
  url: string | undefined = import.meta.env.VITE_SUPABASE_URL,
  key: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  mode: 'workspace' | 'email-code' | 'installation' = 'workspace',
): SupabaseClient | null {
  const config = parseCloudConfig(url, key)
  if (!config) return null
  return createClient(config.url, config.publishableKey, {
    global: { fetch: fetchWithCloudTimeout(new URL(config.url).origin, globalThis.fetch.bind(globalThis)) },
    auth: {
      persistSession: mode === 'workspace',
      autoRefreshToken: mode === 'workspace',
      detectSessionInUrl: mode === 'workspace',
      ...(mode !== 'workspace' ? { storageKey: 'shopping-auth-' + mode + '-' + crypto.randomUUID() } : {}),
    },
  })
}

/** Email confirmation and password recovery use a throwaway, in-memory session. */
export function createAccountEmailClient() {
  return createCloudClient(undefined, undefined, 'email-code')
}
