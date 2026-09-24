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
  /** Nome de exibição já saneado pelo host. */
  name: string;
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
