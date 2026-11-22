import type { RemoteMutation } from './remote-mutation'
import { parseSiriAddRequest } from './siri-add-request'

/**
 * Server-side adapter input. The caller must authenticate the scoped Shortcut
 * credential and verify its permission to add to the target list BEFORE
 * calling this helper. This helper does not authorize a request.
 *
 * Use the same item UUID for all retries of the same operation UUID.
 */
export function siriAddMutation(input: unknown): RemoteMutation {
  const request = parseSiriAddRequest(input)
  return {
    kind: 'add',
    operationId: request.operationId,
    itemId: request.operationId,
    listId: request.listId,
    name: request.name,
    purchased: false,
  }
}
