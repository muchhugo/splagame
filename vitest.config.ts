import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/game-server/test/**/*.test.ts', 'apps/activity-shell/test/**/*.test.ts', 'apps/game-client/test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
  },
});
