import { describe, expect, it } from 'vitest'
import { syncNoticeText, localSyncListId, lostSyncListId, relatedItemText, deferListFallback, cachedFallbackList } from './sync-notice-ui'
import { newSemanticState, type AccountSemanticState } from '../data/sync-event-state'
import type { SyncNotice } from '../data/sync-event-fate'
const base: SyncNotice = { position: '1', operationId: 'op', entity: 'list', sourceId: 'a', sourceName: 'Продукты', reason: 'deleted' }
describe('sync context notice UI contract', () => {
  it('names the confirmed deletion and source', () => {
    expect(syncNoticeText(base)).toEqual({ title: 'Список удалён', message: 'Список «Продукты» удалён на другом устройстве.' })
  })
  it('uses the final confirmed merge recipient name', () => {
    expect(syncNoticeText({ ...base, reason: 'merged', targetListId: 'c', targetListName: 'Новый C' }).message)
      .toBe('Список «Продукты» объединён со списком «Новый C» на другом устройстве.')
  })
  it('distinguishes an archived item from completion without proof of archive', () => {
    expect(syncNoticeText({ ...base, entity: 'item', reason: 'archived' }).message).toContain('перемещён в архив')
    expect(syncNoticeText({ ...base, entity: 'item', reason: 'completed' }).message).not.toContain('архив')
    expect(syncNoticeText({ ...base, entity: 'item', reason: 'merged' }).message).not.toContain('архив')
    expect(syncNoticeText({ ...base, reason: 'completed' }).message).toContain('завершён')
  })
  it('maps recovery by stable ID only and refuses unavailable targets', () => {
    const bindings = { local: 'remote', gone: 'deleted' }
    expect(localSyncListId('remote', bindings, [{ id: 'local' }, { id: 'draft' }])).toBe('local')
    expect(localSyncListId('draft', bindings, [{ id: 'draft' }])).toBe('draft')
    expect(localSyncListId('deleted', bindings, [{ id: 'local' }])).toBeNull()
    expect(localSyncListId(null, bindings, [{ id: 'local' }])).toBeNull()
  })
  it('hides only a lost list, never the surviving list of a removed item', () => {
    const origin = { accountId: 'account', listId: 'a', itemId: 'item' }
    expect(lostSyncListId({ origin, fate: { kind: 'recover', nextListId: 'a', resetViewport: true } })).toBeNull()
    expect(lostSyncListId({ origin, fate: { kind: 'recover', nextListId: 'b', resetViewport: true } })).toBe('a')
    expect(lostSyncListId(undefined)).toBeNull()
  })
  it('includes the independently confirmed fate of an edited item in a lost list', () => {
    const item = { ...base, entity: 'item' as const, sourceId: 'item', sourceName: 'Чай', reason: 'archived' as const }
    expect(relatedItemText(base, item)).toBe('Товар «Чай» перемещён в архив на другом устройстве.')
    expect(relatedItemText(item, item)).toBeUndefined()
    expect(relatedItemText(base)).toBeUndefined()
  })

  it('does not strand a signed-out or offline workspace behind an incomplete server batch', () => {
    const state: AccountSemanticState = { ...newSemanticState('account'), ready: false,
      evidence: { accountId: 'account', position: '3', caughtUp: false, removals: [] } }
    expect(deferListFallback(true, true, state, false, false)).toBe(true)
    expect(deferListFallback(true, true, state, false, true)).toBe(false)
    expect(deferListFallback(true, false, state, false, true)).toBe(true)
    expect(deferListFallback(true, true, state, true, true)).toBe(true)
    expect(deferListFallback(false, false, state, false, false)).toBe(false)
  })
  it('preserves known pending and presented notices when disconnected', () => {
    const origin = { accountId: 'account', listId: 'a' }
    const candidate = { origin, fate: { kind: 'recover' as const, nextListId: 'b', resetViewport: true, notice: base } }
    const state = newSemanticState('account')
    expect(deferListFallback(true, true, { ...state, pending: candidate }, false, true)).toBe(true)
    expect(deferListFallback(true, true, { ...state, presented: candidate }, false, true)).toBe(true)
    const silent = { ...candidate, fate: { ...candidate.fate, notice: undefined } }
    expect(deferListFallback(true, true, { ...state, pending: silent }, false, true)).toBe(false)
    expect(deferListFallback(true, true, { ...state, pending: silent }, false, false)).toBe(true)
  })
  it('chooses a still available cached target by identity and activity', () => {
    const state: AccountSemanticState = { ...newSemanticState('account'), activity: ['gone', 'remote'],
      context: { accountId: 'account', listId: 'gone' } }
    const available = [{ id: 'unrelated' }, { id: 'local' }]
    expect(cachedFallbackList(state, { local: 'remote' }, available)).toBe('local')
    expect(cachedFallbackList(state, { local: 'remote' }, [])).toBeNull()
    expect(cachedFallbackList({ ...state, pending: { origin: state.context!,
      fate: { kind: 'recover', nextListId: 'unrelated', resetViewport: true } } }, { local: 'remote' }, available)).toBe('unrelated')
  })
})
