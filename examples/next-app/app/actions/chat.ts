'use server'

import { chatDb } from '@/lib/chat-db'
import { getSession } from '@/lib/session'

/** The chat widget's history when it is kept in the database (lib/chat-db.ts). Saving happens in onFinish. */
export async function loadChat() {
  const session = await getSession()
  return session && chatDb ? chatDb.load(session.user) : []
}

export async function closeChat() {
  const session = await getSession()
  if (session && chatDb) await chatDb.close(session.user)
}
