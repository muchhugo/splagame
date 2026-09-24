import { MIN_SECRET_LENGTH } from './credential';

export interface LabConfig {
  nodeEnv: string;
  isProduction: boolean;
  /** null quando ausente ou curto (< 32). */
  devMatchSecret: string | null;
  labSessionSecret: string | null;
  activityUrl: string;
  activityOrigin: string;
  gameServerPublicUrl: string;
  standaloneEnabled: boolean;
  labGameOrigin: string;
  livekit: { url: string; apiKey: string; apiSecret: string } | null;
  /** Avisos de configuração exibidos na página (nunca contêm valores secretos). */
  problems: string[];
}

type Env = Record<string, string | undefined>;

function nonEmpty(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function httpUrl(raw: string | undefined, fallback: string, name: string, problems: string[]): URL {
  const value = nonEmpty(raw) ?? fallback;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocolo');
    return u;
  } catch {
    problems.push(`${name} inválida; usando ${fallback}.`);
    return new URL(fallback);
  }
}

/** Lê a configuração do laboratório a partir de um objeto de ambiente (puro; testável). */
export function parseLabConfig(env: Env): LabConfig {
  const problems: string[] = [];
  const nodeEnv = env.NODE_ENV ?? 'development';
  const secret = (name: string) => {
    const v = nonEmpty(env[name]);
    if (!v) {
      problems.push(`${name} não definido (veja .env.example).`);
      return null;
    }
    if (v.length < MIN_SECRET_LENGTH) {
      problems.push(`${name} curto demais (mínimo ${MIN_SECRET_LENGTH} caracteres).`);
      return null;
    }
    return v;
  };
  const devMatchSecret = secret('DEV_MATCH_CREDENTIAL_SECRET');
  const labSessionSecret = secret('LAB_SESSION_SECRET');
  const activity = httpUrl(env.ACTIVITY_URL, 'http://localhost:5173/', 'ACTIVITY_URL', problems);
  const gameServer = httpUrl(env.GAME_SERVER_PUBLIC_URL, 'http://localhost:2567', 'GAME_SERVER_PUBLIC_URL', problems);
  const labGameOrigin = httpUrl(env.LAB_GAME_ORIGIN, 'http://localhost:5173', 'LAB_GAME_ORIGIN', problems).origin;

  const lkUrl = nonEmpty(env.LIVEKIT_URL);
  const lkKey = nonEmpty(env.LIVEKIT_API_KEY);
  const lkSecret = nonEmpty(env.LIVEKIT_API_SECRET);
  const lkCount = [lkUrl, lkKey, lkSecret].filter(Boolean).length;
  if (lkCount > 0 && lkCount < 3) problems.push('LiveKit parcialmente configurado: defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET.');

  if (nodeEnv === 'production') problems.push('NODE_ENV=production: login e credenciais de desenvolvimento estão desativados.');

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    devMatchSecret,
    labSessionSecret,
    activityUrl: activity.href,
    activityOrigin: activity.origin,
    gameServerPublicUrl: gameServer.href.replace(/\/$/, ''),
    standaloneEnabled: env.LAB_ENABLE_STANDALONE === '1' && nodeEnv !== 'production',
    labGameOrigin,
    livekit: lkUrl && lkKey && lkSecret ? { url: lkUrl, apiKey: lkKey, apiSecret: lkSecret } : null,
    problems,
  };
}
