import { DefaultChatTransport, type UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createAgentHandler, defineAgent, defineTool } from '../src/index.js'
import { chatRequest, scriptedModel, textStep, toolCallStep, userMessage } from './helpers.js'

function slowAgent(keepAlive?: number | false) {
  return createAgentHandler(
    defineAgent({
      model: scriptedModel(toolCallStep('slow', {}), textStep('done')),
      tools: {
        slow: defineTool(
          async () => {
            await new Promise((r) => setTimeout(r, 300))
            return 'ok'
          },
          { description: 'Slow', input: z.object({}) },
        ),
      },
      keepAlive,
      onError: () => {},
    }),
  )
}

describe('keepAlive', () => {
  it('sends SSE comments while a tool is slow', async () => {
    const body = await (await slowAgent(50)(chatRequest([userMessage('x')]))).text()
    expect(body.match(/^: keep-alive$/gm)?.length).toBeGreaterThanOrEqual(2)
    // comments sit between events, never inside one
    for (const block of body.split('\n\n').filter(Boolean)) {
      expect(block === ': keep-alive' || block.startsWith('data: ')).toBe(true)
    }
  })

  it('is ignored by the AI SDK client transport', async () => {
    const response = await slowAgent(50)(chatRequest([userMessage('x')]))
    const transport = new DefaultChatTransport({
      api: 'http://local/api/agent',
      fetch: async () => response,
    })
    const stream = await transport.sendMessages({
      chatId: 'c',
      messages: [userMessage('x')],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })
    const chunks: UIMessageChunk[] = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'tool-output-available', output: 'ok' }),
    )
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'done' }))
  })

  it('can be turned off', async () => {
    const body = await (await slowAgent(false)(chatRequest([userMessage('x')]))).text()
    expect(body).not.toContain('keep-alive')
  })
})
