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
  maxRooms: number;
  roundDurationSeconds: number;
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
  return {
    port: Number(env.GAME_SERVER_PORT ?? 2567),
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
    maxRooms: Number(env.MAX_ROOMS ?? 50),
    roundDurationSeconds: Number(env.ROUND_DURATION_SECONDS ?? 180),
  };
}
