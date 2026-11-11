import { type Job, jobEvents } from '@/lib/jobs'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/** The chat's channel: Server-Sent Events carrying only the IDs of the caller's finished jobs. */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })
  const encoder = new TextEncoder()
  let stop = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const onDone = (job: Job) => {
        if (job.owner === session.user) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ jobId: job.id })}\n\n`))
        }
      }
      const ping = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 15_000)
      jobEvents.on('done', onDone)
      stop = () => {
        clearInterval(ping)
        jobEvents.off('done', onDone)
      }
      request.signal.addEventListener('abort', () => {
        stop()
        controller.close()
      })
    },
    cancel: () => stop(),
  })
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform' },
  })
}
