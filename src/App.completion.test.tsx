import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from './App'
import type { Storage } from './data/storage'

describe('E3/E4 shopping workspace completion controls', () => {
  const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const storage = {} as Storage
  it('exposes all three completion modes for a bound account list', () => {
    const html = renderToStaticMarkup(createElement(App, {
      storage, accountId, cloudBoundLists: { groceries: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      onCompleteCloudList: () => {},
    }))
    expect(html).toContain('Завершить: отмеченные')
    expect(html).toContain('Завершить: всё куплено')
    expect(html).toContain('Завершить: ничего не куплено')
  })
  it('does not show cloud completion actions for an unbound list', () => {
    const html = renderToStaticMarkup(createElement(App, {
      storage, accountId, cloudBoundLists: {}, onCompleteCloudList: () => {},
    }))
    expect(html).not.toContain('Завершить: отмеченные')
  })
  it('does not expose cloud completion in guest mode', () => {
    const html = renderToStaticMarkup(createElement(App, {
      storage, accountId: null, cloudBoundLists: { groceries: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      onCompleteCloudList: () => {},
    }))
    expect(html).not.toContain('Завершить: отмеченные')
  })
  it('disables all completion actions while a completion is in progress', () => {
    const html = renderToStaticMarkup(createElement(App, {
      storage, accountId, cloudBoundLists: { groceries: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      onCompleteCloudList: () => {}, completionBusy: true,
    }))
    for (const label of ['Завершить: отмеченные', 'Завершить: всё куплено', 'Завершить: ничего не куплено']) {
      expect(html).toMatch(new RegExp('<button[^>]*disabled=""[^>]*>' + label))
    }
  })
  it('shows completion result beside the active list', () => {
    const html = renderToStaticMarkup(createElement(App, {
      storage, accountId, cloudBoundLists: { groceries: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      onCompleteCloudList: () => {}, completionStatus: 'Список завершён.',
    }))
    expect(html).toContain('role="status">Список завершён.')
  })

})
