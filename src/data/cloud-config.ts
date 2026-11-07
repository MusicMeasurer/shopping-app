export interface CloudConfig { url: string; publishableKey: string }

/** Only public Supabase project configuration belongs in browser code. */
export function parseCloudConfig(url?: string, key?: string): CloudConfig | null {
  if (!url && !key) return null
  if (!url || !key) throw new Error('Cloud configuration is incomplete')
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('Invalid cloud project endpoint')
  }
  if (!key.startsWith('sb_publishable_')) throw new Error('Only public client keys are permitted')
  return { url: endpoint.origin, publishableKey: key }
}
