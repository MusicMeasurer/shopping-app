/**
 * A short-lived, browser-local hint for a person who deleted their own account.
 * Only salted email fingerprints are stored, never the email or credentials.
 * This is UI context, NOT a server-side authorization or signup decision.
 */
const key = 'shopping-app:recent-deleted-emails:v1'
const cooldownMs = 24 * 60 * 60 * 1000
const maxMarkers = 8

type Marker = { salt: string; fingerprint: string; confirmedAt: number }

function read(storage: Pick<Storage, 'getItem'>, now: number): Marker[] {
  try {
    const data: unknown = JSON.parse(storage.getItem(key) ?? '[]')
    if (!Array.isArray(data)) return []
    return data.filter((row): row is Marker =>
      row !== null && typeof row === 'object' &&
      typeof row.salt === 'string' && /^[0-9a-f]{32}$/.test(row.salt) &&
      typeof row.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(row.fingerprint) &&
      typeof row.confirmedAt === 'number' && Number.isFinite(row.confirmedAt) &&
      row.confirmedAt <= now && now - row.confirmedAt < cooldownMs
    ).slice(-maxMarkers)
  } catch {
    return []
  }
}

async function fingerprint(address: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(salt + ':' + address.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

/** Call only after server-confirmed deletion; failure must not block deletion. */
export async function rememberDeletedEmail(address: string, now = Date.now(), storage: Storage = localStorage): Promise<void> {
  try {
    if (!address.trim() || !crypto?.subtle) return
    const salt = [...crypto.getRandomValues(new Uint8Array(16))]
      .map(value => value.toString(16).padStart(2, '0')).join('')
    const previous = read(storage, now)
    const current = await fingerprint(address, salt)
    storage.setItem(key, JSON.stringify([...previous, { salt, fingerprint: current, confirmedAt: now }].slice(-maxMarkers)))
  } catch { /* Browsers may deny storage or WebCrypto; fallback UI remains safe. */ }
}

/** A matching hint must never be treated as proof that the server is still blocking signup. */
export async function wasRecentlyDeletedEmail(address: string, now = Date.now(), storage: Storage = localStorage): Promise<boolean> {
  try {
    if (!address.trim() || !crypto?.subtle) return false
    for (const row of read(storage, now)) {
      if (row.fingerprint === await fingerprint(address, row.salt)) return true
    }
    return false
  } catch { return false }
}
