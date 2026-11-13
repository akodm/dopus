// A stand-in for an outside worker (a queue consumer, a Lambda, another service) running as its own server.
// The app hands it a job (POST /jobs). When the work is done it reports the result back to the app
// (POST <APP_URL>/api/jobs/done, with a shared secret), then rings the browser's doorbell over its own
// Server-Sent Events stream (GET /events?user=<id>): only the job ID, never the result.
//
//   WORKER_PORT=3490 APP_URL=http://127.0.0.1:3491 EXAMPLE_WORKER_SECRET=... node worker/server.mjs
import { createServer } from 'node:http'

const port = Number(process.env.WORKER_PORT ?? 3490)
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:3000'
const secret = process.env.EXAMPLE_WORKER_SECRET ?? ''
const jobMs = Number(process.env.WORKER_JOB_MS ?? 2000)

/** user → open SSE responses. A doorbell, not a mailbox: anyone may listen; they only learn job IDs. */
const listeners = new Map()

function ring(user, jobId) {
  for (const res of listeners.get(user) ?? []) res.write(`data: ${JSON.stringify({ jobId })}\n\n`)
}

async function work(job) {
  await new Promise((resolve) => setTimeout(resolve, jobMs))
  const done = await fetch(`${appUrl}/api/jobs/done`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-worker-secret': secret },
    body: JSON.stringify({ id: job.id, file: `/exports/${job.id}.csv` }),
  })
  if (!done.ok) {
    console.error(`[worker] the app refused job ${job.id}: ${done.status}`)
    return
  }
  ring(job.owner, job.id)
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  if (req.method === 'GET' && url.pathname === '/health') {
    res.end('ok')
    return
  }
  if (req.method === 'POST' && url.pathname === '/jobs') {
    if (!secret || req.headers['x-worker-secret'] !== secret) {
      res.writeHead(401).end()
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    const job = JSON.parse(body)
    res.writeHead(202).end()
    work(job).catch((error) => console.error('[worker]', error))
    return
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    const user = url.searchParams.get('user') ?? ''
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'access-control-allow-origin': '*',
    })
    res.write(': connected\n\n')
    const set = listeners.get(user) ?? new Set()
    set.add(res)
    listeners.set(user, set)
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
    req.on('close', () => {
      clearInterval(ping)
      set.delete(res)
    })
    return
  }
  res.writeHead(404).end()
}).listen(port, '127.0.0.1', () => console.log(`[worker] listening on ${port}`))
