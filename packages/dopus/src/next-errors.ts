/**
 * An error whose message is safe to show to the model (and, through it, the user).
 * Any other error thrown by a tool is reported via `onError` and replaced with a generic message,
 * so database errors or stack details never reach the model.
 */
export class ToolError extends Error {
  override name = 'ToolError'
}

/**
 * Next.js control-flow errors (`redirect()`, `notFound()`, `forbidden()`, `unauthorized()`)
 * carry a `digest`. Inside a tool they cannot do what they would do in a page, so translate
 * them into errors the model can explain to the user.
 */
export function translateNextError(error: unknown): unknown {
  const digest = (error as { digest?: unknown } | null)?.digest
  if (typeof digest !== 'string') return error

  if (digest.startsWith('NEXT_REDIRECT')) {
    const url = digest.split(';')[2]
    return new ToolError(
      `The action tried to redirect${url ? ` to ${url}` : ''}. The user may need to sign in or open that page.`,
    )
  }
  if (digest.startsWith('NEXT_HTTP_ERROR_FALLBACK')) {
    const status = Number(digest.split(';')[1])
    if (status === 401) return new ToolError('The user is not signed in.')
    if (status === 403) return new ToolError('The user is not allowed to do this.')
    if (status === 404) return new ToolError('Not found.')
    return new ToolError(`The action failed with status ${status}.`)
  }
  return error
}
