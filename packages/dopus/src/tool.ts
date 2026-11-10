import type { z } from 'zod'

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

export interface ToolOptions<SCHEMA extends z.ZodType, RESULT> {
  /** What the tool does. Shown to the model. */
  description: string
  /** When the model should (or should not) use it. Appended to the description. */
  usage?: string
  /** Input schema. The model's arguments are validated against it before `fn` runs. */
  input: SCHEMA
  /** Ask the user to approve each call before it runs. Use for anything that writes. */
  confirm?: ConfirmOption<z.infer<SCHEMA>>
  /** Map the function's return value before it is sent to the model (trim fields, hide secrets). */
  output?: (result: Awaited<RESULT>) => unknown
}

export type ToolFunction<INPUT, RESULT> = (input: INPUT, ctx: ToolContext) => RESULT

export interface DopusTool<SCHEMA extends z.ZodType = z.ZodType, RESULT = unknown> {
  readonly kind: 'dopus-tool'
  readonly fn: ToolFunction<z.infer<SCHEMA>, RESULT>
  readonly options: ToolOptions<SCHEMA, RESULT>
}

// biome-ignore lint/suspicious/noExplicitAny: tool inputs differ per tool; `unknown` breaks parameter variance
export type DopusToolSet = Record<string, DopusTool<any, any>>

/**
 * Register an existing server function as an agent tool.
 *
 * The function is called as `fn(input, ctx)`. A function with positional parameters can be
 * adapted inline: `defineTool((i) => cancelOrder(i.orderId), { ... })`.
 */
export function defineTool<SCHEMA extends z.ZodType, RESULT>(
  fn: ToolFunction<z.infer<SCHEMA>, RESULT>,
  options: ToolOptions<SCHEMA, RESULT>,
): DopusTool<SCHEMA, RESULT> {
  if (typeof fn !== 'function') {
    throw new TypeError('defineTool: the first argument must be a function')
  }
  if (!options?.description?.trim()) {
    throw new TypeError('defineTool: `description` is required')
  }
  if (!options.input) {
    throw new TypeError('defineTool: `input` (a zod schema) is required')
  }
  return { kind: 'dopus-tool', fn, options }
}

export function isDopusTool(value: unknown): value is DopusTool {
  return typeof value === 'object' && value !== null && (value as DopusTool).kind === 'dopus-tool'
}

export function toolDescription(
  options: Pick<ToolOptions<z.ZodType, unknown>, 'description' | 'usage'>,
) {
  const description = options.description.trim()
  const usage = options.usage?.trim()
  return usage ? `${description}\n\nWhen to use: ${usage}` : description
}
