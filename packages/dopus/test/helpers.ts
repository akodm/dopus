import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

export function textStep(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: text },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
  ]
}

export function toolCallStep(
  toolName: string,
  input: unknown,
  toolCallId = 'call-1',
): LanguageModelV4StreamPart[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ]
}

/** A mock model that plays back one scripted step per call. */
export function scriptedModel(...steps: LanguageModelV4StreamPart[][]) {
  return new MockLanguageModelV4({
    doStream: steps.map((chunks) => ({ stream: convertArrayToReadableStream(chunks) })),
  })
}

export function userMessage(text: string, id = 'u1'): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] }
}

export function chatRequest(
  messages: UIMessage[],
  init: { cookie?: string; body?: Record<string, unknown> } = {},
) {
  return new Request('http://localhost/api/agent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: JSON.stringify({ messages, ...init.body }),
  })
}

export async function readChunks(response: Response): Promise<UIMessageChunk[]> {
  const text = await response.text()
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice('data: '.length)) as UIMessageChunk)
}

/** Rebuilds the assistant message the way `useChat` would on the client. */
export async function assistantMessage(chunks: UIMessageChunk[]): Promise<UIMessage> {
  let last: UIMessage | undefined
  for await (const message of readUIMessageStream({
    stream: convertArrayToReadableStream(chunks),
  })) {
    last = message
  }
  if (!last) throw new Error('no assistant message in stream')
  return structuredClone(last)
}
