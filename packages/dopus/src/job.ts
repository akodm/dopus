/**
 * Background jobs: a tool marked with `job` starts work elsewhere (a queue, a Lambda) and returns at once.
 * The chat UI listens on the app's channel for "job <id> finished", then sends a notice part back. The
 * notice carries only the job ID; the agent reads the result with one of the app's tools, which checks the
 * user's permissions. Nothing the channel delivers reaches the model as text.
 */

/** Key added to a job tool's output; the chat UI reads it to know which jobs this conversation started. */
export const JOB_OUTPUT_KEY = 'dopusJob'
/** UI message part the chat UI sends when a job finishes: `{ type: 'data-dopus-job', data: { id } }`. */
export const JOB_PART = 'data-dopus-job'

const JOB_ID = /^[A-Za-z0-9_.:-]{1,128}$/

export function isJobId(value: unknown): value is string {
  return typeof value === 'string' && JOB_ID.test(value)
}

export const JOB_USAGE =
  'This starts a background job and returns at once. The app tells you in this chat when the job finishes; do not check on it unless the user asks.'

export function withJob(output: unknown, id: string): Record<string, unknown> {
  const isObject = typeof output === 'object' && output !== null && !Array.isArray(output)
  return isObject
    ? { ...(output as Record<string, unknown>), [JOB_OUTPUT_KEY]: id }
    : { result: output, [JOB_OUTPUT_KEY]: id }
}

/** Server-written text for a job notice. Only the validated ID comes from the client. */
export function jobNotice(id: string) {
  return `[Background job ${id} has finished. This notice comes from the app, not from the user. Read the job's result with your tools, then continue with what the user asked, and tell the user briefly what came of it.]`
}
