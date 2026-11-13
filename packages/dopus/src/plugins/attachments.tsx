import { type ReactNode, useEffect, useRef, useSyncExternalStore } from 'react'
import type { AgentChatLabels } from '../react/labels.js'
import {
  type ChatPart,
  type ChatPlugin,
  type ComposerContext,
  type Draft,
  FILE_PART,
  formatFileSize,
} from '../react/plugin.js'

/** What the app's upload returns. `name`, `type` and `size` default to the picked file's. */
export interface UploadResult {
  /** The app's own ID for the stored file; the model reads the file through a tool that takes it. */
  id: string
  name?: string
  type?: string
  size?: number
}

export interface AttachmentsOptions {
  /** Store the file in the app's own storage and return its ID. Abort when `signal` fires (file removed). */
  upload: (file: File, init: { signal: AbortSignal }) => Promise<UploadResult>
  /** The file input's `accept`, e.g. `'image/*,.pdf'`. */
  accept?: string
  /** Files per message (default 5; never more than 10, the server's limit). */
  maxFiles?: number
  /** Bytes per file (default 20 MB). */
  maxSize?: number
  /** Override labels for this plugin only. */
  labels?: Partial<AgentChatLabels>
}

export interface PendingFile {
  key: string
  file: File
  status: 'uploading' | 'done' | 'error'
  result?: UploadResult
  /** The label to show for an error entry. */
  error?: 'tooManyFiles' | 'fileTooLarge' | 'uploadFailed'
}

export interface AttachmentStore {
  getSnapshot: () => readonly PendingFile[]
  subscribe: (listener: () => void) => () => void
  /** Add picked files: each over the limits becomes an error entry; the rest start uploading. */
  add: (files: Iterable<File> | ArrayLike<File>) => void
  /** Remove an entry; an upload still running is aborted. */
  remove: (key: string) => void
  /** False while an upload runs; otherwise the draft with a file part per finished upload. */
  beforeSend: (draft: Draft) => Draft | false
  /** Clear the sent files and the error entries. */
  afterSend: () => void
}

const DEFAULT_MAX_FILES = 5
const DEFAULT_MAX_SIZE = 20 * 1024 * 1024
// The dopus server's limits for a file part; a message breaking one is rejected whole.
const SERVER_MAX_FILES = 10
const MAX_ID = 200
const MAX_NAME = 255
const MAX_TYPE = 100
// An extension longer than this is not kept when a name is cut.
const MAX_EXTENSION = 20

/** Cut a name to `max` characters, keeping the extension: `<start>….xlsx`. */
function truncateName(name: string, max = MAX_NAME): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 && name.length - dot <= MAX_EXTENSION ? name.slice(dot) : ''
  let start = name.slice(0, max - 1 - extension.length)
  // Do not leave half of a surrogate pair at the cut.
  if (/[\uD800-\uDBFF]$/.test(start)) start = start.slice(0, -1)
  return `${start}…${extension}`
}

const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length >= 1 && id.length <= MAX_ID

