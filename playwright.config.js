// @ts-check
/* eslint-env node */
import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from .env file when available (local dev).
 * In Docker, env vars are injected via docker-compose env_file.
 */
import fs from 'fs';
import path from 'path';

try {
  if (fs.existsSync('.env')) {
    process.loadEnvFile(path.resolve('.env'));
  }
} catch (e) {
  try {
    const dotenvContent = fs.readFileSync('.env', 'utf-8');
    dotenvContent.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
  } catch (err) {
    console.error('Error loading .env file:', err);
  }
}

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/playwright',
  /* Global setup script - runs once before all tests */
  globalSetup: './tests/global-setup.js',
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  workers: process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS, 10) : (process.env.CI ? 2 : 4),
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['list', { printSteps: false }],
    ['html']
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: process.env.BASE_URL || 'http://localhost:8000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure Playwright to run only in Chromium. */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start Docker services before tests when running locally (e.g. VS Code extension).
     In CI/Docker, BASE_URL is set and the server is managed by docker-compose. */
  webServer: (!process.env.CI && !process.env.BASE_URL) ? {
    command: 'docker compose --profile web up',
    url: 'http://localhost:8000',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  } : undefined,
});
