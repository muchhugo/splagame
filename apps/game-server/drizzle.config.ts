import { defineConfig } from 'drizzle-kit';

// Só gera migrações a partir do esquema (não conecta em banco nenhum).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
