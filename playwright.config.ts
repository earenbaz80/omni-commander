import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The app, the Vite dev server and the backend starve when several Chromium
  // contexts load at once, which made the readiness gates time out. Serial
  // execution keeps this small suite deterministic and reliable.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      timeout: 180000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run server',
      url: `http://127.0.0.1:${process.env.OMNI_API_PORT || 3001}/api/drives`,
      timeout: 60000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});