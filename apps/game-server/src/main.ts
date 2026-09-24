import { loadConfig } from './config';
import { loadDotEnv } from './env';
import { log } from './logger';
import { startGameServer } from './server';

loadDotEnv();
const cfg = loadConfig();
const started = await startGameServer(cfg);

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  // Encerramento gracioso: para de aceitar salas; rodadas ativas são marcadas como interrompidas.
  log('info', 'server.stopping', { signal });
  await started.shutdown().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
