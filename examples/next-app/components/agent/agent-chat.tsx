'use client'

/**
 * Chat UI for the dopus agent. Copied by `dopus init`; this file is yours to edit.
 * Talks to POST /api/agent with the AI SDK `useChat` protocol.
 * Styles: ./agent-chat.css — plain global CSS with `dopus-` class names (works with or without Tailwind).
 * Background jobs: pass a `channel` and the agent continues by itself when a job it started finishes.
 */
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai'
import { useRouter } from 'next/navigation'
import {
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './agent-chat.css'

const DEFAULT_LABELS = {
  title: 'Assistant',
  placeholder: 'Ask anything…',
  send: 'Send',
  stop: 'Stop',
  retry: 'Retry',
  newChat: 'New chat',
  tooLong: 'Too long to send. Start a new chat or shorten your message.',
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
  jobRunning: 'Working in the background',
  jobDone: 'Background task finished',
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
  /**
   * Where the app announces finished background jobs (Supabase Realtime, a WebSocket, SSE, polling...).
   * When a job started in this chat finishes, the agent is told and continues by itself. Create the
   * channel once (module scope or `useMemo`) in a client component; it holds functions, so it cannot be
   * passed from a server component.
   */
  channel?: AgentChannel
  /** Follow-up turns the agent may take in a row on finished jobs before waiting for the user. Default 3. */
  maxJobFollowUps?: number
}

export interface AgentChannel {
  /** Start listening and call `finished(jobId)` for each job that finishes. Return a function that stops. */
  subscribe: (finished: (jobId: string) => void) => () => void
}

// Must match the dopus server: a job tool's output carries `dopusJob: <id>`, and a finished job is reported
// back as a `data-dopus-job` part. The part carries only the ID; the server writes the text the model sees.
const JOB_KEY = 'dopusJob'
const JOB_PART = 'data-dopus-job'

function startedJob(part: UIMessage['parts'][number]): string | undefined {
  if (!isToolUIPart(part) || part.state !== 'output-available') return undefined
  const id = (part.output as Record<string, unknown> | null)?.[JOB_KEY]
  return typeof id === 'string' ? id : undefined
}

function isJobNotice(message: UIMessage) {
  return message.role === 'user' && message.parts.every((part) => part.type === JOB_PART)
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
  return <pre className="dopus-json">{JSON.stringify(value, null, 2)}</pre>
}

function ToolCall({
  part,
  labels,
  onRespond,
  waiting,
}: {
  part: ToolPart
  labels: AgentChatLabels
  onRespond: (approvalId: string, approved: boolean) => void
  waiting: boolean
}) {
  const name = humanize(getToolName(part))
  if (waiting) {
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
    case 'approval-requested':
      return (
        <fieldset className="dopus-approval">
          <legend className="dopus-approval-title">
            {name} · {labels.needsApproval}
          </legend>
          <Json value={part.input} />
          <div className="dopus-approval-actions">
            <button
              type="button"
              className="dopus-primary"
              onClick={() => onRespond(part.approval.id, true)}
            >
              {labels.approve}
            </button>
            <button
              type="button"
              className="dopus-secondary"
              onClick={() => onRespond(part.approval.id, false)}
            >
              {labels.decline}
            </button>
          </div>
        </fieldset>
      )
    case 'approval-responded':
      return (
        <div className="dopus-tool" data-state={part.approval.approved ? 'running' : 'declined'}>
          {part.approval.approved ? `${labels.approved}: ${name}` : `${labels.declined}: ${name}`}
        </div>
      )
    case 'output-available':
      return (
        <details className="dopus-tool" data-state="done">
          <summary>✓ {name}</summary>
          <Json value={part.output} />
        </details>
      )
    case 'output-error':
      return (
        <div className="dopus-tool" data-state="error">
          ✗ {name} · {labels.failed}
        </div>
      )
    case 'output-denied':
      return (
        <div className="dopus-tool" data-state="declined">
          {labels.declined}: {name}
        </div>
      )
    default:
      return null
  }
}

/**
 * Assistant replies are Markdown (tables, lists, bold). Rendered with react-markdown, which never renders raw HTML.
 * Images are shown as their alt text and never loaded, and links keep only http(s), mailto and relative URLs:
 * a reply influenced by prompt injection cannot load a URL that leaks data, or run script.
 */
const MARKDOWN_COMPONENTS: ComponentProps<typeof Markdown>['components'] = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  img: ({ alt }) => (alt ? <span>[{alt}]</span> : null),
  table: ({ children }) => (
    <div className="dopus-table">
      <table>{children}</table>
    </div>
  ),
}

