import { defineConfig } from 'vitest/config';

// Tests that need no browser. Real-WebGPU checks run on the Windows RTX 4090
// from visionary-editor's browser runner instead.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
