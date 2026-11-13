/**
 * Stand-in for slow work outside the request (a queue worker, a Lambda). An export finishes after
 * EXAMPLE_JOB_MS (default 1500 ms), stores its result and announces "job <id> finished" to its owner.
 * A real app would write the result to its DB and publish on Supabase Realtime, a WebSocket, Redis...
 */
import { EventEmitter } from 'node:events'
import { store } from './store'

export interface Job {
  id: string
  owner: string
  status: 'running' | 'done'
  result?: { orders: number; file: string }
}

const g = globalThis as unknown as {
  __jobs?: Map<string, Job>
  __jobEvents?: EventEmitter
  __jobId?: number
}
g.__jobs ??= new Map()
g.__jobEvents ??= new EventEmitter().setMaxListeners(0)
g.__jobId ??= 1

export const jobEvents = g.__jobEvents
export const getJob = (id: string) => g.__jobs?.get(id)

/** Records a finished job and tells this app's own channel (app/api/jobs). */
export function finishJob(id: string, file: string): Job | undefined {
  const job = getJob(id)
  if (!job || job.status === 'done') return job
  job.status = 'done'
  job.result = { orders: store.ordersOf(job.owner).length, file }
  jobEvents.emit('done', job)
  return job
}

/**
 * With EXAMPLE_JOB_WORKER_URL the work goes to a separate worker server (worker/server.mjs), which reports back
 * through app/api/jobs/done and rings the browser on its own channel. Otherwise a timer stands in for it.
 */
export async function startJob(owner: string): Promise<Job> {
  const job: Job = { id: `job-${g.__jobId}`, owner, status: 'running' }
  g.__jobId = (g.__jobId ?? 0) + 1
  g.__jobs?.set(job.id, job)
  const worker = process.env.EXAMPLE_JOB_WORKER_URL
  if (worker) {
    const res = await fetch(`${worker}/jobs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': process.env.EXAMPLE_WORKER_SECRET ?? '',
      },
      body: JSON.stringify({ id: job.id, owner }),
    })
    if (!res.ok) throw new Error(`The worker refused the job (${res.status}).`)
  } else {
    setTimeout(
      () => finishJob(job.id, `/exports/${job.id}.csv`),
      Number(process.env.EXAMPLE_JOB_MS ?? 1500),
    )
  }
  return job
}
