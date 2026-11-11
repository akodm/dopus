'use client'

import { type AgentChannel, type AgentChatProps, AgentWidget } from './agent-chat'

/** Finished background jobs arrive over SSE (app/api/jobs). With Supabase Realtime, only subscribe() changes. */
const channel: AgentChannel = {
  subscribe(finished) {
    const events = new EventSource('/api/jobs')
    events.onmessage = (event) => finished(JSON.parse(event.data).jobId)
    return () => events.close()
  },
}

export function Agent(props: AgentChatProps) {
  return <AgentWidget {...props} channel={channel} />
}
