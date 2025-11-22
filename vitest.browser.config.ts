import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    // Only pick browser tests
    include: ['tests/browser/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      // WebGPU requires headed browser or GPU-enabled CI environment
      // Set to false for local development with display
      headless: false,
      provider: playwright({
        launch: {
          // Attempt to enable WebGPU (may not work in all headless environments)
          args: [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan,UseSkiaRenderer',
            '--use-gl=angle',
            '--use-angle=swiftshader',
          ],
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
  resolve: {
    alias: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      '@': '/home/user/webgpu-playground/src',
    },
  },
});
