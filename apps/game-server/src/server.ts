import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GAME_NAME, GAME_VERSION, MATCH_ROOM_NAME } from '@borrifo/game-contracts';
import type { ServerConfig } from './config';
import { CredentialVerifier } from './auth';
import { log } from './logger';
import { JsonlResultSink, type ResultSink } from './results';
import { connectPostgres } from './db/postgres';
import { PostgresResultSink } from './db/resultSink';
import { ArenaRoom } from './rooms/ArenaRoom';
import { preloadAllWorlds } from './world';
import { KeyedRateLimiter } from './rateLimit';
import { TrustedProxies, sanitizeForwarding } from './clientIp';

export interface StartedServer {
  server: Server;
  port: number;
  shutdown(): Promise<void>;
}

/**
 * Monta o servidor de partidas (processo persistente, várias salas).
 * Não usa Route Handlers nem funções efêmeras: o loop da partida vive aqui.
 */
export async function startGameServer(cfg: ServerConfig, opts: { sink?: ResultSink; port?: number } = {}): Promise<StartedServer> {
  // todas as variantes de todos os mapas: a escolha por rodada é síncrona e sem espera
  await preloadAllWorlds();
  ArenaRoom.joinLimiter = new KeyedRateLimiter(cfg.joinRateBurst, cfg.joinRatePerSecond);
  // falha na partida (não em silêncio) se TRUSTED_PROXIES estiver malformado
  const proxies = new TrustedProxies(cfg.trustedProxies);
  // destino dos resultados: injetado (testes), PostgreSQL (produção) ou JSONL (laboratório)
  let closeDb: (() => Promise<void>) | null = null;
  let sink = opts.sink;
  if (!sink && cfg.resultSink === 'postgres') {
    const pg = connectPostgres(cfg.databaseUrl!, { ssl: cfg.databaseSsl });
    // confere a conexão e o esquema na subida: falha cedo e com mensagem clara
    await pg.pool.query('select 1 from round_results limit 1').catch((e: unknown) => {
      throw new Error(`banco de resultados indisponível ou sem migração (pnpm --filter @borrifo/game-server db:migrate): ${String(e)}`);
    });
    sink = new PostgresResultSink(pg.db);
    closeDb = () => pg.pool.end();
  }
  ArenaRoom.deps = {
    verifier: new CredentialVerifier(cfg),
    sink: sink ?? new JsonlResultSink(cfg.resultsFile),
    roundDurationSeconds: cfg.roundDurationSeconds,
    correioDurationSeconds: cfg.correioDurationSeconds,
    reconnectWindowSeconds: cfg.reconnectWindowSeconds,
    maxRooms: cfg.maxRooms,
  };
  const allowed = new Set(cfg.allowedOrigins);
  // CORS do matchmaking: só origens permitidas (a credencial vai no corpo do POST).
  matchMaker.controller.getCorsHeaders = function (headers: Headers): Record<string, string> {
    const origin = headers.get('origin');
    if (origin && allowed.has(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    return {};
  };
  const transport = new WebSocketTransport({
    pingInterval: 5000,
    pingMaxRetries: 3,
    maxPayload: 64 * 1024,
    // Upgrade de WebSocket: origem de navegador precisa estar na lista (clientes Node sem Origin são aceitos em dev).
    beforeUpgrade: (_req, ctx) => {
      const origin = ctx.headers.get('origin');
      if (origin && !allowed.has(origin)) return new Response('origem não permitida', { status: 403 });
      if (!origin && cfg.nodeEnv === 'production') return new Response('origem ausente', { status: 403 });
    },
  });
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
    express: (app) => {
      app.get('/healthz', (_req, res) => {
        res.json({ ok: true, game: GAME_NAME, version: GAME_VERSION, rooms: ArenaRoom.bySession.size });
      });
    },
  });
  server.define(MATCH_ROOM_NAME, ArenaRoom).filterBy(['activitySessionId']);
  const port = opts.port ?? cfg.port;
  await server.listen(port, cfg.host);
  // Antes de qualquer ouvinte do Colyseus (matchmaking HTTP e upgrade do WebSocket):
  // remove cabeçalhos de encaminhamento vindos de fora e grava o cliente resolvido.
  const http = (transport as unknown as { server?: import('node:http').Server }).server;
  if (!http) throw new Error('transporte sem servidor HTTP: não dá para proteger o limite por IP');
  let warnedProxyWithoutXff = false;
  const guard = (req: import('node:http').IncomingMessage) => {
    const ip = sanitizeForwarding(req, proxies);
    if (!warnedProxyWithoutXff && proxies.trusts(ip)) {
      warnedProxyWithoutXff = true;
      log('warn', 'proxy.no_forwarded_for', { hint: 'o proxy confiável não mandou X-Forwarded-For: todos dividem o mesmo limite' });
    }
  };
  http.prependListener('request', guard);
  http.prependListener('upgrade', guard);
  log('info', 'server.listening', { port, authMode: cfg.authMode, allowedOrigins: cfg.allowedOrigins, trustedProxies: proxies.entries, resultSink: opts.sink ? 'injetado' : cfg.resultSink });
  return {
    server,
    port,
    async shutdown() {
      await server.gracefullyShutdown(false);
      await closeDb?.().catch(() => {});
    },
  };
}
