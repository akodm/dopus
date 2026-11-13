'use server'

import { redirect } from 'next/navigation'
import { fileStore } from '@/lib/files'
import { getSession } from '@/lib/session'

/** Reads an uploaded file's details and, for text, its start. Only its owner may. */
export async function describeFile(fileId: string) {
  const session = await getSession()
  if (!session) redirect('/login')
  const file = fileStore.find(fileId)
  if (!file || file.owner !== session.user) return { ok: false, error: 'File not found.' }
  const preview = file.type.startsWith('text/')
    ? new TextDecoder().decode(file.bytes).slice(0, 200)
    : undefined
  return { ok: true, name: file.name, type: file.type, size: file.size, preview }
}
