'use client'

/**
 * Chat UI for the dopus agent. Copied by `dopus init`; this file is yours to edit.
 * Talks to POST /api/agent with the AI SDK `useChat` protocol. Styles: ./agent-chat.module.css
 */
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai'
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import styles from './agent-chat.module.css'

const DEFAULT_LABELS = {
  title: 'Assistant',
  placeholder: 'Ask anything…',
  send: 'Send',
  stop: 'Stop',
  retry: 'Retry',
  error: 'Something went wrong.',
  thinking: 'Thinking…',
  running: 'Running',
  needsApproval: 'Needs your approval',
  approve: 'Approve',
  decline: 'Decline',
  approved: 'Approved',
  declined: 'Declined',
  failed: 'Failed',
  details: 'Details',
  open: 'Open assistant',
  close: 'Close assistant',
}

export type AgentChatLabels = typeof DEFAULT_LABELS

export interface AgentChatProps {
  /** Route created by `dopus init`. */
  api?: string
  labels?: Partial<AgentChatLabels>
  /** Example prompts shown before the first message. */
  suggestions?: string[]
  className?: string
}

type ToolPart = Extract<UIMessage['parts'][number], { toolCallId: string }>

/** `cancelOrder` → `Cancel order` */
function humanize(name: string) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function Json({ value }: { value: unknown }) {
  return <pre className={styles.json}>{JSON.stringify(value, null, 2)}</pre>
}

function ToolCall({
  part,
  labels,
  onRespond,
}: {
  part: ToolPart
  labels: AgentChatLabels
  onRespond: (approvalId: string, approved: boolean) => void
}) {
  const name = humanize(getToolName(part))

  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      return (
        <div className={styles.tool} data-state="running">
          <span className={styles.spinner} aria-hidden /> {labels.running}: {name}
        </div>
      )
    case 'approval-requested':
      return (
        <fieldset className={styles.approval}>
          <legend className={styles.approvalTitle}>
            {name} · {labels.needsApproval}
          </legend>
          <Json value={part.input} />
          <div className={styles.approvalActions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => onRespond(part.approval.id, true)}
            >
              {labels.approve}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => onRespond(part.approval.id, false)}
            >
              {labels.decline}
            </button>
          </div>
        </fieldset>
      )
    case 'approval-responded':
      return (
        <div className={styles.tool} data-state={part.approval.approved ? 'running' : 'declined'}>
          {part.approval.approved ? `${labels.approved}: ${name}` : `${labels.declined}: ${name}`}
        </div>
      )
    case 'output-available':
      return (
        <details className={styles.tool} data-state="done">
          <summary>✓ {name}</summary>
          <Json value={part.output} />
        </details>
      )
    case 'output-error':
      return (
        <div className={styles.tool} data-state="error">
          ✗ {name} · {labels.failed}
        </div>
      )
    case 'output-denied':
      return (
        <div className={styles.tool} data-state="declined">
          {labels.declined}: {name}
        </div>
      )
    default:
      return null
  }
}

function Message({
  message,
  labels,
  onRespond,
}: {
  message: UIMessage
  labels: AgentChatLabels
  onRespond: (approvalId: string, approved: boolean) => void
}) {
  return (
    <div className={styles.message} data-role={message.role}>
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`
        if (part.type === 'text') {
          return part.text ? (
            <div key={key} className={styles.text}>
              {part.text}
            </div>
          ) : null
        }
        if (isToolUIPart(part)) {
          return <ToolCall key={key} part={part} labels={labels} onRespond={onRespond} />
        }
        return null
      })}
    </div>
  )
}

export function AgentChat({
  api = '/api/agent',
  labels: labelOverrides,
  suggestions = [],
  className,
}: AgentChatProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api,
        // Untrusted hints for the prompt; the server only accepts `locale` and `page`.
        body: () => ({ context: { page: window.location.pathname, locale: navigator.language } }),
      }),
  )
  const { messages, sendMessage, status, stop, error, regenerate, addToolApprovalResponse } =
    useChat({
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    })
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const busy = status === 'submitted' || status === 'streaming'

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever messages change
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    sendMessage({ text: trimmed })
    setInput('')
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    send(input)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a line. Ignore Enter while an IME (Korean, Japanese…) is composing.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send(input)
    }
  }

  const respond = (id: string, approved: boolean) => addToolApprovalResponse({ id, approved })

  return (
    <section
      className={[styles.chat, className].filter(Boolean).join(' ')}
      aria-label={labels.title}
    >
      <header className={styles.header}>{labels.title}</header>
      <div ref={listRef} className={styles.messages} aria-live="polite">
        {messages.length === 0 && suggestions.length > 0 && (
          <div className={styles.suggestions}>
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                className={styles.suggestion}
                onClick={() => send(text)}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {messages.map((message) => (
          <Message key={message.id} message={message} labels={labels} onRespond={respond} />
        ))}
        {status === 'submitted' && <div className={styles.thinking}>{labels.thinking}</div>}
        {error && (
          <div className={styles.error} role="alert">
            {labels.error}{' '}
            <button type="button" className={styles.link} onClick={() => regenerate()}>
              {labels.retry}
            </button>
          </div>
        )}
      </div>
      <form className={styles.form} onSubmit={onSubmit}>
        <textarea
          className={styles.input}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={labels.placeholder}
          rows={1}
          aria-label={labels.placeholder}
        />
        {busy ? (
          <button type="button" className={styles.secondary} onClick={() => stop()}>
            {labels.stop}
          </button>
        ) : (
          <button type="submit" className={styles.primary} disabled={!input.trim()}>
            {labels.send}
          </button>
        )}
      </form>
    </section>
  )
}

/** Floating button that opens the chat in a panel. Put it once in your root layout. */
export function AgentWidget(props: AgentChatProps) {
  const [open, setOpen] = useState(false)
  const labels = { ...DEFAULT_LABELS, ...props.labels }
  return (
    <div className={styles.widget}>
      {open && <AgentChat {...props} className={styles.panel} />}
      <button
        type="button"
        className={styles.launcher}
        aria-expanded={open}
        aria-label={open ? labels.close : labels.open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '×' : '✦'}
      </button>
    </div>
  )
}
