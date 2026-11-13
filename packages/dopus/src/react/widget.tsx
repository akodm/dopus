import { useState } from 'react'
import { AgentChat, type AgentChatProps } from './chat.js'
import { DEFAULT_LABELS } from './labels.js'

/** Floating button that opens the chat in a panel. Put it once in your root layout. */
export function AgentWidget(props: AgentChatProps) {
  const [open, setOpen] = useState(false)
  // A reply finished while the panel was closed, e.g. the agent continuing after a background job.
  const [unread, setUnread] = useState(false)
  const labels = { ...DEFAULT_LABELS, ...props.labels }
  return (
    <div className="dopus-widget">
      {/* Hidden rather than unmounted, so closing the panel keeps the conversation. */}
      <div hidden={!open}>
        <AgentChat
          {...props}
          className="dopus-panel"
          onReply={() => {
            if (!open) setUnread(true)
            props.onReply?.()
          }}
        />
      </div>
      <button
        type="button"
        className="dopus-launcher"
        aria-expanded={open}
        aria-label={
          open ? labels.close : unread ? `${labels.open} (${labels.unread})` : labels.open
        }
        data-unread={!open && unread ? '' : undefined}
        onClick={() => {
          setOpen((value) => !value)
          setUnread(false)
        }}
      >
        {open ? '×' : '✦'}
      </button>
    </div>
  )
}
