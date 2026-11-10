import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

/**
 * Offline stand-in for a real model, used by tests (DOPUS_MOCK_MODEL=1).
 * First turn: calls `getCurrentUser`. After a tool result: echoes it as text.
 */
export function mockModel() {
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const last = prompt.at(-1)
      if (last?.role === 'tool') {
        const part = last.content.find((p) => p.type === 'tool-result')
        const text = `tool said: ${JSON.stringify(part?.output)}`
        return {
          stream: convertArrayToReadableStream([
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: text },
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ]),
        }
      }
      return {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'getCurrentUser', input: '{}' },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
        ]),
      }
    },
  })
}
