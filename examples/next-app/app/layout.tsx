import type { ReactNode } from 'react'
import { chatDb } from '@/lib/chat-db'
import { getSession } from '@/lib/session'
import { Agent } from '../components/agent/agent'

export const metadata = { title: 'dopus example' }

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  return (
    <html lang="en">
      <body>
        {children}
        <Agent
          key={session?.user ?? 'anonymous'}
          user={session?.user ?? null}
          savedOnServer={Boolean(chatDb)}
          // The outside worker's event stream (worker/server.mjs), when jobs run there.
          jobEvents={process.env.EXAMPLE_JOB_EVENTS_URL}
          suggestions={['Who am I?', 'List my orders', 'Cancel o-1']}
        />
      </body>
    </html>
  )
}
