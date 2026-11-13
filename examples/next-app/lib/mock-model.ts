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

/** One step with one or more tool calls. */
const calls = (toolName: string, inputs: object[]) =>
  reply([
    ...inputs.map(
      (input) =>
        ({
          type: 'tool-call',
          toolCallId: `call-${Math.random().toString(36).slice(2)}`,
          toolName,
          input: JSON.stringify(input),
        }) as const,
    ),
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ])

/**
 * Scripted stand-in for an LLM, used by the e2e tests (DOPUS_MOCK_MODEL=1).
 * "who" → getCurrentUser, "orders" → listMyOrders, "cancel <id> [<id>...]" → cancelOrder (one call per id,
 * in one step), "export" → startExport, the app's finished-job notice → getExport.
 * After a tool result it replies with `result: <json>` so tests can read what the tool returned.
 * "all orders" → listAllOrders (admin only). An attached file (the server's notice with `fileId "<id>"`) → describeFile.
 * A tool that is not offered (anonymous user and not `public`, or `access` says no) gets "Not offered: <tool>."
 * instead of a call.
 */
export function mockModel() {
  return new MockLanguageModelV4({
    doStream: async ({ prompt, tools }) => {
      const offered = new Set((tools ?? []).map((t) => t.name))
      const call = (toolName: string, input: object) =>
        offered.has(toolName) ? calls(toolName, [input]) : text(`Not offered: ${toolName}.`)
      const last = prompt.at(-1)
      if (last?.role === 'tool') {
        const result = last.content.find((part) => part.type === 'tool-result')
        return text(`result: ${JSON.stringify(result?.output)}`)
      }
      const userText =
        last?.role === 'user'
          ? last.content.map((part) => (part.type === 'text' ? part.text : '')).join(' ')
          : ''
      const finished = /Background job (\S+) has finished/.exec(userText)
      if (finished?.[1]) return call('getExport', { jobId: finished[1] })
      const file = /fileId ("(?:[^"\\]|\\.)*")/.exec(userText)
      if (file?.[1]) return call('describeFile', { fileId: JSON.parse(file[1]) })
      const cancel = /cancel\s+(.+)/i.exec(userText)
      const ids = cancel?.[1]?.match(/\S+/g) ?? []
      if (ids.length > 0 && !offered.has('cancelOrder')) return text('Not offered: cancelOrder.')
      if (ids.length > 0)
        return calls(
          'cancelOrder',
          ids.map((orderId) => ({ orderId })),
        )
      if (/export/i.test(userText)) return call('startExport', {})
      if (/all orders/i.test(userText)) return call('listAllOrders', {})
      if (/orders/i.test(userText)) return call('listMyOrders', {})
      if (/who/i.test(userText)) return call('getCurrentUser', {})
      return text('Try "who am I", "list my orders" or "cancel o-1".')
    },
  })
}
