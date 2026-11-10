import { describe, expect, it } from 'vitest'
import { buildInstructions, CORE_PROMPT } from '../src/index.js'

describe('buildInstructions', () => {
  it('orders layers stable → volatile and marks the stable prefix for caching', () => {
    const messages = buildInstructions(
      { preset: 'PRESET', app: 'APP' },
      { locale: 'ko-KR', role: 'admin', page: '/orders', unused: undefined },
    )
    expect(messages).toHaveLength(2)
    expect(messages[0]?.content).toBe(`${CORE_PROMPT}\n\nPRESET\n\nAPP`)
    expect(messages[0]?.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    })
    expect(messages[1]?.content).toBe(
      'Request context:\n- Response language: ko-KR\n- User role: admin\n- Current page: /orders',
    )
    expect(messages[1]?.providerOptions).toBeUndefined()
  })

  it('lets the core layer be replaced or dropped', () => {
    expect(buildInstructions({ core: 'MINE' })[0]?.content).toBe('MINE')
    expect(buildInstructions({ core: false, app: 'APP' })[0]?.content).toBe('APP')
    expect(buildInstructions({ core: false })).toEqual([])
  })
})
