#!/usr/bin/env node
// Builds examples/next-app with OpenNext (`aws-lambda-streaming`, as written by `dopus infra aws`) and invokes the
// resulting Lambda handler with Function URL events through a minimal stand-in for the Lambda streaming runtime.
// Checks that the response streams and that tools still read the caller's session cookie. Nothing is deployed.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'

const app = join(import.meta.dirname, '..', 'examples', 'next-app')
if (!process.argv.includes('--no-build')) {
  execFileSync(join(app, 'node_modules', '.bin', 'open-next'), ['build'], {
    cwd: app,
    stdio: 'inherit',
  })
}

process.env.DOPUS_MOCK_MODEL = '1'
process.env.DOPUS_APPROVAL_SECRET = 'lambda-emu-secret-0123456789abcdef'
globalThis.awslambda = { streamifyResponse: (fn) => fn }

process.chdir(join(app, '.open-next', 'server-functions', 'default'))
const { handler } = await import(pathToFileURL(join(process.cwd(), 'index.mjs')).href)

async function invoke(path, cookie, body) {
  // Lambda http-integration framing: JSON prelude, 8 NUL bytes, then the body.
  let prelude = ''
  let inBody = false
  const writes = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const buf = Buffer.from(chunk)
      if (inBody) writes.push(buf.toString())
      else if (buf.length === 8 && buf.every((b) => b === 0)) inBody = true
      else prelude += buf.toString()
      callback()
    },
  })
  stream.setContentType = () => {}
  const finished = new Promise((resolve) => stream.on('finish', resolve))
  const host = 'example.lambda-url.us-east-1.on.aws'
  await handler(
    {
      version: '2.0',
      routeKey: '$default',
      rawPath: path,
      rawQueryString: '',
      cookies: cookie ? [cookie] : undefined,
      headers: { 'content-type': 'application/json', host, 'x-forwarded-proto': 'https' },
      requestContext: {
        domainName: host,
        http: {
          method: 'POST',
          path,
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'lambda-emu',
        },
        requestId: crypto.randomUUID(),
        timeEpoch: Date.now(),
      },
      body: JSON.stringify(body),
      isBase64Encoded: false,
    },
    stream,
    { getRemainingTimeInMillis: () => 60_000, awsRequestId: 'emu', functionName: 'emu' },
  )
  await finished
  return { status: JSON.parse(prelude).statusCode, writes }
}

const user = (text) => ({ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] })
let failed = false
for (const [cookie, expected] of [
  ['session=alice', { signedIn: true, user: 'alice' }],
  ['session=bob', { signedIn: true, user: 'bob' }],
  [undefined, { signedIn: false }],
]) {
  const { status, writes } = await invoke('/api/agent', cookie, { messages: [user('who am I?')] })
  const line = writes
    .join('')
    .split('\n')
    .find((l) => l.includes('"tool-output-available"'))
  const output = line ? JSON.parse(line.slice(6)).output : undefined
  const ok =
    status === 200 && writes.length > 3 && JSON.stringify(output) === JSON.stringify(expected)
  failed ||= !ok
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${cookie ?? '(no cookie)'} → status ${status}, ${writes.length} writes, ${JSON.stringify(output)}`,
  )
}
if (failed) process.exit(1)
console.log('lambda-emu: OK')
