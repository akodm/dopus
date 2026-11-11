'use client'

import { useMemo } from 'react'
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

export function Agent({ user, ...props }: AgentChatProps & { user: string | null }) {
  const history = useMemo(() => (user ? sessionHistory(`dopus-chat:${user}`) : undefined), [user])
  return <AgentWidget {...props} channel={channel} history={history} />
}
