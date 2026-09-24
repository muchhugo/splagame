import { loadConfig } from '../src/config';
import { startGameServer, type StartedServer } from '../src/server';
import { MemoryResultSink } from '../src/results';
import { TEST_DEV_SECRET } from '@borrifo/test-utils';
import { CATALOG_HASH } from '@borrifo/game-content';

/** O cliente anuncia o hash do CATÁLOGO de mapas (todas as variantes). */
export const MAP_HASH = CATALOG_HASH;

export async function startTestServer(extra: Record<string, string> = {}): Promise<{ s: StartedServer; url: string; sink: MemoryResultSink }> {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const cfg = loadConfig({
    NODE_ENV: 'test',
    MATCH_AUTH_MODE: 'dev-hs256',
    DEV_MATCH_CREDENTIAL_SECRET: TEST_DEV_SECRET,
    GAME_SERVER_HOST: '127.0.0.1',
    ROUND_DURATION_SECONDS: '5',
    ...extra,
  } as NodeJS.ProcessEnv);
  const sink = new MemoryResultSink();
  const s = await startGameServer(cfg, { sink, port });
  return { s, url: `http://127.0.0.1:${port}`, sink };
}
