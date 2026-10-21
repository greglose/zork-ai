import { defineConfig } from 'vitest/config';

// Tests that read the built page need dist/ to match the current source, so one build runs before the suite.
export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
  },
});
