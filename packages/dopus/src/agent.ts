import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  type LanguageModel,
  type SingleToolApprovalFunction,
  safeValidateUIMessages,
  streamText,
  type Tool,
  type ToolApprovalStatus,
  tool,
  toUIMessageStream,
  type UIMessage,
} from 'ai'
import { ToolError, translateNextError } from './next-errors.js'
import { buildInstructions, type PromptLayers, type RuntimeContext } from './prompt.js'
import { type AgentUser, type DopusToolSet, isDopusTool, toolDescription } from './tool.js'

type StreamTextOptions = Parameters<typeof streamText>[0]

export interface AgentConfig<TOOLS extends DopusToolSet = DopusToolSet> {
  /** e.g. `anthropic('claude-sonnet-5-5')` from `@ai-sdk/anthropic`. */
  model: LanguageModel
  tools: TOOLS
  prompt?: PromptLayers
  /**
   * Per-request values for the runtime prompt layer (e.g. the user's role). Runs inside the request,
   * so `cookies()` / `headers()` work here. Merged over the browser-reported `locale` and `page`.
   */
  runtime?: (
    request: Request,
    ctx: { user: AgentUser | undefined; client: ClientContext },
  ) => RuntimeContext | undefined | Promise<RuntimeContext | undefined>
  /**
   * Resolve the requesting user. Optional for in-request tools (they read cookies themselves);
   * needed when tools run outside the request. Return `undefined` for anonymous users.
   */
  identify?: (request: Request) => AgentUser | undefined | Promise<AgentUser | undefined>
  /** Maximum model steps (tool round trips) per request. Default 10. */
  maxSteps?: number
  /**
   * Size limits checked before the model is called; a request over them gets 413.
   * `maxBodyBytes` (default 1 MB) bounds the whole chat history the browser sends;
   * `maxMessageChars` (default 8000) bounds the text of each user message.
   */
  limits?: { maxBodyBytes?: number; maxMessageChars?: number }
  /**
   * Secret used to sign approval requests so a client cannot forge an approval.
   * Defaults to `process.env.DOPUS_APPROVAL_SECRET`.
   */
  approvalSecret?: string
  /** Extra `streamText` settings (temperature, providerOptions, ...). */
  callOptions?: Pick<
    StreamTextOptions,
    | 'temperature'
    | 'maxOutputTokens'
    | 'providerOptions'
    | 'maxRetries'
    | 'headers'
    | 'onEnd'
    | 'onStepEnd'
  >
  /** Called for unexpected errors (not `ToolError`); the client only sees a generic message for those. */
  onError?: (error: unknown) => void
  /**
   * While the stream is idle (e.g. a slow tool), send an SSE comment every this many ms so proxies
   * (CloudFront, ALB, nginx) do not drop the connection. Clients ignore comments. Default 15000; `false` disables.
   */
  keepAlive?: number | false
}

const KEEP_ALIVE = new TextEncoder().encode(': keep-alive\n\n')

/**
 * Inserts SSE comment lines while the body is idle. The UI message stream emits one complete
 * `data: …\n\n` event per chunk, so writing between chunks never splits an event.
 */
export function withKeepAlive(response: Response, intervalMs: number): Response {
  const source = response.body
  if (!source || intervalMs <= 0) return response
  const reader = source.getReader()
  let timer: ReturnType<typeof setInterval> | undefined
  let lastWrite = Date.now()

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(
        () => {
          if (Date.now() - lastWrite >= intervalMs) {
            controller.enqueue(KEEP_ALIVE)
            lastWrite = Date.now()
          }
        },
        Math.min(intervalMs, 1000),
      )
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          clearInterval(timer)
          controller.close()
          return
        }
        lastWrite = Date.now()
        controller.enqueue(value)
      } catch (error) {
        clearInterval(timer)
        controller.error(error)
      }
    },
    cancel(reason) {
      clearInterval(timer)
      return reader.cancel(reason)
    },
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/** Identity function that gives `agent.config.ts` type checking. */
export function defineAgent<TOOLS extends DopusToolSet>(
  config: AgentConfig<TOOLS>,
): AgentConfig<TOOLS> {
  for (const [name, value] of Object.entries(config.tools)) {
    if (!isDopusTool(value)) {
      throw new TypeError(`defineAgent: tools.${name} must be created with defineTool()`)
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      throw new TypeError(`defineAgent: tool name "${name}" must match [a-zA-Z0-9_-]{1,64}`)
    }
  }
  return config
}

interface BuildContext {
  user: AgentUser | undefined
  report?: (error: unknown) => void
}

