import { type BrowserContext, expect, type Page, test } from '@playwright/test'

// The same user in several tabs of one browser (shared cookies, one sessionStorage per tab).
// erin's orders o-7..o-9 are used only here, in this order.
test.describe.configure({ mode: 'serial' })

const USER = 'erin'

async function signIn(context: BrowserContext, baseURL: string | undefined, user = USER) {
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
const approve = (page: Page) => chat(page).getByRole('button', { name: 'Approve', exact: true })

/** Chrome's "Duplicate tab" copies the tab's sessionStorage into the new tab. */
async function duplicateTab(context: BrowserContext, page: Page) {
  const storage = await page.evaluate(() => JSON.stringify({ ...sessionStorage }))
  const copy = await context.newPage()
  await copy.addInitScript((items) => {
    if (sessionStorage.length === 0) {
      for (const [key, value] of Object.entries(JSON.parse(items) as Record<string, string>)) {
        sessionStorage.setItem(key, value)
      }
    }
  }, storage)
  await copy.goto('/')
  await copy.getByRole('button', { name: 'Open assistant' }).click()
  return copy
}

/** The order's status as the shop page shows it to `user`, read in a fresh tab. */
async function statusOf(context: BrowserContext, baseURL: string | undefined, id: string) {
  await signIn(context, baseURL)
  const page = await context.newPage()
  await page.goto('/')
  const text = await page.locator('main li', { hasText: `${id} ·` }).textContent()
  await page.close()
  return text?.split('·').at(-1)?.trim()
}

test('each tab keeps its own conversation', async ({ context, baseURL }) => {
  await signIn(context, baseURL)
  const a = await openTab(context)
  await send(a, 'who am I')
  await expect(chat(a).getByText('✓ Get current user')).toBeVisible()

  const b = await openTab(context)
  await expect(chat(b).locator('.dopus-message')).toHaveCount(0)
  await send(b, 'list my orders')
  await expect(chat(b).getByText('✓ List my orders')).toBeVisible()

  // Each tab's reload brings back its own conversation only.
  await a.reload()
  await a.getByRole('button', { name: 'Open assistant' }).click()
  await expect(chat(a).getByText('who am I', { exact: true })).toBeVisible()
  await expect(chat(a).getByText('list my orders', { exact: true })).toHaveCount(0)
  await b.reload()
  await b.getByRole('button', { name: 'Open assistant' }).click()
  await expect(chat(b).getByText('list my orders', { exact: true })).toBeVisible()
  await expect(chat(b).getByText('who am I', { exact: true })).toHaveCount(0)
})

test('the same card approved in two tabs (duplicated tab) changes the order once', async ({
  context,
  baseURL,
}) => {
  await signIn(context, baseURL)
  const a = await openTab(context)
  await send(a, 'cancel o-7')
  await expect(approve(a)).toBeVisible()

  const b = await duplicateTab(context, a)
  await expect(approve(b)).toBeVisible()

  await approve(a).click()
  await expect(chat(a).getByText('✓ Cancel order')).toBeVisible()
  await expect(chat(a).getByText(/result: .*"ok":true/)).toBeVisible()

  // The second approval reaches the server function, whose own check refuses it.
  await approve(b).click()
  await expect(chat(b).getByText(/result: .*Order is already cancelled/)).toBeVisible()
  await expect(chat(b).getByRole('alert')).toHaveCount(0)
  expect(await statusOf(context, baseURL, 'o-7')).toBe('cancelled')
})

test('signed out in another tab: an approval answered afterwards is not run', async ({
  context,
  baseURL,
}) => {
  await signIn(context, baseURL)
  const a = await openTab(context)
  await send(a, 'cancel o-8')
  await expect(approve(a)).toBeVisible()

  const b = await context.newPage()
  await b.goto('/')
  await b.getByRole('button', { name: 'Sign out' }).click()
  await expect(b.getByRole('link', { name: 'Sign in' })).toBeVisible()

  await approve(a).click()
  await expect(chat(a).getByText('Not run: Cancel order')).toBeVisible()
  await expect(chat(a).getByRole('alert')).toHaveCount(0)
  expect(await statusOf(context, baseURL, 'o-8')).toBe('open')
})

test('after another user signs in from another tab, an approval runs with their permissions only', async ({
  context,
  baseURL,
}) => {
  await signIn(context, baseURL)
  const a = await openTab(context)
  await send(a, 'cancel o-9')
  await expect(approve(a)).toBeVisible()

  // Another tab signs in as alice; the cookie is shared, so tab A now talks to the server as alice.
  await signIn(context, baseURL, 'alice')
  // The request carries alice's cookie, so the tool runs with alice's permissions, and the app's own owner
  // check refuses erin's order. The page then refreshes into alice's (empty) chat; erin's stays in erin's key.
  const reply = a.waitForResponse('**/api/agent')
  await approve(a).click()
  expect(await (await reply).text()).toContain('Order not found')
  await expect(a.getByText('Signed in as alice')).toBeVisible()
  await expect(chat(a).locator('.dopus-message')).toHaveCount(0)
  expect(await statusOf(context, baseURL, 'o-9')).toBe('open')
})

test('a background job started in one tab is followed up only in that tab', async ({
  context,
  baseURL,
}) => {
  await signIn(context, baseURL)
  const b = await openTab(context)
  await send(b, 'who am I')
  await expect(chat(b).getByText('✓ Get current user')).toBeVisible()

  const a = await openTab(context)
  await send(a, 'export my orders')
  await expect(chat(a).getByText('Background task finished')).toBeVisible({ timeout: 10_000 })
  await expect(chat(a).getByText('✓ Get export')).toBeVisible()

  // Both tabs hear the job on the channel (same user); only the tab whose chat started it acts.
  await b.waitForTimeout(1_500)
  await expect(chat(b).getByText('Background task finished')).toHaveCount(0)
  await expect(chat(b).getByText('Get export')).toHaveCount(0)
  await expect(chat(b).locator('.dopus-message')).toHaveCount(2)
})
