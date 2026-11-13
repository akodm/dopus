import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { attachments, createAttachmentStore } from '../src/plugins/attachments.js'
import { DEFAULT_LABELS } from '../src/react/labels.js'
import type { ComposerContext, Draft } from '../src/react/plugin.js'

type UploadResult = { id: string; name?: string; type?: string; size?: number }

/** An upload whose promises the test settles by hand. */
function controlledUpload() {
  const calls: {
    file: File
    signal: AbortSignal
    resolve: (result: UploadResult) => void
    reject: (error: unknown) => void
  }[] = []
  const upload = vi.fn((file: File, init: { signal: AbortSignal }) => {
    return new Promise<UploadResult>((resolve, reject) => {
      calls.push({ file, signal: init.signal, resolve, reject })
    })
  })
  return { upload, calls }
}

const file = (name = 'report.pdf', size = 3, type = 'application/pdf') =>
  new File([new Uint8Array(size)], name, { type })

const empty: Draft = { text: '', parts: [] }
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

type FileData = { id: string; name: string; type: string; size: number }
/** The file references beforeSend added; fails the test when it held the draft back. */
function sentFiles(draft: Draft | false): FileData[] {
  if (draft === false) throw new Error('beforeSend held the draft back')
  return draft.parts.map((part) => (part as { data: FileData }).data)
}

