import { RECONNECT_WINDOW_SECONDS } from '@borrifo/game-contracts';
import { MODES } from '@borrifo/game-content';
/**
 * Configuração do servidor de partidas a partir do ambiente.
 * Credenciais de desenvolvimento NUNCA são aceitas com NODE_ENV=production.
 */
export type AuthMode = 'dev-hs256' | 'jwks';

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: string;
  authMode: AuthMode;
  devSecret: string | null;
  jwksUrl: string | null;
  expectedIssuer: string | null;
  allowedOrigins: string[];
  resultsFile: string;
  /** Onde gravar resultados: arquivo JSONL (laboratório) ou PostgreSQL (produção). */
  resultSink: 'jsonl' | 'postgres';
  databaseUrl: string | null;
  databaseSsl: boolean;
  maxRooms: number;
  roundDurationSeconds: number;
  /** Duração do Correio do Ara (s); padrão do modo, ajustável para testes. */
  correioDurationSeconds: number;
  /** Janela de reconexão (s); ao expirar durante a rodada, o slot vira bot. Ajustável para testes. */
  reconnectWindowSeconds: number;
  joinRateBurst: number;
  /** Proxies reversos confiáveis (IP ou CIDR), separados por vírgula. Vazio: vale o socket. */
  trustedProxies: string;
  joinRatePerSecond: number;
  /** Hosts de onde avatares podem vir (https). Vazio = ninguém tem avatar por URL; a interface usa iniciais. */
  avatarAllowedHosts: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const authMode = (env.MATCH_AUTH_MODE ?? 'dev-hs256') as AuthMode;
  if (authMode !== 'dev-hs256' && authMode !== 'jwks') throw new Error(`MATCH_AUTH_MODE inválido: ${authMode}`);
  if (authMode === 'dev-hs256' && nodeEnv === 'production') {
    throw new Error('MATCH_AUTH_MODE=dev-hs256 é proibido com NODE_ENV=production. Configure MATCH_AUTH_MODE=jwks.');
  }
  const devSecret = authMode === 'dev-hs256' ? env.DEV_MATCH_CREDENTIAL_SECRET ?? null : null;
  if (authMode === 'dev-hs256' && (!devSecret || devSecret.length < 32)) {
    throw new Error('DEV_MATCH_CREDENTIAL_SECRET ausente ou curto (mínimo 32 caracteres). Veja .env.example.');
  }
  const jwksUrl = authMode === 'jwks' ? env.MATCH_CREDENTIAL_JWKS_URL ?? null : null;
  if (authMode === 'jwks' && !jwksUrl) throw new Error('MATCH_CREDENTIAL_JWKS_URL é obrigatório em modo jwks.');
  /** Número da configuração: finito e dentro da faixa, senão o servidor não sobe (erro claro). */
  const num = (name: string, def: number, min: number, max: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name} inválido ("${raw}"): use um número entre ${min} e ${max}.`);
    return v;
  };
  // produção grava no banco; o JSONL é só de laboratório (ADR 0006)
  const resultSink = (env.RESULT_SINK ?? (nodeEnv === 'production' ? 'postgres' : 'jsonl')) as 'jsonl' | 'postgres';
  if (resultSink !== 'jsonl' && resultSink !== 'postgres') throw new Error(`RESULT_SINK inválido: ${resultSink}`);
  if (resultSink === 'jsonl' && nodeEnv === 'production') throw new Error('RESULT_SINK=jsonl é só de laboratório; em produção use RESULT_SINK=postgres com DATABASE_URL.');
  const databaseUrl = env.DATABASE_URL || null;
  if (resultSink === 'postgres' && !databaseUrl) throw new Error('RESULT_SINK=postgres exige DATABASE_URL.');
  return {
    port: num('GAME_SERVER_PORT', 2567, 1, 65535),
    host: env.GAME_SERVER_HOST ?? '0.0.0.0',
    nodeEnv,
    authMode,
    devSecret,
    jwksUrl,
    expectedIssuer: env.MATCH_CREDENTIAL_ISSUER ?? null,
    allowedOrigins: (env.GAME_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    resultsFile: env.RESULTS_FILE ?? 'data/results.jsonl',
    resultSink,
    databaseUrl,
    databaseSsl: env.DATABASE_SSL === '1',
    maxRooms: num('MAX_ROOMS', 50, 1, 10_000),
    roundDurationSeconds: num('ROUND_DURATION_SECONDS', 180, 1, 3600),
    correioDurationSeconds: num('CORREIO_DURATION_SECONDS', MODES.correio.durationSeconds ?? 240, 1, 3600),
    reconnectWindowSeconds: num('RECONNECT_WINDOW_SECONDS', RECONNECT_WINDOW_SECONDS, 1, 120),
    joinRateBurst: num('JOIN_RATE_BURST', 10, 1, 100_000),
    trustedProxies: env.TRUSTED_PROXIES ?? '',
    joinRatePerSecond: num('JOIN_RATE_PER_SECOND', 1, 0.01, 100_000),
    avatarAllowedHosts: (env.AVATAR_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}
