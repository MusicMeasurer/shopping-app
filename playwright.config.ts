import { defineConfig, devices } from '@playwright/test'
import { UI_TIMEOUT, LOCAL_SAVE_TIMEOUT } from './tests/test-timeouts'
export default defineConfig({
  testDir: './tests', fullyParallel: false,
  expect: { timeout: LOCAL_SAVE_TIMEOUT },
  use: { actionTimeout: UI_TIMEOUT, baseURL: 'http://127.0.0.1:4173' },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173/shopping-app/', reuseExistingServer: false },
})
