import type { UIMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createAgentHandler,
  defineAgent,
  defineTool,
  type ToolContext,
  ToolError,
} from '../src/index.js'
import {
  assistantMessage,
  chatRequest,
  readChunks,
  scriptedModel,
  textStep,
  toolCallStep,
  userMessage,
} from './helpers.js'

const silent = { onError: () => {} }

describe('createAgentHandler', () => {
  it('streams text with the UI message stream protocol', async () => {
    const POST = createAgentHandler(
      defineAgent({ model: scriptedModel(textStep('Hello!')), tools: {}, ...silent }),
    )
    const response = await POST(chatRequest([userMessage('hi')]))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const chunks = await readChunks(response)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'Hello!' }))
  })

  it('sends the layered prompt as system instructions', async () => {
    const model = scriptedModel(textStep('ok'))
    const POST = createAgentHandler(
      defineAgent({
        model,
        tools: {},
        prompt: { core: 'CORE', app: 'APP' },
        runtime: () => ({ locale: 'ko-KR' }),
        ...silent,
      }),
    )
    await readChunks(await POST(chatRequest([userMessage('hi')])))
    const prompt = model.doStreamCalls[0]?.prompt ?? []
    const system = prompt.filter((m) => m.role === 'system').map((m) => m.content)
    expect(system).toEqual(['CORE\n\nAPP', 'Request context:\n- Response language: ko-KR'])
  })

  it('merges server runtime values over the browser context', async () => {
    const model = scriptedModel(textStep('ok'))
    const POST = createAgentHandler(
      defineAgent({
        model,
        tools: {},
        prompt: { core: false },
        runtime: (_req, { client }) => ({ role: 'admin', page: client.page?.toUpperCase() }),
        ...silent,
      }),
    )
    const request = new Request('http://localhost/api/agent', {
      method: 'POST',
      body: JSON.stringify({
        messages: [userMessage('hi')],
        context: { locale: 'en', page: '/orders', role: 'x' },
      }),
    })
    await readChunks(await POST(request))
    const system = (model.doStreamCalls[0]?.prompt ?? [])
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
    expect(system).toEqual([
      'Request context:\n- Response language: en\n- Current page (reported by the browser): /ORDERS\n- User role: admin',
    ])
  })

  it('runs a tool with validated input and the identified user, then continues', async () => {
    const getOrders = vi.fn(async (input: { status: string }, _ctx: ToolContext) => [
      { id: 'o1', status: input.status },
    ])
    const model = scriptedModel(
      toolCallStep('getOrders', { status: 'open' }),
      textStep('You have 1 order.'),
    )
    const POST = createAgentHandler(
      defineAgent({
        model,
        tools: {
          getOrders: defineTool(getOrders, {
            description: 'List the current user orders',
            input: z.object({ status: z.enum(['open', 'closed']) }),
          }),
        },
        identify: (req) => (req.headers.get('cookie') ? { id: 'user-42' } : undefined),
        ...silent,
      }),
    )

    const chunks = await readChunks(
      await POST(chatRequest([userMessage('orders?')], { cookie: 'sid=1' })),
    )

    expect(getOrders).toHaveBeenCalledTimes(1)
    expect(getOrders.mock.calls[0]?.[0]).toEqual({ status: 'open' })
    expect(getOrders.mock.calls[0]?.[1]).toMatchObject({
      user: { id: 'user-42' },
      toolCallId: 'call-1',
    })
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'tool-output-available',
        output: [{ id: 'o1', status: 'open' }],
      }),
    )
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'text-delta', delta: 'You have 1 order.' }),
    )
    expect(model.doStreamCalls).toHaveLength(2)
  })

  it('does not run a tool when the model input fails the schema', async () => {
    const fn = vi.fn(async () => 'ran')
    const POST = createAgentHandler(
      defineAgent({
        model: scriptedModel(toolCallStep('lookup', { id: 123 }), textStep('sorry')),
        tools: {
          lookup: defineTool(fn, { description: 'Lookup', input: z.object({ id: z.string() }) }),
        },
        ...silent,
      }),
    )
    await readChunks(await POST(chatRequest([userMessage('x')])))
    expect(fn).not.toHaveBeenCalled()
  })

  it('maps output before it reaches the model', async () => {
    const POST = createAgentHandler(
      defineAgent({
        model: scriptedModel(toolCallStep('me', {}), textStep('done')),
        tools: {
          me: defineTool(async () => ({ name: 'Kim', passwordHash: 'secret' }), {
            description: 'Current user',
            input: z.object({}),
            output: ({ name }) => ({ name }),
          }),
        },
        ...silent,
      }),
    )
    const chunks = await readChunks(await POST(chatRequest([userMessage('who am i')])))
    expect(JSON.stringify(chunks)).not.toContain('secret')
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'tool-output-available', output: { name: 'Kim' } }),
    )
  })

  it('translates Next.js redirect errors into a message the model can use', async () => {
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    })
    const model = scriptedModel(toolCallStep('secure', {}), textStep('Please sign in'))
    const POST = createAgentHandler(
      defineAgent({
        model,
        tools: {
          secure: defineTool(
            async () => {
              throw redirectError
            },
            { description: 'Secure', input: z.object({}) },
          ),
        },
        ...silent,
      }),
    )
    const onError = vi.fn()
    const POST2 = createAgentHandler(
      defineAgent({
        model: scriptedModel(toolCallStep('secure', {}), textStep('Please sign in')),
        tools: {
          secure: defineTool(
            async () => {
              throw redirectError
            },
            { description: 'Secure', input: z.object({}) },
          ),
        },
        onError,
      }),
    )
    const chunks = await readChunks(await POST(chatRequest([userMessage('x')])))
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('/login')
    // the client keeps the same text, so it survives in the history sent on the next turn
    expect(chunks.find((c) => c.type === 'tool-output-error')).toMatchObject({
      errorText: expect.stringContaining('/login'),
    })
    // an expected ToolError is not reported as a server error
    await readChunks(await POST2(chatRequest([userMessage('x')])))
    expect(onError).not.toHaveBeenCalled()
  })

  it('hides unexpected tool errors from the model and reports them', async () => {
    const onError = vi.fn()
    const model = scriptedModel(toolCallStep('db', {}), textStep('failed'), textStep('ok'))
    const tools = {
      db: defineTool(
        async () => {
          throw new Error('connection to db.internal:5432 failed for user admin')
        },
        { description: 'DB', input: z.object({}) },
      ),
      safe: defineTool(
        async () => {
          throw new ToolError('Order o1 is already shipped')
        },
        { description: 'Safe', input: z.object({}) },
      ),
    }
    const POST = createAgentHandler(defineAgent({ model, tools, onError }))
    const chunks = await readChunks(await POST(chatRequest([userMessage('x')])))
    const seen = JSON.stringify(model.doStreamCalls[1]?.prompt)
    expect(seen).not.toContain('db.internal')
    expect(seen).toContain('The \\"db\\" action failed.')
    expect(JSON.stringify(chunks)).not.toContain('db.internal')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('db.internal') }),
    )

    const model2 = scriptedModel(toolCallStep('safe', {}), textStep('ok'))
    const POST2 = createAgentHandler(defineAgent({ model: model2, tools, onError }))
    await readChunks(await POST2(chatRequest([userMessage('x')])))
    expect(JSON.stringify(model2.doStreamCalls[1]?.prompt)).toContain('Order o1 is already shipped')
  })

  it('rejects bad request bodies', async () => {
    const POST = createAgentHandler(defineAgent({ model: scriptedModel(), tools: {}, ...silent }))
    const notJson = new Request('http://localhost/api/agent', { method: 'POST', body: '{' })
    expect((await POST(notJson)).status).toBe(400)
    const badMessages = new Request('http://localhost/api/agent', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user' }] }),
    })
    expect((await POST(badMessages)).status).toBe(400)
  })
})

