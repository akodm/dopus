import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { type AgentUIMessage, defineAgent, defineTool, type ToolCallEvent } from '../src/index.js'

declare function cancelOrder(orderId: string): Promise<{ ok: boolean; secret: string }>

const agent = defineAgent({
  model: 'mock' as never,
  tools: {
    cancelOrder: defineTool((input) => cancelOrder(input.orderId), {
      description: 'Cancel',
      input: z.object({ orderId: z.string() }),
      output: (result) => ({ ok: result.ok }),
    }),
    whoAmI: defineTool(async () => ({ name: 'alice' }), { description: 'Me', input: z.object({}) }),
  },
  onToolCall(event) {
    if (event.tool === 'cancelOrder') {
      expectTypeOf(event.input).toEqualTypeOf<{ orderId: string }>()
      expectTypeOf(event.output).toEqualTypeOf<{ ok: boolean } | undefined>()
    }
  },
})

describe('types (checked by tsc)', () => {
  it('ToolCallEvent narrows input and output per tool', () => {
    type Event = ToolCallEvent<typeof agent.tools>
    expectTypeOf<Extract<Event, { tool: 'whoAmI' }>['output']>().toEqualTypeOf<
      { name: string } | undefined
    >()
    expectTypeOf<Event['tool']>().toEqualTypeOf<'cancelOrder' | 'whoAmI'>()
  })

  it('AgentUIMessage types tool parts from the agent config', () => {
    type Message = AgentUIMessage<typeof agent>
    // Never called: only the types are checked.
    const check = (part: Message['parts'][number]) => {
      if (part.type === 'tool-cancelOrder' && part.state === 'output-available') {
        expectTypeOf(part.input).toEqualTypeOf<{ orderId: string }>()
        expectTypeOf(part.output).toEqualTypeOf<{ ok: boolean }>()
      }
    }
    expectTypeOf(check).toBeFunction()
  })

  it('an untyped ToolCallEvent stays loose', () => {
    expectTypeOf<ToolCallEvent['input']>().toBeUnknown()
  })
})
