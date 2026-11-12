'use client'

import { useMemo } from 'react'
import { closeChat, loadChat } from '@/app/actions/chat'
import {
  type AgentChannel,
  type AgentChatHistory,
  type AgentChatProps,
  AgentWidget,
} from './agent-chat'

/** Finished background jobs arrive over SSE (app/api/jobs). With Supabase Realtime, only subscribe() changes. */
const channel: AgentChannel = {
  subscribe(finished) {
    const events = new EventSource('/api/jobs')
    events.onmessage = (event) => finished(JSON.parse(event.data).jobId)
    return () => events.close()
  },
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
  ...props
}: AgentChatProps & { user: string | null; savedOnServer?: boolean }) {
  const history = useMemo(
    () =>
      !user ? undefined : savedOnServer ? serverHistory : sessionHistory(`dopus-chat:${user}`),
    [user, savedOnServer],
  )
  return <AgentWidget {...props} channel={channel} history={history} />
}
