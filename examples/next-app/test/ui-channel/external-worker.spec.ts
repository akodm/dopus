import { type Browser, expect, type Page, test } from '@playwright/test'

// Jobs run by a separate worker server (worker/server.mjs on 3490). The app (3491) hands the job over; the
// worker reports the result back to the app, then rings the browser on its own SSE stream; the agent continues
// by itself. Fresh servers, so carol's orders start as seeded.
test.describe.configure({ mode: 'serial' })

const WORKER_EVENTS = 'http://127.0.0.1:3490/events'

async function openChat(browser: Browser, baseURL: string | undefined, user: string) {
  const context = await browser.newContext()
  await context.addCookies([{ name: 'session', value: user, url: baseURL ?? '' }])
  const page = await context.newPage()
  const agentRequests: string[] = []
  const eventStreams: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/agent') agentRequests.push(request.postData() ?? '')
    if (request.url().startsWith(WORKER_EVENTS)) eventStreams.push(request.url())
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open assistant' }).click()
  return { page, agentRequests, eventStreams }
}

async function send(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Ask anything…' })
  await input.fill(text)
  await input.press('Enter')
}

const chat = (page: Page) => page.locator('.dopus-chat')

test('the worker finishes the job elsewhere and the agent continues by itself', async ({
  browser,
  baseURL,
}) => {
  const { page, agentRequests, eventStreams } = await openChat(browser, baseURL, 'carol')
  await send(page, 'export my orders')
  await expect(chat(page).getByText('Working in the background: Start export')).toBeVisible()
  // The browser listens to the worker's stream, not the app's.
  expect(eventStreams).toEqual([`${WORKER_EVENTS}?user=carol`])

  await expect(chat(page).getByText('Background task finished')).toBeVisible({ timeout: 15_000 })
  await expect(chat(page).getByText('✓ Get export')).toBeVisible()
  const result = chat(page).getByText(/result: .*"status":"done"/)
  await expect(result).toContainText('/exports/job-')
  await expect(chat(page).getByText('Working in the background')).toHaveCount(0)
  // Two requests: the user's message, then the follow-up the chat sent on its own (only the job ID).
  expect(agentRequests).toHaveLength(2)
  expect(agentRequests[1]).toContain('"type":"data-dopus-job"')
  await page.context().close()
})

test('a job that finishes while an approval card is open is followed up after the answer', async ({
  browser,
  baseURL,
}) => {
  const { page } = await openChat(browser, baseURL, 'carol')
  await send(page, 'export my orders')
  await expect(chat(page).getByText('Working in the background: Start export')).toBeVisible()
  await send(page, 'cancel o-4')
  const approve = chat(page).getByRole('button', { name: 'Approve', exact: true })
  await expect(approve).toBeVisible()

  // The worker takes 2.5 s; give it time to ring while the card is still open.
  await page.waitForTimeout(4_000)
  await expect(chat(page).getByText('Background task finished')).toHaveCount(0)
  await expect(chat(page).getByText('Get export')).toHaveCount(0)

  await approve.click()
  await expect(chat(page).getByText('✓ Cancel order')).toBeVisible()
  // Then the waiting follow-up runs: the agent reads the export by itself.
  await expect(chat(page).getByText('Background task finished')).toBeVisible({ timeout: 10_000 })
  await expect(chat(page).getByText('✓ Get export')).toBeVisible()
  await page.context().close()
})

test("another user's chat is not rung and does not continue", async ({ browser, baseURL }) => {
  const bob = await openChat(browser, baseURL, 'bob')
  await send(bob.page, 'who am I')
  await expect(chat(bob.page).getByText('✓ Get current user')).toBeVisible()

  const carol = await openChat(browser, baseURL, 'carol')
  await send(carol.page, 'export my orders')
  await expect(chat(carol.page).getByText('✓ Get export')).toBeVisible({ timeout: 15_000 })

  await bob.page.waitForTimeout(1_000)
  await expect(chat(bob.page).getByText('Background task finished')).toHaveCount(0)
  expect(bob.agentRequests).toHaveLength(1)
  await bob.page.context().close()
  await carol.page.context().close()
})

test('only the worker can report a job as done', async ({ request }) => {
  const forged = await request.post('/api/jobs/done', { data: { id: 'job-1', file: '/x.csv' } })
  expect(forged.status()).toBe(401)
  const wrong = await request.post('/api/jobs/done', {
    data: { id: 'job-1', file: '/x.csv' },
    headers: { 'x-worker-secret': 'not-the-secret-not-the-secret-012345' },
  })
  expect(wrong.status()).toBe(401)
})
