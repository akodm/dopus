import type { UIDataTypes, UIMessage } from 'ai'
import type { z } from 'zod'
import { JOB_USAGE } from './job.js'

/**
 * Identity of the user who sent the agent request.
 *
 * Tools that run inside the request (the default) can read cookies/headers directly and do not need this.
 * It exists for execution that leaves the request (background jobs, infra adapters), where the
 * request context is gone and identity has to be passed explicitly. Keep it serialisable.
 */
export interface AgentUser {
  id: string
  [key: string]: unknown
}

export interface ToolContext {
  /** Set when the agent config defines `identify`. */
  user: AgentUser | undefined
  toolCallId: string
  abortSignal: AbortSignal | undefined
}

export type ConfirmOption<INPUT> =
  | boolean
  | ((input: INPUT, ctx: Omit<ToolContext, 'abortSignal'>) => boolean | Promise<boolean>)

export interface ToolOptions<SCHEMA extends z.ZodType, RESULT, OUTPUT = Awaited<RESULT>> {
  /** What the tool does. Shown to the model. */
  description: string
  /** When the model should (or should not) use it. Appended to the description. */
  usage?: string
  /** Input schema. The model's arguments are validated against it before `fn` runs. */
  input: SCHEMA
  /** Ask the user to approve each call before it runs. Use for anything that writes. */
  confirm?: ConfirmOption<z.infer<SCHEMA>>
  /** Map the function's return value before it is sent to the model (trim fields, hide secrets). */
  output?: (result: Awaited<RESULT>) => OUTPUT
  /**
   * Marks a tool that starts a background job and returns at once (hands work to a queue, a Lambda, ...).
   * Return the job's ID from the function's result. The chat UI waits for that ID on its `channel`; when
   * the job finishes the agent is told, reads the result with another of your tools, and continues.
   */
  job?: (result: Awaited<RESULT>) => string
  /**
   * Also offered to users who are not signed in. Needs `identify` in the agent config: when it returns
   * `undefined`, only public tools are given to the model, so features that need an account stay out of sight.
   * This only decides which tools the model sees; keep the permission checks in your server functions.
   */
  public?: boolean
  /**
   * Who may use the tool, decided per request from the signed-in user (from `identify`). When it returns `false`
   * the tool is left out of that request entirely: the model is not told it exists, so it cannot mention it.
   * Needs `identify`; without it the tool is never offered. Anonymous users never get it (it cannot be `public`).
   * Like `public`, this decides what the model sees; keep the permission checks in your server functions.
   */
  access?: (user: AgentUser) => boolean | Promise<boolean>
}

export type ToolFunction<INPUT, RESULT> = (input: INPUT, ctx: ToolContext) => RESULT

export interface DopusTool<
  SCHEMA extends z.ZodType = z.ZodType,
  RESULT = unknown,
  OUTPUT = unknown,
> {
  readonly kind: 'dopus-tool'
  readonly fn: ToolFunction<z.infer<SCHEMA>, RESULT>
  readonly options: ToolOptions<SCHEMA, RESULT, OUTPUT>
}

// biome-ignore lint/suspicious/noExplicitAny: tool inputs differ per tool; `unknown` breaks parameter variance
export type DopusToolSet = Record<string, DopusTool<any, any, any>>

/** The input a tool's function receives (its zod schema's output type). */
export type ToolInput<T> =
  T extends DopusTool<infer SCHEMA, infer _R, infer _O> ? z.infer<SCHEMA> : never

/** What the model and the chat UI get from a tool: its result, after `output` if the tool has one. */
export type ToolOutput<T> = T extends DopusTool<infer _S, infer _R, infer OUTPUT> ? OUTPUT : never

/** `{ toolName: { input, output } }` for the tools of an agent config (or of a tool set). */
export type InferAgentUITools<A> = A extends { model: unknown; tools: infer TOOLS }
  ? InferAgentUITools<TOOLS>
  : { [NAME in keyof A & string]: { input: ToolInput<A[NAME]>; output: ToolOutput<A[NAME]> } }

/**
 * A chat message whose tool parts are typed from your agent config: `part.type === 'tool-cancelOrder'` narrows
 * `part.input` to that tool's input. Use it for messages your app code handles (saved history, custom rendering):
 * `import type agent from '@/agent.config'` then `AgentUIMessage<typeof agent>`. A type only: messages from the
 * browser or your database are not checked against it.
 */
export type AgentUIMessage<A, METADATA = unknown> = UIMessage<
  METADATA,
  UIDataTypes,
  InferAgentUITools<A>
>

/**
 * Register an existing server function as an agent tool.
 *
 * The function is called as `fn(input, ctx)`. A function with positional parameters can be
 * adapted inline: `defineTool((i) => cancelOrder(i.orderId), { ... })`.
 */
export function defineTool<SCHEMA extends z.ZodType, RESULT, OUTPUT = Awaited<RESULT>>(
  fn: ToolFunction<z.infer<SCHEMA>, RESULT>,
  options: ToolOptions<SCHEMA, RESULT, OUTPUT>,
  // NoInfer: inside `defineAgent({ tools })` the expected type would otherwise turn OUTPUT into `any`.
): DopusTool<SCHEMA, RESULT, NoInfer<OUTPUT>> {
  if (typeof fn !== 'function') {
    throw new TypeError('defineTool: the first argument must be a function')
  }
  if (!options?.description?.trim()) {
    throw new TypeError('defineTool: `description` is required')
  }
  if (!options.input) {
    throw new TypeError('defineTool: `input` (a zod schema) is required')
  }
  if (options.public && options.access) {
    throw new TypeError('defineTool: a tool cannot be both `public` and limited by `access`')
  }
  return { kind: 'dopus-tool', fn, options }
}

export function isDopusTool(value: unknown): value is DopusTool {
  return typeof value === 'object' && value !== null && (value as DopusTool).kind === 'dopus-tool'
}

export function toolDescription(
  options: Pick<ToolOptions<z.ZodType, unknown, unknown>, 'description' | 'usage' | 'job'>,
) {
  const description = options.description.trim()
  const usage = options.usage?.trim()
  const text = usage ? `${description}\n\nWhen to use: ${usage}` : description
  return options.job ? `${text}\n\n${JOB_USAGE}` : text
}