describe('createAttachmentStore', () => {
  it('sends files without text', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file('report.pdf', 3)])
    calls[0]?.resolve({ id: 'file-1' })
    await flush()

    expect(store.getSnapshot()[0]?.status).toBe('done')
    expect(store.beforeSend(empty)).toEqual({
      text: '',
      parts: [
        {
          type: 'data-dopus-file',
          data: { id: 'file-1', name: 'report.pdf', type: 'application/pdf', size: 3 },
        },
      ],
    })
  })

  it('appends file parts after the draft parts and prefers the upload result', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file('a.txt', 2, 'text/plain')])
    calls[0]?.resolve({ id: 'f', name: 'renamed.txt', type: 'text/markdown', size: 9 })
    await flush()

    const draft: Draft = { text: 'hi', parts: [{ type: 'text', text: 'other' }] }
    expect(store.beforeSend(draft)).toEqual({
      text: 'hi',
      parts: [
        { type: 'text', text: 'other' },
        {
          type: 'data-dopus-file',
          data: { id: 'f', name: 'renamed.txt', type: 'text/markdown', size: 9 },
        },
      ],
    })
  })

  it('does not send while uploading', () => {
    const { upload } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file()])
    expect(store.getSnapshot()[0]?.status).toBe('uploading')
    expect(store.beforeSend(empty)).toBe(false)
  })

  it('marks files over maxFiles as errors and never uploads them', () => {
    const { upload } = controlledUpload()
    const store = createAttachmentStore({ upload, maxFiles: 2 })
    store.add([file('1'), file('2')])
    store.add([file('3'), file('4')])

    const entries = store.getSnapshot()
    expect(entries.map((entry) => entry.status)).toEqual([
      'uploading',
      'uploading',
      'error',
      'error',
    ])
    expect(entries[2]?.error).toBe('tooManyFiles')
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('marks files over maxSize as errors and never uploads them', () => {
    const { upload } = controlledUpload()
    const store = createAttachmentStore({ upload, maxSize: 10 })
    store.add([file('big', 11), file('ok', 10)])

    const entries = store.getSnapshot()
    expect(entries.map((entry) => entry.status)).toEqual(['error', 'uploading'])
    expect(entries[0]?.error).toBe('fileTooLarge')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0]?.[0].name).toBe('ok')
  })

  it('defaults to 5 files and 20 MB', () => {
    const { upload } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file('huge', 20 * 1024 * 1024 + 1)])
    store.add(Array.from({ length: 6 }, (_, i) => file(String(i))))

    const errors = store.getSnapshot().map((entry) => entry.error)
    expect(errors).toEqual([
      'fileTooLarge',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'tooManyFiles',
    ])
    expect(upload).toHaveBeenCalledTimes(5)
  })

  it('never sends more than 10 files, whatever maxFiles says', () => {
    const { upload } = controlledUpload()
    const store = createAttachmentStore({ upload, maxFiles: 50 })
    store.add(Array.from({ length: 12 }, (_, i) => file(String(i))))

    const entries = store.getSnapshot()
    expect(entries.filter((entry) => entry.status === 'uploading')).toHaveLength(10)
    expect(entries.filter((entry) => entry.error === 'tooManyFiles')).toHaveLength(2)
    expect(upload).toHaveBeenCalledTimes(10)
  })

  it('aborts the upload when an uploading file is removed', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file()])
    const key = store.getSnapshot()[0]?.key ?? ''
    const signal = calls[0]?.signal

    store.remove(key)
    expect(signal?.aborted).toBe(true)
    expect(store.getSnapshot()).toEqual([])

    // A late result for the removed file changes nothing.
    calls[0]?.resolve({ id: 'late' })
    await flush()
    expect(store.getSnapshot()).toEqual([])
  })

  it('a rejected upload becomes an error entry and is not sent', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file('bad'), file('good')])
    calls[0]?.reject(new Error('network'))
    calls[1]?.resolve({ id: 'good-id' })
    await flush()

    const entries = store.getSnapshot()
    expect(entries[0]).toMatchObject({ status: 'error', error: 'uploadFailed' })
    expect(sentFiles(store.beforeSend(empty)).map((data) => data.id)).toEqual(['good-id'])
  })

  it('treats an upload result the server would reject as a failed upload', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file('a'), file('b')])
    calls[0]?.resolve({ id: '' })
    calls[1]?.resolve({ id: 'x'.repeat(201) })
    await flush()

    expect(store.getSnapshot().map((entry) => entry.error)).toEqual([
      'uploadFailed',
      'uploadFailed',
    ])
  })

  it('afterSend empties the store', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload, maxSize: 5 })
    store.add([file('ok', 1), file('big', 6)])
    calls[0]?.resolve({ id: 'f' })
    await flush()

    store.beforeSend(empty)
    store.afterSend()
    expect(store.getSnapshot()).toEqual([])
  })

  it('afterSend keeps a file that finished after the draft was taken', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file('first')])
    calls[0]?.resolve({ id: 'first' })
    await flush()

    store.beforeSend(empty)
    // Another plugin's beforeSend is still waiting; a new file is picked and finishes meanwhile.
    store.add([file('second')])
    calls[1]?.resolve({ id: 'second' })
    await flush()
    store.afterSend()

    expect(store.getSnapshot().map((entry) => entry.file.name)).toEqual(['second'])
  })

  it('truncates a long name to 255 characters, keeping the extension', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file(`${'a'.repeat(300)}.xlsx`)])
    calls[0]?.resolve({ id: 'f' })
    await flush()

    const name = sentFiles(store.beforeSend(empty))[0]?.name ?? ''
    expect(name).toHaveLength(255)
    expect(name.endsWith('….xlsx')).toBe(true)
    expect(name.startsWith('aaaa')).toBe(true)
  })

  it('truncates a long name without an extension and a long upload-result name', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file('b'.repeat(400)), file('short.txt')])
    calls[0]?.resolve({ id: 'f1' })
    calls[1]?.resolve({ id: 'f2', name: `${'c'.repeat(260)}.${'e'.repeat(40)}` })
    await flush()

    const names = sentFiles(store.beforeSend(empty)).map((data) => data.name)
    expect(names[0]).toHaveLength(255)
    expect(names[0]?.endsWith('…')).toBe(true)
    expect(names[1]?.length).toBeLessThanOrEqual(255)
  })

  it('clamps a long type to 100 characters', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload })
    store.add([file('a.bin', 1, `application/${'x'.repeat(200)}`)])
    calls[0]?.resolve({ id: 'f' })
    await flush()

    const type = sentFiles(store.beforeSend(empty))[0]?.type ?? ''
    expect(type).toHaveLength(100)
    expect(type.startsWith('application/x')).toBe(true)
  })

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { upload, calls } = controlledUpload()
    const store = createAttachmentStore({ upload })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.add([file()])
    expect(listener).toHaveBeenCalledTimes(1)
    calls[0]?.resolve({ id: 'f' })
    await flush()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    store.afterSend()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('attachments plugin', () => {
  const ctx: ComposerContext = {
    messages: [],
    labels: DEFAULT_LABELS,
    busy: false,
    openApprovals: [],
    respondToApproval: () => {},
    setDraftState: () => {},
  }

  it('renders the attach button and a hidden file input, no chips when empty', () => {
    const plugin = attachments({ upload: async () => ({ id: 'f' }), accept: 'image/*' })
    expect(plugin.name).toBe('attachments')
    const html = renderToStaticMarkup(createElement('div', null, plugin.renderComposer?.(ctx)))
    expect(html).toContain('class="dopus-attach"')
    expect(html).toContain('>Attach file</button>')
    expect(html).toMatch(
      /<input[^>]*type="file"[^>]*multiple=""[^>]*accept="image\/\*"[^>]*hidden=""/,
    )
    expect(html).not.toContain('dopus-attachments')
  })

  it('uses its own labels over the chat labels', () => {
    const plugin = attachments({ upload: async () => ({ id: 'f' }), labels: { attach: 'Add' } })
    const html = renderToStaticMarkup(createElement('div', null, plugin.renderComposer?.(ctx)))
    expect(html).toContain('>Add</button>')
  })
})
