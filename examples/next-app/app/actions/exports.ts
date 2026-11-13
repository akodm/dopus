'use server'

import { redirect } from 'next/navigation'
import { getJob, startJob } from '@/lib/jobs'
import { getSession } from '@/lib/session'

/** Starts an order export in the background and returns at once. */
export async function startExport() {
  const session = await getSession()
  if (!session) redirect('/login')
  const job = await startJob(session.user)
  return { jobId: job.id, status: job.status }
}

/** Reads an export job. Only its owner may. */
export async function getExport(jobId: string) {
  const session = await getSession()
  if (!session) redirect('/login')
  const job = getJob(jobId)
  if (!job || job.owner !== session.user) return { ok: false, error: 'Export not found.' }
  return { ok: true, status: job.status, result: job.result }
}
