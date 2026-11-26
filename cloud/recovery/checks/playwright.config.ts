import { defineConfig, devices } from '@playwright/test'
import { UI_TIMEOUT } from '../../../tests/test-timeouts'
export default defineConfig({
  testDir: '.',
  testMatch: 'security-rollout.spec.ts',
  projects: [{
    name: 'iphone-webkit',
    use: { ...devices['iPhone 13'], actionTimeout: UI_TIMEOUT, serviceWorkers: 'allow' },
  }],
})
