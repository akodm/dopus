import type { ReactNode } from 'react'

export const metadata = { title: 'dopus example' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
