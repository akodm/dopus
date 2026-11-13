import type { UIMessage } from 'ai'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentChat, MessageView, requestBody, waitsForApproval } from '../src/react/chat.js'
import { DEFAULT_LABELS } from '../src/react/labels.js'
import {
  type ChatPart,
  type ChatPlugin,
  clientFeatures,
  definePlugin,
  type PartContext,
  renderPluginPart,
} from '../src/react/plugin.js'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

function partContext(message: UIMessage, overrides: Partial<PartContext> = {}): PartContext {
  return {
    messages: [message],
    labels: DEFAULT_LABELS,
    busy: false,
    openApprovals: [],
    respondToApproval: () => {},
    message,
    stale: false,
    waitingJobs: new Set(),
    ...overrides,
  }
}

const toolPart = {
  type: 'tool-cancelOrder',
  toolCallId: 'call-1',
  state: 'output-available',
  input: { orderId: 'A-1' },
  output: { ok: true },
} as ChatPart

const toolMessage: UIMessage = { id: 'm1', role: 'assistant', parts: [toolPart] }

describe('renderPluginPart', () => {
  it('returns the first result in array order', () => {
    const skip = definePlugin({ name: 'skip', renderPart: () => undefined })
    const first = definePlugin({ name: 'first', renderPart: () => 'first' })
    const second = definePlugin({ name: 'second', renderPart: () => 'second' })
    const ctx = partContext(toolMessage)
    expect(renderPluginPart([skip, first, second], toolPart, ctx)).toBe('first')
    expect(renderPluginPart([second, first], toolPart, ctx)).toBe('second')
  })

  it('treats null as a result (the plugin hides the part)', () => {
    const hide = definePlugin({ name: 'hide', renderPart: () => null })
    const show = definePlugin({ name: 'show', renderPart: () => 'shown' })
    expect(renderPluginPart([hide, show], toolPart, partContext(toolMessage))).toBeNull()
  })

  it('passes a part on when a plugin returns false (cond && <X />)', () => {
    const notMine = definePlugin({
      name: 'notMine',
      renderPart: (part) => part.type === 'tool-other' && 'other',
    })
    const mine = definePlugin({ name: 'mine', renderPart: () => 'mine' })
    expect(renderPluginPart([notMine, mine], toolPart, partContext(toolMessage))).toBe('mine')
    expect(renderPluginPart([notMine], toolPart, partContext(toolMessage))).toBeUndefined()
  })

  it('returns undefined with no plugins', () => {
    expect(renderPluginPart([], toolPart, partContext(toolMessage))).toBeUndefined()
  })
})

describe('clientFeatures', () => {
  it('has no approvals without a plugin that declares them', () => {
    expect(clientFeatures([])).toEqual({ approvals: false })
    expect(clientFeatures([definePlugin({ name: 'plain' })])).toEqual({ approvals: false })
  })

  it('has approvals when a plugin declares them', () => {
    const plugins: ChatPlugin[] = [
      definePlugin({ name: 'plain' }),
      definePlugin({ name: 'approvals', capabilities: { approvals: true } }),
    ]
    expect(clientFeatures(plugins)).toEqual({ approvals: true })
  })
})

describe('MessageView', () => {
  it('renders sent file parts without the plugin', () => {
    const message: UIMessage = {
      id: 'u1',
      role: 'user',
      parts: [
        { type: 'text', text: 'Tidy this up' },
        {
          type: 'data-dopus-file',
          data: { id: 'f1', name: 'sales.xlsx', type: 'application/vnd.ms-excel', size: 1200 },
        } as ChatPart,
      ],
    }
    const html = renderToStaticMarkup(
      <MessageView message={message} plugins={[]} ctx={partContext(message)} />,
    )
    expect(html).toContain('class="dopus-file"')
    expect(html).toContain('sales.xlsx')
    expect(html).toContain('1.2 KB')
    expect(html).toContain('Tidy this up')
  })

  it('renders file parts in assistant and restored messages too', () => {
    const message: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'data-dopus-file', data: { id: 'f2', name: 'a.csv', type: '', size: 5 } }],
    } as UIMessage
    const html = renderToStaticMarkup(
      <MessageView message={message} plugins={[]} ctx={partContext(message, { stale: true })} />,
    )
    expect(html).toContain('a.csv')
  })

  it('does not show a tool part no plugin renders', () => {
    const html = renderToStaticMarkup(
      <MessageView message={toolMessage} plugins={[]} ctx={partContext(toolMessage)} />,
    )
    expect(html).not.toContain('dopus-tool')
    expect(html).not.toContain('cancelOrder')
  })

  it('shows a tool part through a plugin, with the part context', () => {
    const plugin = definePlugin({
      name: 'mine',
      renderPart: (part, ctx) =>
        part.type === 'tool-cancelOrder' ? (
          <div className="dopus-tool">{ctx.stale ? 'old' : 'new'}</div>
        ) : undefined,
    })
    const html = renderToStaticMarkup(
      <MessageView message={toolMessage} plugins={[plugin]} ctx={partContext(toolMessage)} />,
    )
    expect(html).toContain('<div class="dopus-tool">new</div>')
  })

  it('shows the background job notice for a job report', () => {
    const message = {
      id: 'j1',
      role: 'user',
      parts: [{ type: 'data-dopus-job', data: { id: 'job-1' } }],
    } as UIMessage
    const html = renderToStaticMarkup(
      <MessageView message={message} plugins={[]} ctx={partContext(message)} />,
    )
    expect(html).toContain('dopus-notice')
    expect(html).toContain(DEFAULT_LABELS.jobDone)
  })
})

