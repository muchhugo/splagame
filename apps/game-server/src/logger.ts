/**
 * Logs estruturados (JSON por linha). Nunca registrar tokens, credenciais ou
 * o conteúdo das opções de join. Sem log por projétil.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel: Level = (process.env.LOG_LEVEL as Level) ?? 'info';
if (process.env.VITEST) minLevel = 'warn';

const FORBIDDEN_KEYS = /token|credential|secret|authorization|password/i;

function scrub(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = FORBIDDEN_KEYS.test(k) ? '[omitido]' : v;
  return out;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...scrub(fields) });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export function setLogLevel(l: Level) {
  minLevel = l;
}
