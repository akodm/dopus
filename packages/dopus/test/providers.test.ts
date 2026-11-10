import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createAgentHandler, defineAgent, defineTool, PROVIDERS } from '../src/index.js'
import { chatRequest, userMessage } from './helpers.js'

/** Captures the provider HTTP request and fails it, so no real API is ever called. */
function capturingFetch() {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify({ error: { message: 'captured' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, fetch: fetch as typeof globalThis.fetch }
}

const tools = {
  getOrders: defineTool(async () => [], {
    description: 'List orders',
    usage: 'When the user asks about orders',
    input: z.object({ status: z.enum(['open', 'closed']) }),
  }),
}

const cases: [string, (fetch: typeof globalThis.fetch) => LanguageModel][] = [
  ['openai', (fetch) => createOpenAI({ apiKey: 'test', fetch })(PROVIDERS.openai.defaultModel)],
  [
    'anthropic',
    (fetch) => createAnthropic({ apiKey: 'test', fetch })(PROVIDERS.anthropic.defaultModel),
  ],
  ['google', (fetch) => createGoogle({ apiKey: 'test', fetch })(PROVIDERS.google.defaultModel)],
]

describe.each(cases)('%s provider', (id, createModel) => {
  it('receives the prompt layers and tool definitions', async () => {
    const { calls, fetch } = capturingFetch()
    const POST = createAgentHandler(
      defineAgent({
        model: createModel(fetch),
        tools,
        prompt: { core: 'CORE', app: 'APP' },
        runtime: () => ({ locale: 'ko-KR' }),
        maxSteps: 1,
        callOptions: { maxRetries: 0 },
        onError: () => {},
      }),
    )
    await (await POST(chatRequest([userMessage('hi')]))).text()

    expect(calls).toHaveLength(1)
    const body = JSON.stringify(calls[0]?.body)
    expect(body).toContain('CORE\\n\\nAPP')
    expect(body).toContain('Response language: ko-KR')
    expect(body).toContain('getOrders')
    expect(body).toContain('When to use: When the user asks about orders')
    if (id === 'anthropic') {
      const system = calls[0]?.body.system as { text: string; cache_control?: unknown }[]
      expect(system[0]).toMatchObject({ text: 'CORE\n\nAPP', cache_control: { type: 'ephemeral' } })
      expect(system[1]?.cache_control).toBeUndefined()
    }
  })
})
