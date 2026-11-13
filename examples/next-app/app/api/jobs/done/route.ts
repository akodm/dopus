import { timingSafeEqual } from 'node:crypto'
import { finishJob } from '@/lib/jobs'

/** The outside worker (worker/server.mjs) reports a finished job here. Only it knows the shared secret. */
export async function POST(request: Request) {
  const secret = process.env.EXAMPLE_WORKER_SECRET ?? ''
  const given = request.headers.get('x-worker-secret') ?? ''
  const ok =
    secret.length > 0 &&
    given.length === secret.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  if (!ok) return new Response('Unauthorized', { status: 401 })
  const body = (await request.json().catch(() => null)) as { id?: unknown; file?: unknown } | null
  if (typeof body?.id !== 'string' || typeof body.file !== 'string') {
    return new Response('Bad request', { status: 400 })
  }
  const job = finishJob(body.id, body.file)
  return job ? Response.json({ ok: true }) : new Response('Not found', { status: 404 })
}
