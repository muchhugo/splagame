// Aplica as migrações do esquema em DATABASE_URL. Rodar explicitamente (implantação),
// nunca automático na subida do servidor.
import { connectPostgres } from '../src/db/postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL ausente');
  process.exit(1);
}
const { migrate, pool } = connectPostgres(url, { ssl: process.env.DATABASE_SSL === '1' });
await migrate();
await pool.end();
console.log('migrações aplicadas');