describe('requestBody', () => {
  const context = { page: '/orders', locale: 'en-US' }

  it('sends the context and the client features', () => {
    expect(requestBody({ current: [] }, context)).toEqual({
      context,
      dopus: { approvals: false },
    })
  })

  it('reads plugins at send time', () => {
    const pluginsRef: { current: readonly ChatPlugin[] } = { current: [] }
    const body = () => requestBody(pluginsRef, context)
    expect(body().dopus).toEqual({ approvals: false })
    pluginsRef.current = [definePlugin({ name: 'approvals', capabilities: { approvals: true } })]
    expect(body().dopus).toEqual({ approvals: true })
    pluginsRef.current = []
    expect(body().dopus).toEqual({ approvals: false })
  })
})

describe('waitsForApproval', () => {
  const asking: UIMessage = {
    id: 'm2',
    role: 'assistant',
    parts: [
      {
        type: 'tool-cancelOrder',
        toolCallId: 'call-2',
        state: 'approval-requested',
        input: { orderId: 'A-1' },
        approval: { id: 'ap-1' },
      } as ChatPart,
    ],
  }
  const approvalsPlugin = definePlugin({ name: 'approvals', capabilities: { approvals: true } })

  it('holds job follow-ups while an approval card is open', () => {
    expect(waitsForApproval(asking, [approvalsPlugin])).toBe(true)
  })

  it('keeps holding them after the user answered, until the approval has continued', () => {
    // Answered but not yet sent back: a follow-up sent now would make the card stale, and the approved call
    // would never run.
    const answered: UIMessage = {
      ...asking,
      parts: [
        {
          ...(asking.parts[0] as object),
          state: 'approval-responded',
          approval: { id: 'ap-1', approved: true },
        } as ChatPart,
      ],
    }
    expect(waitsForApproval(answered, [approvalsPlugin])).toBe(true)
  })

  it('does not hold them when no plugin shows approval cards (the card is invisible)', () => {
    expect(waitsForApproval(asking, [])).toBe(false)
    expect(waitsForApproval(asking, [definePlugin({ name: 'plain' })])).toBe(false)
  })

  it('does not hold them without an open card', () => {
    expect(waitsForApproval(toolMessage, [approvalsPlugin])).toBe(false)
    expect(waitsForApproval(undefined, [approvalsPlugin])).toBe(false)
  })
})

describe('AgentChat', () => {
  it('renders plugin footer and composer slots, with Send disabled on an empty draft', () => {
    const plugin = definePlugin({
      name: 'slots',
      renderFooter: (ctx) => <div className="dopus-test-footer">{ctx.openApprovals.length}</div>,
      renderComposer: (ctx) => (
        <button type="button" className="dopus-attach">
          {ctx.labels.attach}
        </button>
      ),
    })
    const html = renderToStaticMarkup(<AgentChat plugins={[plugin]} labels={{ send: 'Go' }} />)
    expect(html).toContain('<div class="dopus-test-footer">0</div>')
    expect(html).toMatch(/<form class="dopus-form">.*class="dopus-attach">Attach file<.*<\/form>/)
    expect(html).toContain('<button type="submit" class="dopus-primary" disabled="">Go</button>')
  })

  it('renders without plugins', () => {
    const html = renderToStaticMarkup(<AgentChat suggestions={['Hi']} />)
    expect(html).toContain('class="dopus-chat"')
    expect(html).toContain('class="dopus-suggestion"')
  })
})
