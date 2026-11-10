import type { ReactNode } from 'react'
import { AgentWidget } from '../components/agent/agent-chat'

export const metadata = { title: 'dopus example' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AgentWidget suggestions={['Who am I?', 'List my orders', 'Cancel o-1']} />
      </body>
    </html>
  )
}
