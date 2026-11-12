import { defineConfig, devices } from '@playwright/test'

const PORT = 3489
const url = process.env.DOPUS_TEST_DATABASE_URL
if (!url) {
  throw new Error(
    'Set DOPUS_TEST_DATABASE_URL to a Postgres you can write to, with db/schema.sql applied (local only).',
  )
}

/**
 * Chat history kept in Postgres (lib/chat-db.ts) instead of sessionStorage, against `next start` with the scripted
 * model. Its own server, so the in-memory orders start fresh. Build first: pnpm example:build.
 */
export default defineConfig({
  testDir: 'test/ui-db',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    env: {
      DOPUS_MOCK_MODEL: '1',
      DOPUS_APPROVAL_SECRET: 'ui-test-approval-secret-0123456789abcdef',
      DATABASE_URL: url,
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
