import { isToolUIPart, type UIMessage } from 'ai'
import { createElement, type ReactNode } from 'react'
import type { AgentChatLabels } from './labels.js'

export type ChatPart = UIMessage['parts'][number]

export interface ChatContext {
  messages: UIMessage[]
  labels: AgentChatLabels
  busy: boolean
  /** Approval ids of open cards in the newest message. */
  openApprovals: string[]
  respondToApproval: (approvalId: string, approved: boolean) => void
}

export interface PartContext extends ChatContext {
  message: UIMessage
  /** The message is not the newest one. */
  stale: boolean
  /** Jobs this chat started that have not reported back. */
  waitingJobs: ReadonlySet<string>
}

export interface ComposerContext extends ChatContext {
  /** Report this plugin's draft state: content lets Send go out without text; blocked holds Send back. */
  setDraftState: (state: { hasContent?: boolean; blocked?: boolean }) => void
}

export interface Draft {
  text: string
  parts: ChatPart[]
}

/**
 * A part of the chat the app chooses. Create plugins once (module scope or `useMemo`), like `channel`.
 * Plugins are tried in array order; the first `renderPart` that returns something other than `undefined` wins.
 */
export interface ChatPlugin {
  name: string
  /** What the server may rely on this client to show. */
  capabilities?: { approvals?: boolean }
  /** Render a message part (tool parts, data parts). Return undefined to leave it to the next plugin. */
  renderPart?: (part: ChatPart, ctx: PartContext) => ReactNode | undefined
  /** After the messages (e.g. "Approve all"). */
  renderFooter?: (ctx: ChatContext) => ReactNode
  /** Inside the composer, next to the send button (e.g. the attach button and file chips). */
  renderComposer?: (ctx: ComposerContext) => ReactNode
  /** Return the draft to send (may add parts), or false to hold it back. */
  beforeSend?: (draft: Draft) => Draft | false | Promise<Draft | false>
  /** Called after a message went out, so the plugin can clear its draft. */
  afterSend?: () => void
}

/** Types a plugin object; returns it unchanged. */
export function definePlugin(plugin: ChatPlugin): ChatPlugin {
  return plugin
}

export function renderPluginPart(
  plugins: readonly ChatPlugin[],
  part: ChatPart,
  ctx: PartContext,
): ReactNode | undefined {
  for (const plugin of plugins) {
    const node = plugin.renderPart?.(part, ctx)
    if (node !== undefined) return node
  }
  return undefined
}

/** Sent with every request as `dopus`; without approvals the server does not offer `confirm` tools. */
export function clientFeatures(plugins: readonly ChatPlugin[]): { approvals: boolean } {
  return { approvals: plugins.some((plugin) => plugin.capabilities?.approvals === true) }
}

// Must match the dopus server: a job tool's output carries `dopusJob: <id>`, and a finished job is reported
// back as a `data-dopus-job` part. The part carries only the ID; the server writes the text the model sees.
export const JOB_KEY = 'dopusJob'
export const JOB_PART = 'data-dopus-job'
// Must match the dopus server's FILE_PART: a file reference `{ id, name, type, size }` on a user message.
export const FILE_PART = 'data-dopus-file'

/** The job ID a finished tool part started, if it is a background job tool. */
export function startedJob(part: ChatPart): string | undefined {
  if (!isToolUIPart(part) || part.state !== 'output-available') return undefined
  const id = (part.output as Record<string, unknown> | null)?.[JOB_KEY]
  return typeof id === 'string' ? id : undefined
}

/** `cancelOrder` → `Cancel order` */
export function humanizeToolName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A value as indented JSON (tool input and output). */
export function JsonBlock({ value }: { value: unknown }): ReactNode {
  return createElement('pre', { className: 'dopus-json' }, JSON.stringify(value, null, 2))
}

/** `1200` → `1.2 KB` */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)} ${units[unit]}`
}
