import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineAgent, defineTool } from '../src/index.js'
import { toolDescription } from '../src/tool.js'

describe('defineTool', () => {
  it('wraps a function with its options', () => {
    const fn = async (input: { id: string }) => ({ id: input.id })
    const t = defineTool(fn, { description: 'Get order', input: z.object({ id: z.string() }) })
    expect(t.kind).toBe('dopus-tool')
    expect(t.fn).toBe(fn)
  })

  it('requires a description and an input schema', () => {
    const fn = async () => null
    expect(() => defineTool(fn, { description: ' ', input: z.object({}) })).toThrow(/description/)
    // @ts-expect-error input is required
    expect(() => defineTool(fn, { description: 'x' })).toThrow(/input/)
  })

  it('appends usage to the description', () => {
    expect(toolDescription({ description: 'List orders', usage: 'When asked about orders' })).toBe(
      'List orders\n\nWhen to use: When asked about orders',
    )
    expect(toolDescription({ description: 'List orders' })).toBe('List orders')
  })
})

describe('defineAgent', () => {
  it('rejects tools not created with defineTool and invalid names', () => {
    const model = {} as never
    // @ts-expect-error not a dopus tool
    expect(() => defineAgent({ model, tools: { bad: () => 1 } })).toThrow(/defineTool/)
    const t = defineTool(async () => 1, { description: 'x', input: z.object({}) })
    expect(() => defineAgent({ model, tools: { 'has space': t } })).toThrow(/must match/)
  })
})
