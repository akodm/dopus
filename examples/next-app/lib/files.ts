/** In-memory uploads for the example (app/api/files). Resets when the server restarts. A real app uses its storage. */
export interface StoredFile {
  id: string
  owner: string
  name: string
  type: string
  size: number
  bytes: Uint8Array
}

// On globalThis, like lib/store.ts: the upload route and the agent route may load this module separately.
const g = globalThis as unknown as { __files?: Map<string, StoredFile> }
g.__files ??= new Map()
const files = g.__files

export const fileStore = {
  add: (file: Omit<StoredFile, 'id'>): StoredFile => {
    const stored = { ...file, id: `f-${crypto.randomUUID()}` }
    files.set(stored.id, stored)
    return stored
  },
  find: (id: string) => files.get(id),
}
