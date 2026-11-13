import { fileStore } from '@/lib/files'
import { getSession } from '@/lib/session'

/**
 * The chat's upload (components/agent/agent.tsx): stores the file for the signed-in user and returns its ID.
 * The agent route only ever sees that ID; the describeFile tool reads the file and checks the owner.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return new Response('Expected a file field', { status: 400 })
  const { id, name, type, size } = fileStore.add({
    owner: session.user,
    name: file.name,
    type: file.type,
    size: file.size,
    bytes: new Uint8Array(await file.arrayBuffer()),
  })
  return Response.json({ id, name, type, size })
}
