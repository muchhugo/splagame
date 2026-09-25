import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Conexão do servidor de partidas: pool pequeno (só grava um resultado por rodada) e
 * tempo limite por comando, para um banco lento não segurar a sala.
 */
export function connectPostgres(url: string, opts: { ssl?: boolean } = {}) {
  const pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 5000, connectionTimeoutMillis: 5000, ssl: opts.ssl ? { rejectUnauthorized: true } : undefined });
  pool.on('error', () => {
    /* conexão ociosa caiu: o pool reconecta na próxima consulta */
  });
  const db = drizzle(pool);
  return { db, pool, migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }) };
}
