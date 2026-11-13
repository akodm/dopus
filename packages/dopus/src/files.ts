/**
 * File attachments: the chat UI uploads a file elsewhere (the app's own storage) and sends only a reference
 * on the user message. File bytes never pass through the agent route. The model gets server-written text
 * with the file's ID, and reads it with one of the app's tools, which checks the user's permissions.
 */

/** UI message part for an attached file: `{ type: 'data-dopus-file', data: { id, name, type, size } }`. */
export const FILE_PART = 'data-dopus-file'
export const MAX_FILES_PER_MESSAGE = 10

export interface AttachedFile {
  id: string
  name: string
  type: string
  size: number
}

export function isAttachedFile(data: unknown): data is AttachedFile {
  if (typeof data !== 'object' || data === null) return false
  const { id, name, type, size } = data as Record<string, unknown>
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= 200 &&
    typeof name === 'string' &&
    name.length <= 255 &&
    typeof type === 'string' &&
    type.length <= 100 &&
    typeof size === 'number' &&
    Number.isFinite(size) &&
    size >= 0
  )
}

/** Server-written text for an attached file. Control characters in the name become spaces before quoting. */
export function fileNotice(file: AttachedFile): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const name = file.name.replace(/[\u0000-\u001f\u007f]/g, ' ')
  return `The user attached a file: ${JSON.stringify(name)} (${file.type || 'unknown type'}, ${file.size} bytes), fileId ${JSON.stringify(file.id)}. Read it with a tool that takes the fileId; you cannot see its contents otherwise.`
}
