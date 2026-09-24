import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  // .env fica na raiz do monorepo; só variáveis VITE_* chegam ao bundle (públicas).
  const envDir = resolve(import.meta.dirname, '../..');
  const env = loadEnv(mode, envDir, 'VITE_');
  return {
    envDir,
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      fs: { allow: [resolve(import.meta.dirname, '../..')] },
      headers: {
        // A Atividade pode ser embutida apenas pelos hosts permitidos.
        'Content-Security-Policy': `frame-ancestors 'self' ${(env.VITE_ALLOWED_HOST_ORIGINS ?? 'http://localhost:3000').split(',').join(' ')}`,
      },
    },
    preview: { port: 5173, strictPort: true },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 6000,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('@babylonjs')) return 'babylon';
            if (id.includes('rapier')) return 'rapier';
            return undefined;
          },
        },
      },
    },
    define: {
      // Host de desenvolvimento standalone só existe em builds de dev ou se explicitamente habilitado no build.
      __ENABLE_STANDALONE_DEV_HOST__: JSON.stringify(mode !== 'production' || env.VITE_ENABLE_STANDALONE_DEV_HOST === 'true'),
    },
    optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  };
});
