import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Node tests (logic + GPU plumbing)
  'vitest.config.ts',
  // Browser tests (behavior + visual regression)
  'vitest.browser.config.ts',
]);
