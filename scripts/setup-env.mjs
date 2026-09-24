// Gera .env local a partir de .env.example, com segredos aleatórios de desenvolvimento.
// Não sobrescreve um .env existente (apenas completa segredos vazios).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const example = readFileSync('.env.example', 'utf8');
const current = existsSync('.env') ? readFileSync('.env', 'utf8') : example;
const secret = () => randomBytes(32).toString('base64url');
let changed = !existsSync('.env');
const out = current
  .split('\n')
  .map((line) => {
    const m = line.match(/^(DEV_MATCH_CREDENTIAL_SECRET|LAB_SESSION_SECRET)=\s*$/);
    if (m) {
      changed = true;
      return `${m[1]}=${secret()}`;
    }
    return line;
  })
  .join('\n');
if (changed) {
  writeFileSync('.env', out);
  console.log('.env de desenvolvimento pronto (segredos locais gerados).');
} else {
  console.log('.env já existe; nada alterado.');
}
