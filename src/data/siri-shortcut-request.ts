import { parseSiriAddRequest, type SiriAddRequest } from './siri-add-request'

const tokenPattern = /^[0-9a-f]{64}$/

/** Build a Shortcuts-compatible HTTPS POST. Never put credentials or item
 * names in URL parameters; Shortcuts should create operationId once per item.
 */
export function createSiriShortcutRequest(
  endpoint: string,
  token: string,
  input: SiriAddRequest,
): { url: string; method: 'POST'; headers: Record<string, string>; body: string } {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.search || url.hash || !url.hostname.endsWith('.supabase.co') ||
      url.pathname !== '/functions/v1/siri-add') {
    throw new Error('Invalid Siri endpoint')
  }
  if (!tokenPattern.test(token)) throw new Error('Invalid Siri credential')
  const command = parseSiriAddRequest(input)
  return {
    url: url.toString(),
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  }
}
