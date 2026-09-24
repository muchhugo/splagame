import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GAME_NAME, GAME_VERSION, MATCH_ROOM_NAME } from '@borrifo/game-contracts';
import { DEFAULT_MAP_ID } from '@borrifo/game-content';
import type { ServerConfig } from './config';
import { CredentialVerifier } from './auth';
import { log } from './logger';
import { JsonlResultSink, type ResultSink } from './results';
import { ArenaRoom } from './rooms/ArenaRoom';
import { loadStaticWorld } from './world';
import { KeyedRateLimiter } from './rateLimit';

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
  await loadStaticWorld(DEFAULT_MAP_ID);
  ArenaRoom.joinLimiter = new KeyedRateLimiter(cfg.joinRateBurst, cfg.joinRatePerSecond);
  ArenaRoom.deps = {
    verifier: new CredentialVerifier(cfg),
    sink: opts.sink ?? new JsonlResultSink(cfg.resultsFile),
    roundDurationSeconds: cfg.roundDurationSeconds,
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
  log('info', 'server.listening', { port, authMode: cfg.authMode, allowedOrigins: cfg.allowedOrigins });
  return {
    server,
    port,
    async shutdown() {
      await server.gracefullyShutdown(false);
    },
  };
}
