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
