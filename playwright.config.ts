import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests', fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'mobile-chromium', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', browserName: 'chromium' } },
  ],
  webServer: { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173/shopping-app/', reuseExistingServer: false },
})
