import { getToolName, isToolUIPart } from 'ai'
import type { AgentChatLabels } from '../react/labels.js'
import { type ChatPlugin, humanizeToolName, JsonBlock, startedJob } from '../react/plugin.js'

export interface ToolLogOptions {
  /** Override labels for this plugin only. */
  labels?: Partial<AgentChatLabels>
  /** Show the tool output in an expandable block (default true). */
  details?: boolean
  /** Tool names to leave out of the chat. */
  hide?: string[]
  /** The title shown for a tool; default is the humanized tool name. */
  title?: (toolName: string) => string
}

/** Shows tool calls: running, finished, failed, declined, not run, and background jobs. */
export function toolLog(options: ToolLogOptions = {}): ChatPlugin {
  const { details = true, hide = [], title = humanizeToolName } = options
  return {
    name: 'toolLog',
    renderPart(part, ctx) {
      if (!isToolUIPart(part)) return undefined
      const toolName = getToolName(part)
      const approvalState =
        part.state === 'approval-requested' || part.state === 'approval-responded'
      // The approvals plugin owns open approval cards.
      if (approvalState && !ctx.stale) return undefined
      if (hide.includes(toolName)) return null
      const labels = { ...ctx.labels, ...options.labels }
      const name = title(toolName)

      if (approvalState) {
        return (
          <div className="dopus-tool" data-state="declined">
            {labels.notRun}: {name}
          </div>
        )
      }
      const job = startedJob(part)
      if (job !== undefined && ctx.waitingJobs.has(job)) {
        return (
          <div className="dopus-tool" data-state="running">
            <span className="dopus-spinner" aria-hidden /> {labels.jobRunning}: {name}
          </div>
        )
      }
      switch (part.state) {
        case 'input-streaming':
        case 'input-available':
          return (
            <div className="dopus-tool" data-state="running">
              <span className="dopus-spinner" aria-hidden /> {labels.running}: {name}
            </div>
          )
        case 'output-available':
          return details ? (
            <details className="dopus-tool" data-state="done">
              <summary>✓ {name}</summary>
              <JsonBlock value={part.output} />
            </details>
          ) : (
            <div className="dopus-tool" data-state="done">
              ✓ {name}
            </div>
          )
        case 'output-error':
          return (
            <div className="dopus-tool" data-state="error">
              ✗ {name} · {labels.failed}
            </div>
          )
        case 'output-denied':
          // Approved but closed by the server without running (signed out or no access in the meantime).
          return (
            <div className="dopus-tool" data-state="declined">
              {part.approval?.approved ? labels.notRun : labels.declined}: {name}
            </div>
          )
        default:
          return undefined
      }
    },
  }
}
