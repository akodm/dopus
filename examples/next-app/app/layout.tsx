import type { ReactNode } from 'react'
import { Agent } from '../components/agent/agent'

export const metadata = { title: 'dopus example' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Agent suggestions={['Who am I?', 'List my orders', 'Cancel o-1']} />
      </body>
    </html>
  )
}
