import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pollingChannel, sseChannel } from '../src/react/channels.js'

class FakeEventSource {
  static last: FakeEventSource | undefined
  onmessage: ((event: { data: string }) => void) | null = null
  closed = false
  constructor(
    public url: string,
    public init?: { withCredentials?: boolean },
  ) {
    FakeEventSource.last = this
  }
  emit(data: string) {
    this.onmessage?.({ data })
  }
  close() {
    this.closed = true
  }
}

const none = { waiting: () => [] }

describe('sseChannel', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports the job id of each message, as JSON {"jobId"} or a bare id', () => {
    const finished = vi.fn()
    const stop = sseChannel('/api/jobs').subscribe(finished, none)
    const source = FakeEventSource.last
    expect(source?.url).toBe('/api/jobs')
    source?.emit('{"jobId":"job-1"}')
    source?.emit('job-2')
    expect(finished.mock.calls).toEqual([['job-1'], ['job-2']])
    stop()
    expect(source?.closed).toBe(true)
  })

  it('ignores messages that carry no usable id', () => {
    const finished = vi.fn()
    sseChannel('/api/jobs').subscribe(finished, none)
    for (const data of ['', '{"other":1}', '{"jobId":5}', '{not json', '   '])
      FakeEventSource.last?.emit(data)
    expect(finished).not.toHaveBeenCalled()
  })

  it('passes withCredentials for a stream on another origin', () => {
    sseChannel('https://worker.example.com/events', { withCredentials: true }).subscribe(
      vi.fn(),
      none,
    )
    expect(FakeEventSource.last?.init).toEqual({ withCredentials: true })
  })
})

describe('pollingChannel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function stubFetch(finishedIds: string[]) {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ finished: finishedIds }),
    )
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('asks only while this chat waits for jobs, and only about those jobs', async () => {
    const fetch = stubFetch(['job-1'])
    let waiting: string[] = []
    const finished = vi.fn()
    const stop = pollingChannel('/api/jobs/status', { intervalMs: 1000 }).subscribe(finished, {
      waiting: () => waiting,
    })

    await vi.advanceTimersByTimeAsync(3000)
    expect(fetch).not.toHaveBeenCalled()

    waiting = ['job-1', 'job 2']
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/jobs/status?jobs=job-1%2Cjob+2')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin' })
    expect(finished).toHaveBeenCalledWith('job-1')

    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('checks once right away, so a job that finished during a reload is picked up', async () => {
    const fetch = stubFetch(['job-1'])
    const finished = vi.fn()
    pollingChannel('/api/jobs/status', { intervalMs: 60_000 }).subscribe(finished, {
      waiting: () => ['job-1'],
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(finished).toHaveBeenCalledWith('job-1')
  })

  it('keeps polling after a failed request or a bad body, and reports only string ids', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(Response.json({ finished: 'job-1' }))
      .mockResolvedValueOnce(Response.json({ finished: ['job-1', 7, null] }))
    vi.stubGlobal('fetch', fetch)
    const finished = vi.fn()
    pollingChannel('/api/jobs/status', { intervalMs: 1000 }).subscribe(finished, {
      waiting: () => ['job-1'],
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(finished.mock.calls).toEqual([['job-1']])
  })
})
