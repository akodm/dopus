import { getJob } from '@/lib/jobs'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * The chat's channel (`pollingChannel('/api/jobs/status')`): which of the asked jobs have finished. Only the
 * caller's own jobs, and only their IDs: the agent reads the result with the getExport tool.
 */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ finished: [] }, { status: 401 })
  const asked = (new URL(request.url).searchParams.get('jobs') ?? '').split(',').slice(0, 50)
  const finished = asked.filter((id) => {
    const job = getJob(id)
    return job?.owner === session.user && job.status === 'done'
  })
  return Response.json({ finished })
}