export function buildTools(tools: DopusToolSet, ctx: BuildContext) {
  const aiTools: Record<string, Tool> = {}
  const approval: Record<
    string,
    ToolApprovalStatus | SingleToolApprovalFunction<unknown, unknown, unknown>
  > = {}

  for (const [name, dopusTool] of Object.entries(tools)) {
    const { fn, options } = dopusTool
    aiTools[name] = tool({
      description: toolDescription(options),
      inputSchema: options.input,
      execute: async (input: unknown, { toolCallId, abortSignal }) => {
        try {
          const result = await fn(input, { user: ctx.user, toolCallId, abortSignal })
          return options.output ? options.output(result) : result
        } catch (error) {
          const translated = translateNextError(error)
          if (translated instanceof ToolError) throw translated
          ctx.report?.(error)
          throw new ToolError(`The "${name}" action failed.`)
        }
      },
    })

    const confirm = options.confirm
    if (confirm === true) {
      approval[name] = 'user-approval'
    } else if (typeof confirm === 'function') {
      approval[name] = async (input, { toolCallId }) =>
        (await confirm(input, { user: ctx.user, toolCallId })) ? 'user-approval' : 'not-applicable'
    }
  }
  return { tools: aiTools, toolApproval: approval }
}

/**
 * What the browser reports about itself (`body.context` from the chat UI). Untrusted: only `locale`
 * and `page` are accepted, cleaned and length-limited before they reach the prompt. Anything that
 * matters for permissions (role, plan, tenant) must come from the server in `runtime`.
 */
export interface ClientContext {
  locale?: string
  page?: string
}

const LOCALE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/

export function readClientContext(body: unknown, request: Request): ClientContext {
  const raw = (body as { context?: Record<string, unknown> } | null)?.context ?? {}
  const clean = (value: unknown, max: number) =>
    typeof value === 'string'
      ? value
          // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
          .replace(/[\u0000-\u001f\u007f]+/g, ' ')
          .trim()
          .slice(0, max) || undefined
      : undefined

  const fromHeader = request.headers.get('accept-language')?.split(',')[0]?.split(';')[0]?.trim()
  const locale = [clean(raw.locale, 35), fromHeader].find((tag) => tag && LOCALE_TAG.test(tag))
  return { locale, page: clean(raw.page, 200) }
}

const JSON_HEADERS = { 'content-type': 'application/json' }

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS })
}

/**
 * Creates a `POST` route handler that speaks the AI SDK UI message stream protocol (`useChat`).
 *
 * Tools execute inside this request, so server functions they call see the caller's cookies.
 */
export function createAgentHandler(config: AgentConfig) {
  const maxSteps = config.maxSteps ?? 10
  const report = config.onError ?? ((error: unknown) => console.error('[dopus]', error))

  return async function handleAgentRequest(request: Request): Promise<Response> {
    const maxBodyBytes = config.limits?.maxBodyBytes ?? 1_000_000
    const maxMessageChars = config.limits?.maxMessageChars ?? 8_000
    if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) {
      return errorResponse(413, 'Conversation is too long')
    }
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > maxBodyBytes) {
      return errorResponse(413, 'Conversation is too long')
    }
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return errorResponse(400, 'Request body must be JSON')
    }

    const user = await config.identify?.(request)
    const { tools, toolApproval } = buildTools(config.tools, { user, report })

    const validated = await safeValidateUIMessages<UIMessage>({
      messages: (body as { messages?: unknown } | null)?.messages,
    })
    if (!validated.success) {
      return errorResponse(400, 'Invalid messages')
    }
    const messages = validated.data
    const tooLong = messages.some(
      (message) =>
        message.role === 'user' &&
        message.parts.some((part) => part.type === 'text' && part.text.length > maxMessageChars),
    )
    if (tooLong) return errorResponse(413, 'Message is too long')

    const client = readClientContext(body, request)
    const runtime = { ...client, ...(await config.runtime?.(request, { user, client })) }
    const approvalSecret = config.approvalSecret ?? process.env.DOPUS_APPROVAL_SECRET

    const result = streamText({
      ...config.callOptions,
      model: config.model,
      instructions: buildInstructions(config.prompt, runtime),
      messages: await convertToModelMessages(messages, { tools }),
      tools,
      toolApproval,
      stopWhen: isStepCount(maxSteps),
      abortSignal: request.signal,
      ...(approvalSecret ? { experimental_toolApprovalSecret: approvalSecret } : {}),
      onError: ({ error }) => report(error),
    })

    const response = createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        tools,
        originalMessages: messages,
        // A ToolError is already safe for the model, so the client may keep it too: the chat history it
        // sends back must carry the same text, or the model loses why an earlier call failed.
        onError: (error) => {
          if (error instanceof ToolError) return error.message
          report(error)
          return 'Something went wrong. Please try again.'
        },
      }),
    })
    return config.keepAlive === false
      ? response
      : withKeepAlive(response, config.keepAlive ?? 15_000)
  }
}
