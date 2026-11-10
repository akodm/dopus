import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'

const appDir = join(import.meta.dirname, '..')

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.listen(0, () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(),
      )
    })
  })
}

/**
 * Starts the production build (`next start`) with the scripted model.
 * With E2E_BASE_URL set, uses an already running server instead (e.g. the Cloudflare Workers preview).
 */
export async function startServer(env: Record<string, string>) {
  if (process.env.E2E_BASE_URL)
    return { url: process.env.E2E_BASE_URL, stop: () => {}, output: () => '' }
  if (!existsSync(join(appDir, '.next', 'BUILD_ID'))) {
    throw new Error('Build the example first: pnpm --filter next-app build')
  }
  const port = await freePort()
  const child: ChildProcess = spawn(
    join(appDir, 'node_modules', '.bin', 'next'),
    ['start', '-p', String(port)],
    {
      cwd: appDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout?.on('data', (chunk) => {
    output += chunk
  })
  child.stderr?.on('data', (chunk) => {
    output += chunk
  })
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`next start exited:\n${output}`)
    try {
      await fetch(url)
      return { url, stop: () => child.kill(), output: () => output }
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  child.kill()
  throw new Error(`next start did not become ready:\n${output}`)
}

export function user(text: string): UIMessage {
  return {
    id: `u-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

/**
 * Sends the conversation like `useChat` does. When the last message is an assistant message
 * (an approval answer), the response continues that message, so it is rebuilt on top of it.
 */
export async function chat(url: string, messages: UIMessage[], cookie?: string) {
  const response = await fetch(`${url}/api/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ messages }),
  })
  if (!response.ok)
    throw new Error(`agent route returned ${response.status}: ${await response.text()}`)
  const chunks = (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)) as UIMessageChunk)

  let assistant: UIMessage | undefined
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  const last = messages.at(-1)
  const message = last?.role === 'assistant' ? structuredClone(last) : undefined
  for await (const update of readUIMessageStream({ message, stream })) assistant = update
  if (!assistant) throw new Error('no assistant message')
  return { chunks, assistant: structuredClone(assistant) }
}

type Part = UIMessage['parts'][number]
export type ToolPart = Extract<Part, { toolCallId: string }> & {
  approval?: { id: string; approved?: boolean; signature?: string }
}

export function toolPart(message: UIMessage): ToolPart {
  const part = message.parts.find((p) => 'toolCallId' in p)
  if (!part) throw new Error(`no tool part in ${JSON.stringify(message.parts)}`)
  return part as ToolPart
}

export function text(message: UIMessage) {
  return message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
}

/** What the client sends back after the user clicks Approve / Decline. */
export function answer(message: UIMessage, approved: boolean): UIMessage {
  const copy = structuredClone(message)
  const part = toolPart(copy) as { state: string; approval: { approved?: boolean } }
  part.state = 'approval-responded'
  part.approval = { ...part.approval, approved }
  return copy
}
