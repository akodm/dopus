import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { answer, chat, startServer, text, toolPart, user } from './server'

const ALICE = 'session=alice'
const BOB = 'session=bob'

let server: Awaited<ReturnType<typeof startServer>>

beforeAll(async () => {
  server = await startServer({
    DOPUS_MOCK_MODEL: '1',
    DOPUS_APPROVAL_SECRET: 'e2e-approval-secret-0123456789abcdef',
  })
})

afterAll(() => server?.stop())

describe('tools inherit the requesting user (next start)', () => {
  it('a server action called as a tool reads the caller’s session cookie', async () => {
    const alice = await chat(server.url, [user('who am I?')], ALICE)
    expect(toolPart(alice.assistant)).toMatchObject({
      state: 'output-available',
      output: { signedIn: true, user: 'alice' },
    })

    const bob = await chat(server.url, [user('who am I?')], BOB)
    expect(toolPart(bob.assistant)).toMatchObject({ output: { signedIn: true, user: 'bob' } })

    const anonymous = await chat(server.url, [user('who am I?')])
    expect(toolPart(anonymous.assistant)).toMatchObject({ output: { signedIn: false } })
  })

  it('only returns the caller’s own data', async () => {
    const { assistant } = await chat(server.url, [user('list my orders')], ALICE)
    const orders = toolPart(assistant).output as { id: string; owner: string }[]
    expect(orders.map((o) => o.id)).toEqual(['o-1', 'o-2'])
    expect(orders.every((o) => o.owner === 'alice')).toBe(true)
  })

  it('turns redirect("/login") for anonymous users into a message for the model', async () => {
    const { assistant } = await chat(server.url, [user('list my orders')])
    expect(toolPart(assistant)).toMatchObject({
      state: 'output-error',
      errorText: expect.stringContaining('/login'),
    })
    expect(text(assistant)).toContain('/login')
  })
})

describe('confirm flow', () => {
  it('waits for approval, then runs the write as the caller', async () => {
    const first = user('cancel o-1')
    const asked = await chat(server.url, [first], ALICE)
    expect(toolPart(asked.assistant).state).toBe('approval-requested')

    // nothing has changed yet
    const before = await chat(server.url, [user('list my orders')], ALICE)
    expect(toolPart(before.assistant).output).toContainEqual(
      expect.objectContaining({ id: 'o-1', status: 'open' }),
    )

    const done = await chat(server.url, [first, answer(asked.assistant, true)], ALICE)
    expect(toolPart(done.assistant)).toMatchObject({
      state: 'output-available',
      output: { ok: true, order: { id: 'o-1', status: 'cancelled', owner: 'alice' } },
    })
  })

  it('the app’s own permission check still applies after approval', async () => {
    const first = user('cancel o-3') // bob's order
    const asked = await chat(server.url, [first], ALICE)
    const done = await chat(server.url, [first, answer(asked.assistant, true)], ALICE)
    expect(toolPart(done.assistant).output).toEqual({ ok: false, error: 'Order not found.' })

    const bobs = await chat(server.url, [user('list my orders')], BOB)
    expect(toolPart(bobs.assistant).output).toContainEqual(
      expect.objectContaining({ id: 'o-3', status: 'open' }),
    )
  })

  it('declining does not run the tool', async () => {
    const first = user('cancel o-3')
    const asked = await chat(server.url, [first], BOB)
    const done = await chat(server.url, [first, answer(asked.assistant, false)], BOB)
    expect(toolPart(done.assistant).state).toBe('output-denied')

    const bobs = await chat(server.url, [user('list my orders')], BOB)
    expect(toolPart(bobs.assistant).output).toContainEqual(
      expect.objectContaining({ id: 'o-3', status: 'open' }),
    )
  })

  it('rejects an approval whose signature was tampered with', async () => {
    const first = user('cancel o-3')
    const asked = await chat(server.url, [first], BOB)
    const forged = answer(asked.assistant, true)
    const part = toolPart(forged)
    if (part.approval) part.approval.signature = 'forged'

    const done = await chat(server.url, [first, forged], BOB)
    expect(done.chunks).toContainEqual(expect.objectContaining({ type: 'error' }))
    expect(toolPart(done.assistant).state).not.toBe('output-available')
    const bobs = await chat(server.url, [user('list my orders')], BOB)
    expect(toolPart(bobs.assistant).output).toContainEqual(
      expect.objectContaining({ id: 'o-3', status: 'open' }),
    )
  })
})

describe('pages', () => {
  it('renders the signed-in page and the chat widget', async () => {
    const html = await (await fetch(server.url, { headers: { cookie: ALICE } })).text()
    expect(html).toContain('Signed in as <b>alice</b>')
    expect(html).toContain('Open assistant')
  })
})
