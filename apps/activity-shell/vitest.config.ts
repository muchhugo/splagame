import { defineConfig } from 'vitest/config';

// Config local: permite rodar os testes do shell isoladamente, sem depender do
// include da raiz (que ainda não lista apps/activity-shell/test).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
