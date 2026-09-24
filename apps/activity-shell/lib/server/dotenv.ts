import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let loaded = false;

/**
 * O Next só carrega `.env` do diretório do app. O laboratório mantém um único
 * `.env` na raiz do monorepo, então ele é lido aqui (sem sobrescrever variáveis
 * já definidas no processo). Somente servidor: estes valores são privados.
 */
export function loadRepoRootDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = path.resolve(/* turbopackIgnore: true */ process.cwd(), '..', '..', '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, name, raw] = m;
    if (process.env[name] !== undefined) continue;
    let value = raw;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    process.env[name] = value;
  }
}
