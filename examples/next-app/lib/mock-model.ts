import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

function reply(parts: LanguageModelV4StreamPart[]) {
  return {
    stream: convertArrayToReadableStream<LanguageModelV4StreamPart>([
      { type: 'stream-start', warnings: [] },
      ...parts,
    ]),
  }
}

const text = (value: string) =>
  reply([
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: value },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
  ])

const call = (toolName: string, input: object) =>
  reply([
    {
      type: 'tool-call',
      toolCallId: `call-${Math.random().toString(36).slice(2)}`,
      toolName,
      input: JSON.stringify(input),
    },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ])

/**
 * Scripted stand-in for an LLM, used by the e2e tests (DOPUS_MOCK_MODEL=1).
 * "who" → getCurrentUser, "orders" → listMyOrders, "cancel <id>" → cancelOrder.
 * After a tool result it replies with `result: <json>` so tests can read what the tool returned.
 */
export function mockModel() {
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const last = prompt.at(-1)
      if (last?.role === 'tool') {
        const result = last.content.find((part) => part.type === 'tool-result')
        return text(`result: ${JSON.stringify(result?.output)}`)
      }
      const userText =
        last?.role === 'user'
          ? last.content.map((part) => (part.type === 'text' ? part.text : '')).join(' ')
          : ''
      const cancel = /cancel\s+(\S+)/i.exec(userText)
      if (cancel?.[1]) return call('cancelOrder', { orderId: cancel[1] })
      if (/orders/i.test(userText)) return call('listMyOrders', {})
      if (/who/i.test(userText)) return call('getCurrentUser', {})
      return text('Try "who am I", "list my orders" or "cancel o-1".')
    },
  })
}
