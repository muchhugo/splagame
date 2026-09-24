/**
 * Claims da credencial curta de partida (JWT). Emitida pelo backend confiável do
 * host (no laboratório: backend de desenvolvimento do activity-shell), validada
 * pelo servidor de partidas. Nunca contém tokens de sessão do Trivo.
 */
export interface MatchCredentialClaims {
  /** userId do Trivo (ou do laboratório). */
  sub: string;
  /** activitySessionId ao qual a credencial está vinculada. */
  sid: string;
  /** Nome de exibição (perfil do Trivo). */
  name: string;
  /** Apelido do usuário NESTA comunidade (tem prioridade sobre o nome de exibição). */
  nick?: string;
  /** Nome de usuário (último recurso quando não há apelido nem nome de exibição). */
  uname?: string;
  /** URL https do avatar; o servidor só repassa se o host for permitido (AVATAR_ALLOWED_HOSTS). */
  avatar?: string;
  /** Canal/comunidade de origem (informativo). */
  ch?: string;
  /** Emissor. Credenciais de desenvolvimento usam DEV_CREDENTIAL_ISSUER. */
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
  /** Capacidades verificadas pelo backend para esta sessão. */
  cap: { join: boolean; create: boolean };
}

export const DEV_CREDENTIAL_ISSUER = 'trivo-activities-lab:dev';
/** Validade máxima aceita pelo servidor de partidas (s). */
export const MATCH_CREDENTIAL_MAX_TTL_SECONDS = 120;

/** Limite de caracteres dos nomes mostrados no jogo. */
export const DISPLAY_NAME_MAX = 24;

const NAME_CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]', 'g');

/**
 * Nome exibível: sem caracteres de controle ou de direção, sem `<` `>`, espaços
 * normalizados e tamanho limitado. É texto puro: a interface nunca o trata como
 * HTML (React escapa) e o 3D o desenha como texto.
 */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return [...raw.normalize('NFC').replace(NAME_CONTROL_CHARS, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()].slice(0, DISPLAY_NAME_MAX).join('').trim();
}

/** Prioridade pedida pelo Trivo: apelido da comunidade → nome de exibição → nome de usuário. */
export function resolveDisplayName(p: { nickname?: unknown; displayName?: unknown; username?: unknown }, fallback = 'Jogador'): string {
  return cleanName(p.nickname) || cleanName(p.displayName) || cleanName(p.username) || fallback;
}

/** Avatar só por https e de um host explicitamente permitido; qualquer outra coisa vira "sem avatar". */
export function sanitizeAvatarUrl(raw: unknown, allowedHosts: readonly string[]): string | null {
  if (typeof raw !== 'string' || raw.length > 512 || !allowedHosts.length) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return allowedHosts.includes(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}
