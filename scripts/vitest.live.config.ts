import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/live-providers-verification.test.ts'],
    testTimeout: 240000,
    hookTimeout: 30000,
  },
});
