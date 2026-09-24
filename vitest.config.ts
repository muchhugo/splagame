import { defineConfig } from 'vitest/config';

export default defineConfig({
  // constante que o Vite injeta no build do jogo (host standalone de desenvolvimento)
  define: { __ENABLE_STANDALONE_DEV_HOST__: 'false' },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/game-server/test/**/*.test.ts', 'apps/activity-shell/test/**/*.test.ts', 'apps/game-client/test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
  },
});
