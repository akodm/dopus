/**
 * Chat shell for the dopus agent. Talks to POST /api/agent with the AI SDK `useChat` protocol.
 * Tool lines, approval cards and attachments are plugins (`dopus/plugins`); the shell renders text, file
 * references, background job notices and the composer, and routes every other part to its plugins.
 * Styles: the app's agent-chat.css — plain global CSS with `dopus-` class names.
 */
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai'
import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { type AgentChatLabels, DEFAULT_LABELS } from './labels.js'
import { AssistantText } from './markdown.js'
import {
  type ChatContext,
  type ChatPart,
  type ChatPlugin,
  type ComposerContext,
  clientFeatures,
  type Draft,
  FILE_PART,
  formatFileSize,
  JOB_PART,
  type PartContext,
  renderPluginPart,
  startedJob,
} from './plugin.js'

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
  /** Called when the agent finishes a reply. `AgentWidget` uses it to mark the closed launcher as unread. */
  onReply?: () => void
  /** Keep the conversation across reloads. Off by default (the chat lives in memory). */
  history?: AgentChatHistory
  /**
   * Parts of the chat the app chooses (`dopus/plugins` or your own). Tried in array order. Create them once
   * (module scope or `useMemo`), in a client component.
   */
  plugins?: ChatPlugin[]
}

/** Where the conversation is kept. Both are optional; neither may throw away the user's data silently. */
export interface AgentChatHistory {
  /** Called once when the chat mounts; return the conversation to restore. */
  load?: () => UIMessage[] | null | undefined | Promise<UIMessage[] | null | undefined>
  /** Called when the chat settles after a change, and with `[]` on "New chat". */
  save?: (messages: UIMessage[]) => void | Promise<void>
}

export interface AgentChannel {
  /** Start listening and call `finished(jobId)` for each job that finishes. Return a function that stops. */
  subscribe: (finished: (jobId: string) => void) => () => void
}

const NO_PLUGINS: readonly ChatPlugin[] = []

type DraftState = { hasContent?: boolean; blocked?: boolean }

function isJobNotice(message: UIMessage) {
  return message.role === 'user' && message.parts.every((part) => part.type === JOB_PART)
}

/**
 * The request body next to the messages. Untrusted hints for the prompt (the server only accepts `locale` and
 * `page`) and what this client can show. Reads the plugins when the request is made, so a plugins array created
 * on every render never needs a new transport.
 */
export function requestBody(
  pluginsRef: { current: readonly ChatPlugin[] },
  context: { page: string; locale: string },
): { context: { page: string; locale: string }; dopus: { approvals: boolean } } {
  return { context, dopus: clientFeatures(pluginsRef.current) }
}

/** A file reference in a sent message, read-only. Shown with or without the attachments plugin. */
function FileChip({ data }: { data: unknown }) {
  const file = (data ?? {}) as { name?: unknown; size?: unknown }
  const name = typeof file.name === 'string' ? file.name : ''
  const size = typeof file.size === 'number' ? formatFileSize(file.size) : ''
  return (
    <span className="dopus-file" title={name}>
      {name}
      {size && ` (${size})`}
    </span>
  )
}

