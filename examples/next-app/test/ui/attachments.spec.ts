import { expect, type Page, test } from '@playwright/test'

// File attachments: the chat uploads to the app's own /api/files and sends only a reference; the model reads the
// file through the describeFile tool, which checks the owner. gina and hank are used only here.
test.describe.configure({ mode: 'serial' })

async function openChat(page: Page, baseURL: string | undefined, user = 'gina') {
  await page.context().addCookies([{ name: 'session', value: user, url: baseURL ?? '' }])
  await page.goto('/')
  await page.getByRole('button', { name: 'Open assistant' }).click()
}

const chat = (page: Page) => page.locator('.dopus-chat')
const fileInput = (page: Page) => chat(page).locator('input[type="file"]')

test('an attached file is sent as a reference and read through a tool', async ({
  page,
  baseURL,
}) => {
  await openChat(page, baseURL)
  await fileInput(page).setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Remember to water the plants.'),
  })
  const chip = chat(page).locator('.dopus-attachment', { hasText: 'notes.txt' })
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('data-status', 'done')
  // No text: the file alone is the message.
  await chat(page).getByRole('button', { name: 'Send' }).click()
  await expect(chat(page).getByText('✓ Describe file')).toBeVisible()
  const result = chat(page).getByText(/result: .*"ok":true/)
  await expect(result).toBeVisible()
  await expect(result).toContainText('notes.txt')
  await expect(result).toContainText('Remember to water the plants.')
})

test('a file over 20 MB is refused on its chip and never uploaded', async ({ page, baseURL }) => {
  const uploads: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/files') uploads.push(request.url())
  })
  await openChat(page, baseURL)
  await fileInput(page).setInputFiles({
    name: 'huge.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
  })
  const chip = chat(page).locator('.dopus-attachment', { hasText: 'huge.bin' })
  await expect(chip).toContainText('File is too large')
  await expect(chip).toHaveAttribute('data-status', 'error')
  // Nothing to send: the refused file does not count as content.
  await expect(chat(page).getByRole('button', { name: 'Send' })).toBeDisabled()
  expect(uploads).toEqual([])
})

test('a chip with a long name gets its own row and leaves the input and Send in the panel', async ({
  page,
  baseURL,
}) => {
  await openChat(page, baseURL)
  const name = 'quarterly_sales_report_2026_final_v2_with_every_regional_breakdown_and_notes.xlsx'
  await fileInput(page).setInputFiles({
    name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('a,b\n1,2\n'),
  })
  const chip = chat(page).locator('.dopus-attachment', { hasText: 'quarterly_sales_report' })
  await expect(chip).toHaveAttribute('data-status', 'done')
  const box = async (locator: ReturnType<Page['locator']>) => {
    const found = await locator.boundingBox()
    if (!found) throw new Error('not rendered')
    return found
  }
  const inside = (
    inner: { x: number; y: number; width: number; height: number },
    outer: typeof inner,
  ) =>
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  const panel = await box(chat(page))
  const send = await box(chat(page).getByRole('button', { name: 'Send' }))
  const input = await box(chat(page).getByRole('textbox', { name: 'Ask anything…' }))
  const chipBox = await box(chip)
  expect(inside(send, panel)).toBe(true)
  expect(inside(chipBox, panel)).toBe(true)
  expect(input.width).toBeGreaterThanOrEqual(120)
  // The chips sit above the input, not beside it.
  expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(input.y)
  // The long name is cut with an ellipsis; the full name stays in the title.
  const cut = await chip
    .locator('.dopus-attachment-name')
    .evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(cut).toBe(true)
  await expect(chip).toHaveAttribute('title', name)
  await expect(chip.locator('[aria-live="polite"]')).toHaveCount(1)
})

test("another user's fileId is not found", async ({ request }) => {
  const upload = await request.post('/api/files', {
    headers: { cookie: 'session=gina' },
    multipart: {
      file: { name: 'secret.txt', mimeType: 'text/plain', buffer: Buffer.from('gina only') },
    },
  })
  expect(upload.ok()).toBe(true)
  const { id } = (await upload.json()) as { id: string }
  expect(id).toBeTruthy()

  const response = await request.post('/api/agent', {
    headers: { cookie: 'session=hank', 'content-type': 'application/json' },
    data: {
      messages: [
        {
          id: 'u-hank-1',
          role: 'user',
          parts: [
            {
              type: 'data-dopus-file',
              data: { id, name: 'secret.txt', type: 'text/plain', size: 9 },
            },
          ],
        },
      ],
      dopus: { approvals: true },
    },
  })
  expect(response.ok()).toBe(true)
  const body = await response.text()
  expect(body).toContain('describeFile')
  expect(body).toContain('File not found.')
  expect(body).not.toContain('gina only')
})

test('requests carry dopus.approvals', async ({ page, baseURL }) => {
  await openChat(page, baseURL)
  const sent = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/agent' && request.method() === 'POST',
  )
  const input = chat(page).getByRole('textbox', { name: 'Ask anything…' })
  await input.fill('who am I')
  await input.press('Enter')
  const body = (await sent).postDataJSON() as { dopus?: { approvals?: unknown } }
  expect(body.dopus?.approvals).toBe(true)
  await expect(chat(page).getByText('✓ Get current user')).toBeVisible()
})

test("a file picked but not sent does not follow into the next user's chat", async ({
  page,
  baseURL,
}) => {
  await openChat(page, baseURL)
  await fileInput(page).setInputFiles({
    name: 'gina-draft.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not sent'),
  })
  await expect(chat(page).locator('.dopus-attachment', { hasText: 'gina-draft.txt' })).toBeVisible()
  // Sign out is a server action: the page stays loaded (no full reload) and the layout remounts the chat.
  await page.evaluate(() => {
    ;(window as unknown as { __sameDocument?: boolean }).__sameDocument = true
  })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Open assistant' }).click()
  await expect(chat(page).getByRole('button', { name: 'Attach file' })).toBeVisible()
  await expect(chat(page).locator('.dopus-attachment')).toHaveCount(0)
  await expect(chat(page).getByText('gina-draft.txt')).toHaveCount(0)
})
