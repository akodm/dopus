import { getToolName, isToolUIPart } from 'ai'
import type { ReactNode } from 'react'
import type { AgentChatLabels } from '../react/labels.js'
import { type ChatPlugin, humanizeToolName, JsonBlock } from '../react/plugin.js'

export interface ApprovalsOptions {
  /** Override labels for this plugin only. */
  labels?: Partial<AgentChatLabels>
  /** Show "Approve all" when several cards are open (default true). */
  approveAll?: boolean
  /** What the card shows about the call; default is the tool input as JSON. */
  describe?: (toolName: string, input: unknown) => ReactNode
}

/**
 * Approval cards for `confirm` tools. Including this plugin tells the server the client can ask; without it
 * the server does not offer `confirm` tools.
 */
export function approvals(options: ApprovalsOptions = {}): ChatPlugin {
  const { approveAll = true, describe } = options
  return {
    name: 'approvals',
    capabilities: { approvals: true },
    renderPart(part, ctx) {
      if (!isToolUIPart(part) || ctx.stale) return undefined
      const labels = { ...ctx.labels, ...options.labels }
      const toolName = getToolName(part)
      const name = humanizeToolName(toolName)
      if (part.state === 'approval-requested') {
        return (
          <fieldset className="dopus-approval">
            <legend className="dopus-approval-title">
              {name} · {labels.needsApproval}
            </legend>
            {describe ? describe(toolName, part.input) : <JsonBlock value={part.input} />}
            <div className="dopus-approval-actions">
              <button
                type="button"
                className="dopus-primary"
                onClick={() => ctx.respondToApproval(part.approval.id, true)}
              >
                {labels.approve}
              </button>
              <button
                type="button"
                className="dopus-secondary"
                onClick={() => ctx.respondToApproval(part.approval.id, false)}
              >
                {labels.decline}
              </button>
            </div>
          </fieldset>
        )
      }
      if (part.state === 'approval-responded') {
        return (
          <div className="dopus-tool" data-state={part.approval.approved ? 'running' : 'declined'}>
            {part.approval.approved ? `${labels.approved}: ${name}` : `${labels.declined}: ${name}`}
          </div>
        )
      }
      return undefined
    },
    renderFooter(ctx) {
      if (!approveAll || ctx.openApprovals.length < 2) return null
      const labels = { ...ctx.labels, ...options.labels }
      const respondAll = (approved: boolean) => {
        for (const id of ctx.openApprovals) ctx.respondToApproval(id, approved)
      }
      return (
        <div className="dopus-approval-actions dopus-approval-all">
          <button type="button" className="dopus-primary" onClick={() => respondAll(true)}>
            {labels.approveAll} ({ctx.openApprovals.length})
          </button>
          <button type="button" className="dopus-secondary" onClick={() => respondAll(false)}>
            {labels.declineAll}
          </button>
        </div>
      )
    },
  }
}
