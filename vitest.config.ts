import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

const sourceConditions = [
  'cocos-source',
  ...defaultServerConditions.filter((condition) => condition !== 'module'),
];

export default defineConfig({
  resolve: { conditions: sourceConditions },
  ssr: { resolve: { conditions: sourceConditions } },
  environments: {
    __vitest__: { resolve: { conditions: sourceConditions } },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['test/unit/**/*.spec.ts'],
  },
});
