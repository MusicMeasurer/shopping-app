import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { SiriSetup } from './SiriSetup'

describe('Siri setup static UI', () => {
  it('shows cloud-specific endpoint and list identifier without any token', () => {
    const html = renderToStaticMarkup(createElement(SiriSetup, {
      client: {} as never,
      cloudUrl: 'https://example.supabase.co',
      accountId: 'account',
      listId: '550e8400-e29b-41d4-a716-446655440001',
      listName: 'Продукты',
    }))
    expect(html).toContain('https://example.supabase.co/functions/v1/siri-add')
    expect(html).toContain('550e8400-e29b-41d4-a716-446655440001')
    expect(html).toContain('Как настроить команду на iPhone')
    expect(html).not.toContain('Bearer aaaaaaaaa')
  })
})
