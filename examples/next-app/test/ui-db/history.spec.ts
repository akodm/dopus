import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { Pool } from 'pg'

// Chat history in Postgres: saved by the agent's onFinish, loaded by a server action, scoped to the user.
test.describe.configure({ mode: 'serial' })

const db = new Pool({ connectionString: process.env.DOPUS_TEST_DATABASE_URL, max: 2 })
const USERS = ['carol', 'bob']

test.beforeAll(async () => {
  await db.query('delete from dopus.chat_messages where user_id = any($1)', [USERS])
  await db.query('delete from dopus.chat_closed where user_id = any($1)', [USERS])
})
test.afterAll(async () => {
  await db.end()
})

async function signIn(context: BrowserContext, baseURL: string | undefined, user: string) {
  await context.addCookies([{ name: 'session', value: user, url: baseURL ?? '' }])
}

async function openTab(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('button', { name: 'Open assistant' }).click()
  return page
}

async function send(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Ask anything…' })
  await input.fill(text)
  await input.press('Enter')
}

const chat = (page: Page) => page.locator('.dopus-chat')

async function rows(user: string) {
  const { rows } = await db.query<{
    id: string
    conversation_id: string
    role: string
    parts: number
  }>(
    `select id, conversation_id, message->>'role' as role, jsonb_array_length(message->'parts') as parts
     from dopus.chat_messages where user_id = $1 order by seq`,
    [user],
  )
  return rows
}

test('a reply is saved for the user and loads in a new tab', async ({ context, baseURL }) => {
  await signIn(context, baseURL, 'carol')
  const a = await openTab(context)
  await send(a, 'who am I')
  await expect(chat(a).getByText('✓ Get current user')).toBeVisible()

  await expect
    .poll(async () => (await rows('carol')).map((r) => r.role))
    .toEqual(['user', 'assistant'])
  const saved = await rows('carol')
  expect(new Set(saved.map((r) => r.conversation_id)).size).toBe(1)
  expect(saved[0]?.conversation_id).toBe(saved[0]?.id)

  // A new tab has empty sessionStorage: what it shows comes from the database.
  const b = await openTab(context)
  await expect(chat(b).getByText('who am I', { exact: true })).toBeVisible()
  await expect(chat(b).getByText('✓ Get current user')).toBeVisible()
})

test('after an approval the continued reply updates the same row', async ({ context, baseURL }) => {
  await signIn(context, baseURL, 'carol')
  const a = await openTab(context)
  await expect(chat(a).getByText('who am I', { exact: true })).toBeVisible()
  await send(a, 'cancel o-4')
  await chat(a).getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(chat(a).getByText('✓ Cancel order')).toBeVisible()
  await expect(chat(a).getByText(/result: .*"ok":true/)).toBeVisible()

  // who am I + reply, cancel + one reply (asked, then continued after Approve): 4 rows, one conversation.
  await expect.poll(async () => (await rows('carol')).length).toBe(4)
  const saved = await rows('carol')
  expect(saved.map((r) => r.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  expect(new Set(saved.map((r) => r.conversation_id)).size).toBe(1)
  const { rows: last } = await db.query(
    `select message from dopus.chat_messages where user_id = 'carol' and id = $1`,
    [saved[3]?.id],
  )
  expect(JSON.stringify(last[0]?.message)).toContain('output-available')

  const b = await openTab(context)
  await expect(chat(b).getByText('✓ Cancel order')).toBeVisible()
})

test('another user loads only their own conversation', async ({ context, baseURL }) => {
  await signIn(context, baseURL, 'bob')
  const page = await openTab(context)
  await expect(page.getByText('Signed in as bob')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(chat(page).locator('.dopus-message')).toHaveCount(0)
  expect(await rows('bob')).toEqual([])
})

test('message ids from the browser cannot overwrite another user’s rows', async ({
  context,
  baseURL,
}) => {
  const carol = await rows('carol')
  const target = carol[0]?.id ?? ''
  const { rows: before } = await db.query(
    `select message from dopus.chat_messages where user_id = 'carol' and id = $1`,
    [target],
  )

  // bob sends a message reusing carol's first message id (and so her conversation id).
  await signIn(context, baseURL, 'bob')
  const response = await context.request.post('/api/agent', {
    data: {
      messages: [{ id: target, role: 'user', parts: [{ type: 'text', text: 'who am I' }] }],
    },
  })
  expect(response.ok()).toBe(true)
  await response.text()

  await expect.poll(async () => (await rows('bob')).length).toBe(2)
  const { rows: after } = await db.query(
    `select message from dopus.chat_messages where user_id = 'carol' and id = $1`,
    [target],
  )
  expect(after[0]?.message).toEqual(before[0]?.message)
  expect((await rows('carol')).length).toBe(carol.length)
})

test('"New chat" starts over, and the old conversation stays stored', async ({
  context,
  baseURL,
}) => {
  await signIn(context, baseURL, 'carol')
  const a = await openTab(context)
  await expect(chat(a).getByText('✓ Cancel order')).toBeVisible()
  await chat(a).getByRole('button', { name: 'New chat' }).click()

  const b = await openTab(context)
  await b.waitForTimeout(500)
  await expect(chat(b).locator('.dopus-message')).toHaveCount(0)
  await send(b, 'list my orders')
  await expect(chat(b).getByText('✓ List my orders')).toBeVisible()

  await expect.poll(async () => (await rows('carol')).length).toBe(6)
  expect(new Set((await rows('carol')).map((r) => r.conversation_id)).size).toBe(2)
  const c = await openTab(context)
  await expect(chat(c).getByText('list my orders', { exact: true })).toBeVisible()
  await expect(chat(c).getByText('who am I', { exact: true })).toHaveCount(0)
})
