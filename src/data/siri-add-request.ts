/** Strict, transport-independent validation for Siri add-item commands.
 * Authentication, list authorization and replay protection MUST happen on the server.
 */
export type SiriAddRequest = {
  operationId: string
  listId: string
  name: string
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseSiriAddRequest(input: unknown): SiriAddRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid request')
  }
  const data = input as Record<string, unknown>
  if (Object.keys(data).some(key => !['operationId', 'listId', 'name'].includes(key))) {
    throw new Error('Unexpected fields')
  }
  if (typeof data.operationId !== 'string' || !uuid.test(data.operationId)) {
    throw new Error('Invalid operation ID')
  }
  if (typeof data.listId !== 'string' || !uuid.test(data.listId)) {
    throw new Error('Explicit cloud list ID required')
  }
  if (typeof data.name !== 'string') {
    throw new Error('Invalid item name')
  }
  const name = data.name.trim()
  if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Invalid item name')
  }
  return { operationId: data.operationId, listId: data.listId, name }
}
