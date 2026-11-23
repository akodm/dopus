import { defineConfig, devices } from '@playwright/test'

const PORT = 3488

/**
 * Browser tests of the copied chat UI against `next start` with the scripted model (no API key, no cost):
 * approvals, stale cards, background jobs, the unread dot, size limits. Build first: pnpm example:build.
 */
export default defineConfig({
  testDir: 'test/ui',
  // One server whose in-memory orders the tests change in order.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  // Run one project per command (the scripts do): each run starts a fresh server, since the tests change its state.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    env: {
      DOPUS_MOCK_MODEL: '1',
      DOPUS_APPROVAL_SECRET: 'ui-test-approval-secret-0123456789abcdef',
      EXAMPLE_JOB_MS: '3000',
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
