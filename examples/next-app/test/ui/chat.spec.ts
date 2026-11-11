import { expect, type Page, test } from '@playwright/test'

// The tests share one server; the cancel tests change carol's orders in this order.
test.describe.configure({ mode: 'serial' })

async function openChat(page: Page, baseURL: string | undefined) {
  await page.context().addCookies([{ name: 'session', value: 'carol', url: baseURL ?? '' }])
  await page.goto('/')
  await page.getByRole('button', { name: 'Open assistant' }).click()
}

async function send(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Ask anything…' })
  await input.fill(text)
  await input.press('Enter')
}

const chat = (page: Page) => page.locator('.dopus-chat')
const order = (page: Page, id: string) => page.locator('main li', { hasText: `${id} ·` })

test.describe('approvals', () => {
  test('declining a card does not run the tool', async ({ page, baseURL }) => {
    await openChat(page, baseURL)
    await send(page, 'cancel o-4')
    await chat(page).getByRole('button', { name: 'Decline' }).click()
    await expect(chat(page).getByText('Declined: Cancel order')).toBeVisible()
    await expect(order(page, 'o-4')).toContainText('open')
  })

  test('typing instead of answering leaves the cards "not run", and the chat keeps working', async ({
    page,
    baseURL,
  }) => {
    await openChat(page, baseURL)
    await send(page, 'cancel o-4 o-5')
    await expect(chat(page).getByRole('group')).toHaveCount(2)
    // Answer one card only, then write instead of answering the other: the approved one must not run later,
    // and the conversation must not break (it used to fail on every message after this).
    await chat(page).getByRole('button', { name: 'Approve', exact: true }).first().click()
    await expect(chat(page).getByText('Approved: Cancel order')).toBeVisible()
    await send(page, 'never mind')
    await expect(chat(page).getByText('Not run: Cancel order')).toHaveCount(2)
    await expect(chat(page).getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await expect(chat(page).getByText('Try "who am I"')).toBeVisible()
    await expect(chat(page).getByRole('alert')).toHaveCount(0)
    await expect(order(page, 'o-4')).toContainText('open')
    await expect(order(page, 'o-5')).toContainText('open')
    await send(page, 'who am I')
    await expect(chat(page).getByText('✓ Get current user')).toBeVisible()
    await expect(chat(page).getByRole('alert')).toHaveCount(0)
  })

  test('"Approve all" answers every open card at once', async ({ page, baseURL }) => {
    await openChat(page, baseURL)
    await send(page, 'cancel o-5 o-6')
    await chat(page).getByRole('button', { name: 'Approve all (2)' }).click()
    await expect(chat(page).getByText('✓ Cancel order')).toHaveCount(2)
    // The UI refreshes server components after a tool ran.
    await expect(order(page, 'o-5')).toContainText('cancelled')
    await expect(order(page, 'o-6')).toContainText('cancelled')
  })

  test('approving runs the tool as the signed-in user and refreshes the page', async ({
    page,
    baseURL,
  }) => {
    await openChat(page, baseURL)
    await send(page, 'cancel o-4')
    await expect(chat(page).getByRole('button', { name: /Approve all/ })).toHaveCount(0)
    await chat(page).getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(chat(page).getByText('✓ Cancel order')).toBeVisible()
    await expect(order(page, 'o-4')).toContainText('cancelled')
  })
})

test.describe('background jobs', () => {
  test('the agent continues by itself when a job it started finishes', async ({
    page,
    baseURL,
  }) => {
    await openChat(page, baseURL)
    await send(page, 'export my orders')
    await expect(chat(page).getByText('Working in the background: Start export')).toBeVisible()
    await expect(chat(page).getByText('Background task finished')).toBeVisible({ timeout: 10_000 })
    await expect(chat(page).getByText('✓ Get export')).toBeVisible()
    await expect(chat(page).getByText(/result: .*\/exports\/job-/)).toBeVisible()
    await expect(chat(page).getByText('Working in the background')).toHaveCount(0)
  })

  test('a reply that finishes while the widget is closed marks the launcher', async ({
    page,
    baseURL,
  }) => {
    await openChat(page, baseURL)
    await send(page, 'export my orders')
    await expect(chat(page).getByText('Working in the background: Start export')).toBeVisible()
    await page.getByRole('button', { name: 'Close assistant' }).click()
    const launcher = page.locator('.dopus-launcher')
    await expect(launcher).toHaveAttribute('data-unread', '', { timeout: 10_000 })
    await expect(launcher).toHaveAccessibleName('Open assistant (New reply)')
    await launcher.click()
    await expect(launcher).not.toHaveAttribute('data-unread')
    await expect(chat(page).getByText('✓ Get export')).toBeVisible()
  })
})

test.describe('chat history (the example keeps it in sessionStorage, per user)', () => {
  test('the conversation survives a reload; "New chat" clears it', async ({ page, baseURL }) => {
    await openChat(page, baseURL)
    await send(page, 'who am I')
    await expect(chat(page).getByText('✓ Get current user')).toBeVisible()

    await page.reload()
    await page.getByRole('button', { name: 'Open assistant' }).click()
    await expect(chat(page).getByText('who am I')).toBeVisible()
    await expect(chat(page).getByText('✓ Get current user')).toBeVisible()

    await chat(page).getByRole('button', { name: 'New chat' }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Open assistant' }).click()
    await expect(chat(page).locator('.dopus-message')).toHaveCount(0)
  })

  test('another user in the same tab does not see it', async ({ page, baseURL }) => {
    await openChat(page, baseURL)
    await send(page, 'who am I')
    await expect(chat(page).getByText('✓ Get current user')).toBeVisible()

    await page.context().addCookies([{ name: 'session', value: 'bob', url: baseURL ?? '' }])
    await page.reload()
    await page.getByRole('button', { name: 'Open assistant' }).click()
    await expect(chat(page).locator('.dopus-message')).toHaveCount(0)
  })
})

test.describe('chat basics', () => {
  test('an over-long message offers a new chat, which clears the conversation', async ({
    page,
    baseURL,
  }) => {
    await openChat(page, baseURL)
    await send(page, 'x'.repeat(8_001))
    const alert = chat(page).getByRole('alert')
    await expect(alert).toContainText('Too long to send')
    await alert.getByRole('button', { name: 'New chat' }).click()
    await expect(chat(page).locator('.dopus-message')).toHaveCount(0)
    await expect(chat(page).getByRole('button', { name: 'Who am I?' })).toBeVisible()
  })
})
