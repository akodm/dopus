/**
 * Live smoke test against the real model in agent.config.ts. Costs a few cents; not part of CI.
 *
 *   1. Put ANTHROPIC_API_KEY=... in examples/next-app/.env.local (`next start` loads it; this script never reads it).
 *   2. pnpm build && pnpm example:build
 *   3. pnpm example:live
 *
 * Model output varies between runs, so each check prints PASS/FAIL instead of stopping at the first failure.
 */
import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import { answer, chat, startServer, text, user } from './server.ts'

const ALICE = 'session=alice'

type Tool = { name: string; state: string; input?: unknown; output?: unknown; errorText?: string }

function tools(message: UIMessage): Tool[] {
  return message.parts.filter(isToolUIPart).map((part) => ({
    name: getToolName(part),
    state: part.state,
    input: 'input' in part ? part.input : undefined,
    output: 'output' in part ? part.output : undefined,
    errorText: 'errorText' in part ? part.errorText : undefined,
  }))
}

const results: { name: string; ok: boolean }[] = []
function check(name: string, ok: boolean) {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

function show(message: UIMessage) {
  for (const tool of tools(message)) {
    console.log(`  tool ${tool.name} [${tool.state}] input=${JSON.stringify(tool.input)}`)
    if (tool.output !== undefined) console.log(`       output=${JSON.stringify(tool.output)}`)
    if (tool.errorText) console.log(`       error=${tool.errorText}`)
  }
  console.log(`  text: ${text(message).trim().replace(/\n+/g, ' / ') || '(none)'}`)
}

const redact = (s: string) => s.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…')

if (process.env.DOPUS_MOCK_MODEL === '1')
  throw new Error('Unset DOPUS_MOCK_MODEL for the live test.')
const server = await startServer({})

async function step(title: string, run: () => Promise<void>) {
  console.log(`\n▶ ${title}`)
  try {
    await run()
  } catch (error) {
    check(`${title}: request failed (${redact(String(error))})`, false)
  }
}

try {
  await step('who am I (alice)', async () => {
    const { assistant } = await chat(server.url, [user('Who am I signed in as?')], ALICE)
    show(assistant)
    const call = tools(assistant).find((t) => t.name === 'getCurrentUser')
    check('calls getCurrentUser', call?.state === 'output-available')
    check('answer names alice', /alice/i.test(text(assistant)))
  })

  await step('orders in Korean (locale ko-KR)', async () => {
    const { assistant } = await chat(server.url, [user('내 주문 목록 보여줘')], ALICE, {
      locale: 'ko-KR',
    })
    show(assistant)
    check(
      'calls listMyOrders',
      tools(assistant).some((t) => t.name === 'listMyOrders' && t.state === 'output-available'),
    )
    check('replies in Korean', /[가-힣]/.test(text(assistant)))
  })

  await step('cancel by description, then approve', async () => {
    const first = user('Please cancel my keyboard order.')
    const asked = await chat(server.url, [first], ALICE)
    show(asked.assistant)
    const pending = tools(asked.assistant).find((t) => t.name === 'cancelOrder')
    check('asks for approval before cancelling', pending?.state === 'approval-requested')
    check(
      'picked order o-1',
      (pending?.input as { orderId?: string } | undefined)?.orderId === 'o-1',
    )
    if (pending?.state !== 'approval-requested') return

    const done = await chat(server.url, [first, answer(asked.assistant, true)], ALICE)
    show(done.assistant)
    const ran = tools(done.assistant).find((t) => t.name === 'cancelOrder')
    check('runs after approval', (ran?.output as { ok?: boolean } | undefined)?.ok === true)
    check('confirms in text', text(done.assistant).trim().length > 0)
  })

  await step("someone else's order (o-3), approve anyway", async () => {
    const first = user('Cancel order o-3.')
    const asked = await chat(server.url, [first], ALICE)
    show(asked.assistant)
    const pending = tools(asked.assistant).find(
      (t) => t.name === 'cancelOrder' && t.state === 'approval-requested',
    )
    if (!pending) {
      check('declined without cancelling (no cancel call)', true)
      return
    }
    const done = await chat(server.url, [first, answer(asked.assistant, true)], ALICE)
    show(done.assistant)
    const ran = tools(done.assistant).find((t) => t.name === 'cancelOrder')
    check("app's own check refuses it", (ran?.output as { ok?: boolean } | undefined)?.ok === false)
  })

  await step('anonymous user asks for orders', async () => {
    const { assistant } = await chat(server.url, [user('Show my orders.')])
    show(assistant)
    check(
      'member tools are not offered (no listMyOrders call)',
      !tools(assistant).some((t) => t.name === 'listMyOrders'),
    )
    check('tells the user to sign in', /sign|log ?in|\/login/i.test(text(assistant)))
  })
} finally {
  server.stop()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log(`\nServer output:\n${redact(server.output()).slice(-4000)}`)
  process.exitCode = 1
}
