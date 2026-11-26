import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    globals: false,
    include: ['test/integration/**/*.spec.ts'],
    fileParallelism: false,
  },
});
