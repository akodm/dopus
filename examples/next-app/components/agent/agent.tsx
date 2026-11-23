'use client'

import { approvals, attachments, toolLog } from 'dopus/plugins'
import { pollingChannel, sseChannel } from 'dopus/react'
import { useMemo, useState } from 'react'
import { closeChat, loadChat } from '@/app/actions/chat'
import { type AgentChatHistory, type AgentChatProps, AgentWidget } from './agent-chat'

/**
 * Finished background jobs: the app's own jobs by polling app/api/jobs/status (a job that finished during a reload is
 * still picked up), or the outside worker's Server-Sent Events when the layout passes `jobEvents` (worker/server.mjs).
 * With Supabase Realtime, write a channel whose subscribe() calls finished(jobId).
 */
const appChannel = pollingChannel('/api/jobs/status', { intervalMs: 1000 })

/** The app's own storage for attached files (app/api/files); the message carries only the returned ID. */
async function upload(file: File, { signal }: { signal: AbortSignal }) {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch('/api/files', { method: 'POST', body, signal })
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
  return response.json()
}

/**
 * The conversation survives reloads in this tab. Keyed by user, so after a sign-out another user in the same tab
 * does not see it. To keep it in your database instead, save it in the agent's onFinish and load it here.
 */
const sessionHistory = (key: string): AgentChatHistory => ({
  load: () => JSON.parse(sessionStorage.getItem(key) ?? '[]'),
  save: (messages) => sessionStorage.setItem(key, JSON.stringify(messages)),
})

/** In the database (DATABASE_URL): the agent's onFinish saves, this loads, and "New chat" closes the conversation. */
const serverHistory: AgentChatHistory = {
  load: () => loadChat(),
  save: (messages) => (messages.length === 0 ? closeChat() : undefined),
}

export function Agent({
  user,
  savedOnServer,
  jobEvents,
  ...props
}: AgentChatProps & { user: string | null; savedOnServer?: boolean; jobEvents?: string }) {
  const channel = useMemo(
    () =>
      jobEvents && user ? sseChannel(`${jobEvents}?user=${encodeURIComponent(user)}`) : appChannel,
    [jobEvents, user],
  )
  const history = useMemo(
    () =>
      !user ? undefined : savedOnServer ? serverHistory : sessionHistory(`dopus-chat:${user}`),
    [user, savedOnServer],
  )
  // The template's plugins (agent-chat.tsx) plus attachments, which need the app's upload. Passing `plugins` here
  // replaces the template's list, so agent-chat.tsx stays identical to what `dopus init` copies. Created once per
  // mount (lazy useState), not at module scope: the layout remounts Agent per user (`key`), so files picked but not
  // sent stay with that user.
  // approveAll: this demo lets several open cards be answered at once (off by default).
  const [plugins] = useState(() => [
    toolLog(),
    approvals({ approveAll: true }),
    attachments({ upload }),
  ])
  return <AgentWidget {...props} plugins={plugins} channel={channel} history={history} />
}