/** The store behind the plugin: the files picked for the next message. Exported for tests. */
export function createAttachmentStore(options: AttachmentsOptions): AttachmentStore {
  const { upload, maxSize = DEFAULT_MAX_SIZE } = options
  const maxFiles = Math.min(options.maxFiles ?? DEFAULT_MAX_FILES, SERVER_MAX_FILES)
  let entries: readonly PendingFile[] = []
  let nextKey = 0
  // Keys the last beforeSend put in the draft; afterSend removes only these, not files finished since.
  let sentKeys = new Set<string>()
  const controllers = new Map<string, AbortController>()
  const listeners = new Set<() => void>()

  function set(next: readonly PendingFile[]) {
    entries = next
    for (const listener of listeners) listener()
  }

  function update(key: string, change: Partial<PendingFile>) {
    if (!entries.some((entry) => entry.key === key)) return
    set(entries.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)))
  }

  function start(key: string, file: File) {
    const controller = new AbortController()
    controllers.set(key, controller)
    // The executor runs now, so upload starts synchronously and a throw becomes a rejection.
    new Promise<UploadResult>((resolve) => resolve(upload(file, { signal: controller.signal })))
      .then(
        (result) => {
          if (controller.signal.aborted) return
          if (validId(result?.id)) update(key, { status: 'done', result })
          else update(key, { status: 'error', error: 'uploadFailed' })
        },
        () => {
          if (!controller.signal.aborted) update(key, { status: 'error', error: 'uploadFailed' })
        },
      )
      .finally(() => controllers.delete(key))
  }

  return {
    getSnapshot: () => entries,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    add(files) {
      const picked = Array.from(files)
      if (picked.length === 0) return
      let count = entries.filter((entry) => entry.status !== 'error').length
      const added: PendingFile[] = []
      const toStart: PendingFile[] = []
      for (const file of picked) {
        const key = `file-${nextKey++}`
        if (file.size > maxSize) {
          added.push({ key, file, status: 'error', error: 'fileTooLarge' })
        } else if (count >= maxFiles) {
          added.push({ key, file, status: 'error', error: 'tooManyFiles' })
        } else {
          count++
          const entry: PendingFile = { key, file, status: 'uploading' }
          added.push(entry)
          toStart.push(entry)
        }
      }
      set([...entries, ...added])
      for (const entry of toStart) start(entry.key, entry.file)
    },
    remove(key) {
      controllers.get(key)?.abort()
      controllers.delete(key)
      set(entries.filter((entry) => entry.key !== key))
    },
    beforeSend(draft) {
      if (entries.some((entry) => entry.status === 'uploading')) return false
      const done = entries.filter((entry) => entry.status === 'done').slice(0, SERVER_MAX_FILES)
      sentKeys = new Set(done.map((entry) => entry.key))
      const parts = done.map(({ file, result }): ChatPart => {
        // Fall back to the picked file for anything the upload left out or got wrong.
        const { name, type, size } = result ?? {}
        return {
          type: FILE_PART,
          data: {
            id: result?.id ?? '',
            name: truncateName(typeof name === 'string' ? name : file.name),
            type: (typeof type === 'string' ? type : file.type).slice(0, MAX_TYPE),
            size: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : file.size,
          },
        }
      })
      return parts.length === 0 ? draft : { ...draft, parts: [...draft.parts, ...parts] }
    },
    afterSend() {
      const sent = sentKeys
      sentKeys = new Set()
      const next = entries.filter(
        (entry) =>
          entry.status === 'uploading' || (entry.status === 'done' && !sent.has(entry.key)),
      )
      if (next.length !== entries.length) set(next)
    },
  }
}

function AttachmentComposer({
  store,
  ctx,
  labels,
  accept,
}: {
  store: AttachmentStore
  ctx: ComposerContext
  labels: AgentChatLabels
  accept?: string
}): ReactNode {
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const inputRef = useRef<HTMLInputElement>(null)
  const doneCount = entries.filter((entry) => entry.status === 'done').length
  const uploadingCount = entries.filter((entry) => entry.status === 'uploading').length
  const { setDraftState } = ctx
  useEffect(() => {
    setDraftState({ hasContent: doneCount > 0, blocked: uploadingCount > 0 })
  }, [setDraftState, doneCount, uploadingCount])

  return (
    <>
      <button type="button" className="dopus-attach" onClick={() => inputRef.current?.click()}>
        {labels.attach}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        hidden
        onChange={(event) => {
          if (event.target.files) store.add(event.target.files)
          // Picking the same file again fires change again.
          event.target.value = ''
        }}
      />
      {entries.length > 0 && (
        <ul className="dopus-attachments">
          {entries.map((entry) => (
            <li
              key={entry.key}
              className="dopus-attachment"
              data-status={entry.status}
              title={entry.file.name}
            >
              <span>{entry.file.name}</span>{' '}
              <span>
                {entry.status === 'uploading'
                  ? labels.uploading
                  : entry.status === 'error'
                    ? labels[entry.error ?? 'uploadFailed']
                    : formatFileSize(entry.result?.size ?? entry.file.size)}
              </span>
              <button
                type="button"
                className="dopus-attachment-remove"
                aria-label={`${labels.removeFile}: ${entry.file.name}`}
                title={labels.removeFile}
                onClick={() => store.remove(entry.key)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * File attachments: an attach button and file chips in the composer. Each picked file goes to `upload` (the
 * app's own storage) right away; the message carries only a reference `{ id, name, type, size }`.
 */
export function attachments(options: AttachmentsOptions): ChatPlugin {
  const store = createAttachmentStore(options)
  return {
    name: 'attachments',
    renderComposer(ctx) {
      const labels = { ...ctx.labels, ...options.labels }
      return <AttachmentComposer store={store} ctx={ctx} labels={labels} accept={options.accept} />
    },
    beforeSend: store.beforeSend,
    afterSend: store.afterSend,
  }
}
