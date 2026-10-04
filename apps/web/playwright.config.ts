import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build: the bundled API serving the built web app
 * on one origin, exactly as deployed. Build first with `pnpm build`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Kathmandu',
    // Full Chromium ("new headless"), not the default headless shell: the shell reports
    // notifications as blocked, so push notifications can't be tested in it.
    ...(executablePath ? { launchOptions: { executablePath } } : { channel: 'chromium' }),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: 'node ../api/dist/server.js',
    url: `${baseURL}/readyz`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      PUBLIC_URL: baseURL,
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ?? 'postgresql://et:et@localhost:5432/expense_tracker_e2e',
      AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
      WEB_DIST_DIR: 'dist',
      FX_NRB_ENABLED: 'false',
      // Tests sign up many users a minute; production keeps the limit on.
      AUTH_RATE_LIMIT: 'false',
      // The webhook test receives on localhost.
      WEBHOOK_ALLOW_PRIVATE: 'true',
      EMAIL_IN_ADDRESS: 'money+{token}@example.com',
      EMAIL_IN_SECRET: 'e2e-email-in-secret-0123456789',
      LOG_LEVEL: 'warn',
    },
  },
});
