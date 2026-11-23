import type { AgentChannel } from './chat.js'

/**
 * Ready-made channels for `<AgentChat channel={...} />`. A channel only rings a doorbell: it reports the ID of a job
 * that finished, and the agent reads the result with your own tool, which checks the user's permissions. So the
 * endpoints behind these channels may return job IDs only, never results.
 */

/** A job ID from a message: `{"jobId":"job-7"}` or the bare ID `job-7`. */
function jobIdOf(data: string): string | undefined {
  const text = data.trim()
  if (!text) return undefined
  if (text.startsWith('{')) {
    try {
      const id = (JSON.parse(text) as { jobId?: unknown }).jobId
      return typeof id === 'string' && id ? id : undefined
    } catch {
      return undefined
    }
  }
  return text
}

/**
 * Server-Sent Events: the app (or a worker) sends one message per finished job of the signed-in user, with the data
 * `{"jobId":"job-7"}` or just `job-7`. The browser reconnects by itself; a job that finishes while the stream is down
 * or the page is reloading is missed, so pair it with `pollingChannel` if that matters.
 */
export function sseChannel(url: string, options: { withCredentials?: boolean } = {}): AgentChannel {
  return {
    subscribe(finished) {
      const events = new EventSource(
        url,
        options.withCredentials ? { withCredentials: true } : undefined,
      )
      events.onmessage = (event) => {
        const id = jobIdOf(String(event.data))
        if (id) finished(id)
      }
      return () => events.close()
    },
  }
}

/**
 * Polling: while this chat waits for jobs, asks `GET <url>?jobs=job-7,job-8` every `intervalMs` (default 5000), and
 * once right away, so a job that finished while the page was reloading is picked up too. The endpoint answers
 * `{ "finished": ["job-7"] }` with the jobs among those that have finished. Nothing is requested while no job is
 * waiting. Same-origin cookies are sent; check that the jobs belong to the caller, as for any route.
 */
export function pollingChannel(url: string, options: { intervalMs?: number } = {}): AgentChannel {
  const intervalMs =
    options.intervalMs !== undefined &&
    Number.isFinite(options.intervalMs) &&
    options.intervalMs > 0
      ? options.intervalMs
      : 5000
  return {
    subscribe(finished, { waiting }) {
      let stopped = false
      let busy = false
      const poll = async () => {
        const ids = waiting()
        if (stopped || busy || ids.length === 0) return
        busy = true
        try {
          const target = new URL(url, globalThis.location?.href ?? 'http://localhost')
          target.searchParams.set('jobs', ids.join(','))
          const href = /^[a-z]+:/i.test(url) ? target.href : `${target.pathname}${target.search}`
          const response = await fetch(href, { credentials: 'same-origin', cache: 'no-store' })
          if (!response.ok) return
          const body = (await response.json()) as { finished?: unknown }
          if (stopped || !Array.isArray(body.finished)) return
          for (const id of body.finished) if (typeof id === 'string' && id) finished(id)
        } catch {
          // Offline or a bad answer: try again on the next tick.
        } finally {
          busy = false
        }
      }
      const timer = setInterval(poll, intervalMs)
      void poll()
      return () => {
        stopped = true
        clearInterval(timer)
      }
    },
  }
}
