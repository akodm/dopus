import type { UIMessage } from 'ai'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { approvals } from '../src/plugins/approvals.js'
import { toolLog } from '../src/plugins/tool-log.js'
import { DEFAULT_LABELS } from '../src/react/labels.js'
import {
  type ChatContext,
  type ChatPart,
  type PartContext,
  renderPluginPart,
} from '../src/react/plugin.js'

const message: UIMessage = { id: 'm1', role: 'assistant', parts: [] }

function partContext(overrides: Partial<PartContext> = {}): PartContext {
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

function tool(state: string, extra: Record<string, unknown> = {}, type = 'tool-cancelOrder') {
  return { type, toolCallId: 'call-1', state, input: { orderId: 'A-1' }, ...extra } as ChatPart
}

function html(
  plugins: Parameters<typeof renderPluginPart>[0],
  part: ChatPart,
  ctx = partContext(),
) {
  const node = renderPluginPart(plugins, part, ctx)
  return node === undefined || node === null ? '' : renderToStaticMarkup(<>{node}</>)
}

describe('toolLog', () => {
  const log = toolLog()

  it('renders running states with a spinner', () => {
    for (const state of ['input-streaming', 'input-available']) {
      const out = html([log], tool(state))
      expect(out).toContain('Running: Cancel order')
      expect(out).toContain('dopus-spinner')
      expect(out).toContain('data-state="running"')
    }
  })

  it('renders output-available as details with the JSON output', () => {
    const out = html([log], tool('output-available', { output: { ok: true } }))
    expect(out).toContain('<details class="dopus-tool" data-state="done">')
    expect(out).toContain('✓ Cancel order')
    expect(out).toContain('dopus-json')
  })

  it('renders a plain line when details is false', () => {
    const out = html(
      [toolLog({ details: false })],
      tool('output-available', { output: { ok: true } }),
    )
    expect(out).toContain('✓ Cancel order')
    expect(out).not.toContain('<details')
    expect(out).not.toContain('dopus-json')
  })

  it('renders output-error', () => {
    const out = html([log], tool('output-error', { errorText: 'x' }))
    expect(out).toContain('✗ Cancel order · Failed')
    expect(out).toContain('data-state="error"')
  })

  it('renders output-denied as Declined or Not run', () => {
    expect(
      html([log], tool('output-denied', { approval: { id: 'a', approved: false } })),
    ).toContain('Declined: Cancel order')
    expect(html([log], tool('output-denied', { approval: { id: 'a', approved: true } }))).toContain(
      'Not run: Cancel order',
    )
  })

  it('renders stale approval cards as Not run', () => {
    const ctx = partContext({ stale: true })
    expect(html([log], tool('approval-requested', { approval: { id: 'a' } }), ctx)).toContain(
      'Not run: Cancel order',
    )
    expect(
      html([log], tool('approval-responded', { approval: { id: 'a', approved: true } }), ctx),
    ).toContain('Not run: Cancel order')
  })

  it('renders a waiting job', () => {
    const part = tool('output-available', { output: { dopusJob: 'job-1' } })
    const out = html([log], part, partContext({ waitingJobs: new Set(['job-1']) }))
    expect(out).toContain('Working in the background: Cancel order')
    expect(out).toContain('dopus-spinner')
    expect(html([log], part)).toContain('✓ Cancel order')
  })

  it('leaves non-stale approval cards and non-tool parts to others', () => {
    expect(
      log.renderPart?.(tool('approval-requested', { approval: { id: 'a' } }), partContext()),
    ).toBe(undefined)
    expect(
      log.renderPart?.(
        tool('approval-responded', { approval: { id: 'a', approved: true } }),
        partContext(),
      ),
    ).toBe(undefined)
    expect(log.renderPart?.({ type: 'text', text: 'hi' } as ChatPart, partContext())).toBe(
      undefined,
    )
  })

  it('renders nothing for an open approval with toolLog alone', () => {
    expect(html([log], tool('approval-requested', { approval: { id: 'a' } }))).toBe('')
  })

  it('hides tools and replaces titles', () => {
    const plugin = toolLog({ hide: ['getCurrentUser'], title: (name) => `Tool ${name}` })
    expect(
      plugin.renderPart?.(tool('output-available', {}, 'tool-getCurrentUser'), partContext()),
    ).toBe(null)
    expect(html([plugin], tool('output-error'))).toContain('✗ Tool cancelOrder · Failed')
  })

  it('overrides labels for this plugin only', () => {
    const out = html([toolLog({ labels: { running: '실행 중' } })], tool('input-available'))
    expect(out).toContain('실행 중: Cancel order')
  })
})

describe('approvals', () => {
  const plugin = approvals()
  const requested = tool('approval-requested', { approval: { id: 'ap-1' } })

  it('declares the approvals capability', () => {
    expect(plugin.name).toBe('approvals')
    expect(plugin.capabilities).toEqual({ approvals: true })
  })

  it('renders the approval card', () => {
    const out = html([plugin], requested)
    expect(out).toContain('<fieldset class="dopus-approval">')
    expect(out).toContain('Cancel order · Needs your approval')
    expect(out).toContain('dopus-json')
    expect(out).toContain('Approve')
    expect(out).toContain('Decline')
  })

  it('renders approval-responded', () => {
    expect(
      html([plugin], tool('approval-responded', { approval: { id: 'a', approved: true } })),
    ).toContain('Approved: Cancel order')
    const declined = html(
      [plugin],
      tool('approval-responded', { approval: { id: 'a', approved: false } }),
    )
    expect(declined).toContain('Declined: Cancel order')
    expect(declined).toContain('data-state="declined"')
  })

  it('leaves other states and stale cards to others', () => {
    expect(plugin.renderPart?.(tool('output-available', { output: {} }), partContext())).toBe(
      undefined,
    )
    expect(plugin.renderPart?.(requested, partContext({ stale: true }))).toBe(undefined)
  })

  it('overrides labels and describe', () => {
    const custom = approvals({
      labels: { approve: '승인' },
      describe: (name, input) => <p className="custom">{`${name}:${JSON.stringify(input)}`}</p>,
    })
    const out = html([custom], requested)
    expect(out).toContain('승인')
    expect(out).toContain('<p class="custom">cancelOrder:{&quot;orderId&quot;:&quot;A-1&quot;}</p>')
    expect(out).not.toContain('dopus-json')
  })

  it('wires the buttons to respondToApproval', () => {
    const respond = vi.fn()
    const node = plugin.renderPart?.(requested, partContext({ respondToApproval: respond }))
    const buttons: { props: { onClick: () => void } }[] = []
    const walk = (n: unknown) => {
      const el = n as { type?: unknown; props?: { children?: unknown; onClick?: () => void } }
      if (!el || typeof el !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (el.type === 'button') buttons.push(el as never)
      walk(el.props?.children)
    }
    walk(node)
    buttons[0]?.props.onClick()
    buttons[1]?.props.onClick()
    expect(respond.mock.calls).toEqual([
      ['ap-1', true],
      ['ap-1', false],
    ])
  })

  function chatContext(openApprovals: string[], respond = vi.fn()): ChatContext {
    return {
      messages: [],
      labels: DEFAULT_LABELS,
      busy: false,
      openApprovals,
      respondToApproval: respond,
    }
  }

  it('shows the approve-all row for more than one open approval', () => {
    const out = renderToStaticMarkup(<>{plugin.renderFooter?.(chatContext(['a', 'b']))}</>)
    expect(out).toContain('dopus-approval-actions dopus-approval-all')
    expect(out).toContain('Approve all (2)')
    expect(out).toContain('Decline all')
  })

  it('shows no approve-all row for one approval or when disabled', () => {
    expect(renderToStaticMarkup(<>{plugin.renderFooter?.(chatContext(['a']))}</>)).toBe('')
    const off = approvals({ approveAll: false })
    expect(renderToStaticMarkup(<>{off.renderFooter?.(chatContext(['a', 'b']))}</>)).toBe('')
  })
})
