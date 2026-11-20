import { isToolUIPart, type TextStreamPart, type ToolSet, type UIMessage } from 'ai'

/**
 * The AI SDK signs an approval over its id, the tool call, the tool name and the input. That signature is not tied to
 * a user and never expires, so a copied approval could be sent again later or by someone else. dopus wraps it:
 *
 *   dopus1.<expires, unix seconds>.<HMAC(secret, user id, expires, SDK signature)>.<SDK signature>
 *
 * and, before the AI SDK sees an answered card, checks the wrapper (same user, not expired) and hands the SDK its own
 * signature back. A card whose wrapper fails is closed as not run.
 */
const VERSION = 'dopus1'

/** Default lifetime of an approval card, in seconds. */
export const DEFAULT_APPROVAL_MAX_AGE = 600

/** Reason recorded for a card whose approval was given too late or for another user (the model reads it). */
export const APPROVAL_INVALID_REASON =
  'Not run: the approval expired or was given in another session. If the user still wants it, call the tool again so they can approve it.'

const encoder = new TextEncoder()

async function key(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

const payload = (userId: string, expires: number, sdkSignature: string) =>
  encoder.encode(`dopus-approval\n${userId}\n${expires}\n${sdkSignature}`)

function toBase64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(text: string): Uint8Array | undefined {
  if (!/^[\w-]*$/.test(text)) return undefined
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return undefined
  }
}

export async function wrapApprovalSignature(options: {
  secret: string
  userId: string
  sdkSignature: string
  maxAge: number
  now?: number
}): Promise<string> {
  const expires = Math.floor((options.now ?? Date.now()) / 1000) + options.maxAge
  const mac = await crypto.subtle.sign(
    'HMAC',
    await key(options.secret),
    payload(options.userId, expires, options.sdkSignature),
  )
  return `${VERSION}.${expires}.${toBase64url(new Uint8Array(mac))}.${options.sdkSignature}`
}

/** The SDK signature inside a dopus wrapper that is valid for this user now, or undefined. */
export async function unwrapApprovalSignature(options: {
  secret: string
  userId: string
  signature: string
  now?: number
}): Promise<string | undefined> {
  const [version, expiresText, macText, sdkSignature, ...rest] = options.signature.split('.')
  if (version !== VERSION || rest.length > 0 || !expiresText || !macText || !sdkSignature)
    return undefined
  if (!/^\d{1,12}$/.test(expiresText)) return undefined
  const expires = Number(expiresText)
  if (expires * 1000 < (options.now ?? Date.now())) return undefined
  const mac = fromBase64url(macText)
  if (!mac) return undefined
  const valid = await crypto.subtle.verify(
    'HMAC',
    await key(options.secret),
    mac as Uint8Array<ArrayBuffer>,
    payload(options.userId, expires, sdkSignature),
  )
  return valid ? sdkSignature : undefined
}

type Part = UIMessage['parts'][number]
type Approval = { id: string; approved?: boolean; reason?: string; signature?: string }

/**
 * Checks the wrapped signatures in incoming messages. Returns the messages to keep (an approved card of the last
 * message whose wrapper fails is closed as not run; signatures stay wrapped, as the browser has them) and the
 * messages for the model (the same, with the SDK's own signatures, which the SDK verifies next).
 */
export async function checkApprovals(
  messages: UIMessage[],
  options: { secret: string; userId: string; now?: number },
): Promise<{ messages: UIMessage[]; forModel: UIMessage[] }> {
  const last = messages.length - 1
  const kept: UIMessage[] = []
  const forModel: UIMessage[] = []
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'assistant') {
      kept.push(message)
      forModel.push(message)
      continue
    }
    const keptParts: Part[] = []
    const modelParts: Part[] = []
    for (const part of message.parts) {
      const approval = isToolUIPart(part) ? (part as { approval?: Approval }).approval : undefined
      if (!isToolUIPart(part) || !approval?.signature) {
        keptParts.push(part)
        modelParts.push(part)
        continue
      }
      const sdkSignature = await unwrapApprovalSignature({
        ...options,
        signature: approval.signature,
      })
      const willRun =
        index === last && part.state === 'approval-responded' && approval.approved === true
      if (!sdkSignature && willRun) {
        const closed = {
          ...part,
          state: 'output-denied',
          approval: { id: approval.id, approved: false, reason: APPROVAL_INVALID_REASON },
        } as Part
        keptParts.push(closed)
        modelParts.push(closed)
        continue
      }
      keptParts.push(part)
      modelParts.push(
        sdkSignature
          ? ({ ...part, approval: { ...approval, signature: sdkSignature } } as Part)
          : part,
      )
    }
    kept.push({ ...message, parts: keptParts })
    forModel.push({ ...message, parts: modelParts })
  }
  return { messages: kept, forModel }
}

/** Wraps the SDK signature of every approval request this request streams. */
export function wrapApprovalRequests<TOOLS extends ToolSet>(
  stream: ReadableStream<TextStreamPart<TOOLS>>,
  options: { secret: string; userId: string; maxAge: number },
): ReadableStream<TextStreamPart<TOOLS>> {
  return stream.pipeThrough(
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      async transform(chunk, controller) {
        const signature = (chunk as { signature?: unknown }).signature
        if (chunk.type === 'tool-approval-request' && typeof signature === 'string') {
          controller.enqueue({
            ...chunk,
            signature: await wrapApprovalSignature({ ...options, sdkSignature: signature }),
          } as TextStreamPart<TOOLS>)
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )
}
