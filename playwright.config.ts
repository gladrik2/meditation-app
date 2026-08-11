import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://127.0.0.1:4173/meditation-app/',
    viewport: { width: 640, height: 480 }
  },
  webServer: {
    command:
      'GITHUB_ACTIONS=true GITHUB_REPOSITORY=gladrik2/meditation-app npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/meditation-app/',
    reuseExistingServer: !process.env.CI
  }
})