describe('confirm flow', () => {
  function setup(options: { approvalSecret?: string } = {}) {
    const cancelOrder = vi.fn(async (input: { orderId: string }) => ({ cancelled: input.orderId }))
    const model = scriptedModel(
      toolCallStep('cancelOrder', { orderId: 'o1' }),
      textStep('Cancelled.'),
    )
    const POST = createAgentHandler(
      defineAgent({
        model,
        tools: {
          cancelOrder: defineTool(cancelOrder, {
            description: 'Cancel an order',
            input: z.object({ orderId: z.string() }),
            confirm: true,
          }),
        },
        ...options,
        ...silent,
      }),
    )
    return { POST, cancelOrder, model }
  }

  async function requestApproval(POST: (req: Request) => Promise<Response>) {
    const first = userMessage('cancel o1')
    const chunks = await readChunks(await POST(chatRequest([first])))
    const assistant = await assistantMessage(chunks)
    return { first, chunks, assistant }
  }

  function respond(assistant: UIMessage, approved: boolean): UIMessage {
    const part = assistant.parts.find((p) => p.type === 'tool-cancelOrder') as {
      state: string
      approval: { id: string; approved?: boolean; signature?: string }
    }
    part.state = 'approval-responded'
    part.approval = { ...part.approval, approved }
    return assistant
  }

  it('asks for approval instead of running the tool', async () => {
    const { POST, cancelOrder } = setup()
    const { chunks, assistant } = await requestApproval(POST)
    expect(cancelOrder).not.toHaveBeenCalled()
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool-approval-request' }))
    expect(assistant.parts).toContainEqual(expect.objectContaining({ state: 'approval-requested' }))
  })

  it('runs the tool after the user approves', async () => {
    const { POST, cancelOrder } = setup()
    const { first, assistant } = await requestApproval(POST)
    const chunks = await readChunks(await POST(chatRequest([first, respond(assistant, true)])))
    expect(cancelOrder).toHaveBeenCalledTimes(1)
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'tool-output-available', output: { cancelled: 'o1' } }),
    )
  })

  it('does not run the tool when the user declines', async () => {
    const { POST, cancelOrder } = setup()
    const { first, assistant } = await requestApproval(POST)
    const chunks = await readChunks(await POST(chatRequest([first, respond(assistant, false)])))
    expect(cancelOrder).not.toHaveBeenCalled()
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool-output-denied' }))
  })

  it('supports conditional confirmation', async () => {
    const transfer = vi.fn(async (input: { amount: number }) => ({ sent: input.amount }))
    const POST = createAgentHandler(
      defineAgent({
        model: scriptedModel(toolCallStep('transfer', { amount: 5 }), textStep('ok')),
        tools: {
          transfer: defineTool(transfer, {
            description: 'Transfer points',
            input: z.object({ amount: z.number() }),
            confirm: (input) => input.amount > 100,
          }),
        },
        ...silent,
      }),
    )
    await readChunks(await POST(chatRequest([userMessage('send 5')])))
    expect(transfer).toHaveBeenCalledTimes(1)
  })

  it('with a secret, accepts signed approvals and rejects forged ones', async () => {
    const signed = setup({ approvalSecret: 'test-secret-0123456789abcdef' })
    const { first, assistant } = await requestApproval(signed.POST)
    const approval = (
      assistant.parts.find((p) => p.type === 'tool-cancelOrder') as {
        approval: { signature?: string }
      }
    ).approval
    expect(approval.signature).toBeTruthy()

    const forged = structuredClone(assistant)
    ;(
      forged.parts.find((p) => p.type === 'tool-cancelOrder') as {
        approval: { signature?: string }
      }
    ).approval.signature = 'forged'
    await readChunks(await signed.POST(chatRequest([first, respond(forged, true)])))
    expect(signed.cancelOrder).not.toHaveBeenCalled()

    await readChunks(await signed.POST(chatRequest([first, respond(assistant, true)])))
    expect(signed.cancelOrder).toHaveBeenCalledTimes(1)
  })
})