function AssistantText({ text }: { text: string }) {
  return (
    <div className="dopus-text dopus-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
        urlTransform={(url) =>
          /^(https?:|mailto:|\/|#)/i.test(url) ? defaultUrlTransform(url) : ''
        }
      >
        {text}
      </Markdown>
    </div>
  )
}

function Message({
  message,
  labels,
  onRespond,
  waitingJobs,
}: {
  message: UIMessage
  labels: AgentChatLabels
  onRespond: (approvalId: string, approved: boolean) => void
  waitingJobs: Set<string>
}) {
  if (isJobNotice(message)) {
    return <div className="dopus-notice">✓ {labels.jobDone}</div>
  }
  return (
    <div className="dopus-message" data-role={message.role}>
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`
        if (part.type === 'text') {
          if (!part.text) return null
          return message.role === 'assistant' ? (
            <AssistantText key={key} text={part.text} />
          ) : (
            <div key={key} className="dopus-text">
              {part.text}
            </div>
          )
        }
        if (isToolUIPart(part)) {
          const job = startedJob(part)
          return (
            <ToolCall
              key={key}
              part={part}
              labels={labels}
              onRespond={onRespond}
              waiting={job !== undefined && waitingJobs.has(job)}
            />
          )
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
  channel,
  maxJobFollowUps = 3,
}: AgentChatProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const router = useRouter()
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api,
        // Untrusted hints for the prompt; the server only accepts `locale` and `page`.
        body: () => ({ context: { page: window.location.pathname, locale: navigator.language } }),
      }),
  )
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error,
    clearError,
    regenerate,
    addToolApprovalResponse,
  } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    // A tool ran, so data the page shows may have changed (server actions call revalidatePath):
    // re-render the current route's server components.
    onFinish: ({ message }) => {
      if (message.parts.some((part) => isToolUIPart(part) && part.state === 'output-available')) {
        router.refresh()
      }
    },
  })
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const busy = status === 'submitted' || status === 'streaming'

  // Jobs the channel reported finished. Kept even before this chat shows the job (a job can finish before
  // its tool output has streamed in); only IDs this chat started are acted on.
  const [finishedJobs, setFinishedJobs] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!channel) return
    return channel.subscribe((id) => setFinishedJobs((prev) => new Set(prev).add(id)))
  }, [channel])

  // Derived from the messages, so a new chat (or another tab) never reacts to jobs it did not start.
  const { waitingJobs, readyJobs } = useMemo(() => {
    const started = new Set<string>()
    const reported = new Set<string>()
    for (const message of messages) {
      for (const part of message.parts) {
        const id = startedJob(part)
        if (id) started.add(id)
        if (part.type === JOB_PART) reported.add((part.data as { id: string }).id)
      }
    }
    const waiting = new Set([...started].filter((id) => !reported.has(id)))
    return { waitingJobs: waiting, readyJobs: [...waiting].filter((id) => finishedJobs.has(id)) }
  }, [messages, finishedJobs])

  useEffect(() => {
    if (readyJobs.length === 0 || status !== 'ready') return
    const last = messages.at(-1)
    // Wait while an approval card is open: the user answers that first.
    if (last?.parts.some((part) => isToolUIPart(part) && part.state === 'approval-requested'))
      return
    const notice = {
      role: 'user' as const,
      parts: readyJobs.map(
        (id) => ({ type: JOB_PART, data: { id } }) as UIMessage['parts'][number],
      ),
    }
    // Follow-ups since the user last wrote; past the cap, the notice waits in the history for the user's next message.
    let followUps = 0
    for (const message of [...messages].reverse()) {
      if (message.role !== 'user') continue
      if (!isJobNotice(message)) break
      followUps++
    }
    if (followUps >= maxJobFollowUps) {
      setMessages([...messages, { id: `job-${readyJobs.join('-')}`, ...notice }])
    } else {
      sendMessage(notice)
    }
  }, [readyJobs, status, messages, maxJobFollowUps, sendMessage, setMessages])

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

  function newChat() {
    if (busy) stop()
    clearError()
    setMessages([])
    setInput('')
  }

  // The route answers 413 when the history is over its size limit; retrying cannot help then.
  const tooLong = (error as { statusCode?: number } | undefined)?.statusCode === 413

  return (
    <section
      className={['dopus-chat', className].filter(Boolean).join(' ')}
      aria-label={labels.title}
    >
      <header className="dopus-header">
        <span>{labels.title}</span>
        {messages.length > 0 && (
          <button type="button" className="dopus-link dopus-new-chat" onClick={newChat}>
            {labels.newChat}
          </button>
        )}
      </header>
      <div ref={listRef} className="dopus-messages" aria-live="polite">
        {messages.length === 0 && suggestions.length > 0 && (
          <div className="dopus-suggestions">
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                className="dopus-suggestion"
                onClick={() => send(text)}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            labels={labels}
            onRespond={respond}
            waitingJobs={waitingJobs}
          />
        ))}
        {status === 'submitted' && <div className="dopus-thinking">{labels.thinking}</div>}
        {error && (
          <div className="dopus-error" role="alert">
            {tooLong ? labels.tooLong : labels.error}{' '}
            <button
              type="button"
              className="dopus-link"
              onClick={() => (tooLong ? newChat() : regenerate())}
            >
              {tooLong ? labels.newChat : labels.retry}
            </button>
          </div>
        )}
      </div>
      <form className="dopus-form" onSubmit={onSubmit}>
        <textarea
          className="dopus-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={labels.placeholder}
          rows={1}
          aria-label={labels.placeholder}
        />
        {busy ? (
          <button type="button" className="dopus-secondary" onClick={() => stop()}>
            {labels.stop}
          </button>
        ) : (
          <button type="submit" className="dopus-primary" disabled={!input.trim()}>
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
    <div className="dopus-widget">
      {/* Hidden rather than unmounted, so closing the panel keeps the conversation. */}
      <div hidden={!open}>
        <AgentChat {...props} className="dopus-panel" />
      </div>
      <button
        type="button"
        className="dopus-launcher"
        aria-expanded={open}
        aria-label={open ? labels.close : labels.open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '×' : '✦'}
      </button>
    </div>
  )
}
