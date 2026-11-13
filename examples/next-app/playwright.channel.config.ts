import { defineConfig, devices } from '@playwright/test'

const APP = 3491
const WORKER = 3490
const SECRET = 'channel-test-worker-secret-0123456789'

/**
 * Background jobs run by a separate worker server (worker/server.mjs): the app hands the job over, the worker reports
 * the result back to the app and rings the browser on its own SSE stream, and the agent continues by itself.
 * Scripted model, no API key. Build first: pnpm example:build.
 */
export default defineConfig({
  testDir: 'test/ui-channel',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${APP}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node worker/server.mjs',
      url: `http://127.0.0.1:${WORKER}/health`,
      env: {
        WORKER_PORT: String(WORKER),
        APP_URL: `http://127.0.0.1:${APP}`,
        EXAMPLE_WORKER_SECRET: SECRET,
        WORKER_JOB_MS: '2500',
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next start -p ${APP}`,
      url: `http://127.0.0.1:${APP}`,
      env: {
        DOPUS_MOCK_MODEL: '1',
        DOPUS_APPROVAL_SECRET: 'ui-test-approval-secret-0123456789abcdef',
        EXAMPLE_JOB_WORKER_URL: `http://127.0.0.1:${WORKER}`,
        EXAMPLE_JOB_EVENTS_URL: `http://127.0.0.1:${WORKER}/events`,
        EXAMPLE_WORKER_SECRET: SECRET,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
