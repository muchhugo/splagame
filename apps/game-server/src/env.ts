import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Carrega .env da raiz do repositório (somente chaves ainda não definidas). */
export function loadDotEnv() {
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (!existsSync(candidate)) continue;
    for (const line of readFileSync(candidate, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k] !== undefined) continue;
      process.env[k] = raw.replace(/^["']|["']$/g, '');
    }
    return;
  }
}