export function MessageView({
  message,
  plugins,
  ctx,
}: {
  message: UIMessage
  plugins: readonly ChatPlugin[]
  ctx: PartContext
}): ReactNode {
  if (isJobNotice(message)) {
    return <div className="dopus-notice">✓ {ctx.labels.jobDone}</div>
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
        // Plugins first, so an app can replace any part; a tool part no plugin renders is not shown.
        const node = renderPluginPart(plugins, part, ctx)
        if (node !== undefined) return <Fragment key={key}>{node}</Fragment>
        if (part.type === FILE_PART) return <FileChip key={key} data={part.data} />
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
  onReply,
  history,
  plugins: pluginsProp,
}: AgentChatProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const plugins: readonly ChatPlugin[] = pluginsProp ?? NO_PLUGINS
  const router = useRouter()
  // The transport reads the current plugins per request through this ref, so an inline array never resets it.
  const pluginsRef = useRef(plugins)
  useEffect(() => {
    pluginsRef.current = plugins
  })
  // useChat keeps the callbacks it was created with; read the latest onReply through a ref.
  const onReplyRef = useRef(onReply)
  useEffect(() => {
    onReplyRef.current = onReply
  })
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api,
        body: () =>
          requestBody(pluginsRef, { page: window.location.pathname, locale: navigator.language }),
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
      onReplyRef.current?.()
    },
  })
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const busy = status === 'submitted' || status === 'streaming'

  // Chat history: restore once on mount (after hydration), then save whenever the chat settles.
  const historyRef = useRef(history)
  useEffect(() => {
    historyRef.current = history
  })
  const [restored, setRestored] = useState(!history?.load)
  useEffect(() => {
    const load = historyRef.current?.load
    if (!load) return
    let cancelled = false
    Promise.resolve()
      .then(load)
      .then((saved) => {
        // Keep anything the user already typed while it was loading.
        if (!cancelled && saved?.length)
          setMessages((current) => (current.length ? current : saved))
      })
      .catch((error) => console.error('[dopus] history.load failed', error))
      .finally(() => {
        if (!cancelled) setRestored(true)
      })
    return () => {
      cancelled = true
    }
  }, [setMessages])
  useEffect(() => {
    // Empty is saved only by "New chat", so a slow or failed load never overwrites what was stored.
    if (!restored || status !== 'ready' || messages.length === 0) return
    Promise.resolve(historyRef.current?.save?.(messages)).catch((error) =>
      console.error('[dopus] history.save failed', error),
    )
  }, [restored, status, messages])

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
      parts: readyJobs.map((id) => ({ type: JOB_PART, data: { id } }) as ChatPart),
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

  // What each plugin reported about its part of the draft (e.g. files attached, an upload running).
  const [draftStates, setDraftStates] = useState<Record<string, DraftState>>({})
  // One stable setter per plugin name; a repeated report with the same values changes nothing.
  const [draftSetters] = useState(() => new Map<string, ComposerContext['setDraftState']>())
  function draftSetter(name: string) {
    let setter = draftSetters.get(name)
    if (!setter) {
      setter = (state) =>
        setDraftStates((prev) => {
          const current = prev[name] ?? {}
          const next = { ...current, ...state }
          if (next.hasContent === current.hasContent && next.blocked === current.blocked)
            return prev
          return { ...prev, [name]: next }
        })
      draftSetters.set(name, setter)
    }
    return setter
  }
  // Only plugins still attached count, so one that was removed cannot hold Send back.
  const draftHasContent = plugins.some((plugin) => draftStates[plugin.name]?.hasContent)
  const draftBlocked = plugins.some((plugin) => draftStates[plugin.name]?.blocked)
  const canSend = !draftBlocked && (input.trim() !== '' || draftHasContent)

  // Set while plugins prepare a draft, so a second Enter cannot send it twice.
  const sendingRef = useRef(false)
  async function send(text: string) {
    const trimmed = text.trim()
    if (busy || sendingRef.current || draftBlocked) return
    if (!trimmed && !draftHasContent) return
    sendingRef.current = true
    try {
      let draft: Draft = { text: trimmed, parts: [] }
      for (const plugin of plugins) {
        if (!plugin.beforeSend) continue
        const next = await plugin.beforeSend(draft)
        if (next === false) return
        draft = next
      }
      if (!draft.text && draft.parts.length === 0) return
      const textParts: ChatPart[] = draft.text ? [{ type: 'text', text: draft.text }] : []
      sendMessage({ role: 'user', parts: [...textParts, ...draft.parts] })
      setInput('')
      for (const plugin of plugins) plugin.afterSend?.()
    } catch (error) {
      console.error('[dopus] sending failed', error)
    } finally {
      sendingRef.current = false
    }
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

  // Open cards of the newest message. The chat continues once every one is answered.
  const openApprovals = (messages.at(-1)?.parts ?? []).flatMap((part) =>
    isToolUIPart(part) && part.state === 'approval-requested' ? [part.approval.id] : [],
  )
  const chatContext: ChatContext = {
    messages,
    labels,
    busy,
    openApprovals,
    // Answers run one after another inside useChat, so "approve all" may call this in a loop.
    respondToApproval: (id, approved) => {
      addToolApprovalResponse({ id, approved })
    },
  }

  function newChat() {
    if (busy) stop()
    clearError()
    setMessages([])
    setInput('')
    Promise.resolve(historyRef.current?.save?.([])).catch((error) =>
      console.error('[dopus] history.save failed', error),
    )
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
        {messages.map((message, index) => (
          <MessageView
            key={message.id}
            message={message}
            plugins={plugins}
            ctx={{
              ...chatContext,
              message,
              stale: index < messages.length - 1,
              waitingJobs,
            }}
          />
        ))}
        {plugins.map((plugin, index) =>
          plugin.renderFooter ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: plugins keep their order; names may repeat
            <Fragment key={`${index}-${plugin.name}`}>{plugin.renderFooter(chatContext)}</Fragment>
          ) : null,
        )}
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
        {plugins.map((plugin, index) =>
          plugin.renderComposer ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: plugins keep their order; names may repeat
            <Fragment key={`${index}-${plugin.name}`}>
              {plugin.renderComposer({ ...chatContext, setDraftState: draftSetter(plugin.name) })}
            </Fragment>
          ) : null,
        )}
        {busy ? (
          <button type="button" className="dopus-secondary" onClick={() => stop()}>
            {labels.stop}
          </button>
        ) : (
          <button type="submit" className="dopus-primary" disabled={!canSend}>
            {labels.send}
          </button>
        )}
      </form>
    </section>
  )
}
