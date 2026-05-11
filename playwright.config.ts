import { defineConfig } from '@playwright/test';

/**
 * Browser-level tests that load the built extension into Chromium and exercise
 * the content script against a static ChatGPT-thread fixture. Run after
 * `npm run build` (the unpacked extension is the repo root).
 */
export default defineConfig({
    testDir: './test/browser',
    fullyParallel: false,
    workers: 1,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    reporter: process.env.CI ? 'github' : 'list',
});
