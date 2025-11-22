import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only pick browser tests
    include: ['tests/browser/**/*.browser.test.ts'],
    environment: 'node',
    browser: {
      enabled: true,
      headless: true,
      name: 'chromium',
      provider: 'playwright',
      viewport: { width: 1280, height: 720 },
    },
  },
  resolve: {
    alias: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      '@': '/home/user/webgpu-playground/src',
    },
  },
});
