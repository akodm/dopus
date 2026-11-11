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

export function startJob(owner: string): Job {
  const job: Job = { id: `job-${g.__jobId}`, owner, status: 'running' }
  g.__jobId = (g.__jobId ?? 0) + 1
  g.__jobs?.set(job.id, job)
  setTimeout(
    () => {
      job.status = 'done'
      job.result = { orders: store.ordersOf(owner).length, file: `/exports/${job.id}.csv` }
      jobEvents.emit('done', job)
    },
    Number(process.env.EXAMPLE_JOB_MS ?? 1500),
  )
  return job
}
