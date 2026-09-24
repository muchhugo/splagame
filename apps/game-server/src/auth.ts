import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { DEV_CREDENTIAL_ISSUER, MATCH_CREDENTIAL_AUDIENCE, MATCH_CREDENTIAL_MAX_TTL_SECONDS, type MatchCredentialClaims } from '@borrifo/game-contracts';
import type { ServerConfig } from './config';

export class AuthError extends Error {
  constructor(
    readonly code: 'invalid_credential' | 'expired' | 'replayed' | 'wrong_session' | 'forbidden',
    message: string,
  ) {
    super(message);
  }
}

export interface VerifiedIdentity {
  userId: string;
  displayName: string;
  activitySessionId: string;
  jti: string;
  expiresAt: number;
  canCreate: boolean;
}

/** Registro de jti já usados (anti-replay), com expiração pelo exp da credencial. */
export class JtiRegistry {
  private used = new Map<string, number>();
  consume(jti: string, expiresAtSec: number): boolean {
    const now = Date.now() / 1000;
    if (this.used.size > 5000) for (const [k, exp] of this.used) if (exp < now) this.used.delete(k);
    if (this.used.has(jti)) return false;
    this.used.set(jti, expiresAtSec);
    return true;
  }
}

/**
 * Verifica a credencial curta de partida. Dev: HS256 com segredo local e emissor
 * de desenvolvimento. Produção (host real): JWKS do backend do Trivo, emissor
 * configurado — credenciais de desenvolvimento são rejeitadas.
 */
export class CredentialVerifier {
  private readonly key: Uint8Array | JWTVerifyGetKey;
  private readonly issuer: string;
  readonly jtis = new JtiRegistry();

  constructor(private readonly cfg: ServerConfig) {
    if (cfg.authMode === 'dev-hs256') {
      this.key = new TextEncoder().encode(cfg.devSecret!);
      this.issuer = DEV_CREDENTIAL_ISSUER;
    } else {
      this.key = createRemoteJWKSet(new URL(cfg.jwksUrl!));
      this.issuer = cfg.expectedIssuer ?? 'trivo';
      if (this.issuer === DEV_CREDENTIAL_ISSUER) throw new Error('emissor de desenvolvimento não pode ser usado em modo jwks');
    }
  }

  async verify(token: string, activitySessionId: string): Promise<VerifiedIdentity> {
    let payload: Partial<MatchCredentialClaims>;
    try {
      const res = await jwtVerify(token, this.key as Uint8Array, {
        issuer: this.issuer,
        audience: MATCH_CREDENTIAL_AUDIENCE,
        algorithms: this.cfg.authMode === 'dev-hs256' ? ['HS256'] : ['ES256', 'RS256', 'EdDSA'],
        maxTokenAge: `${MATCH_CREDENTIAL_MAX_TTL_SECONDS}s`,
        requiredClaims: ['sub', 'exp', 'iat', 'jti'],
      });
      payload = res.payload as Partial<MatchCredentialClaims>;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'ERR_JWT_EXPIRED') throw new AuthError('expired', 'credencial expirada');
      throw new AuthError('invalid_credential', 'credencial inválida');
    }
    if (typeof payload.sid !== 'string' || payload.sid !== activitySessionId) throw new AuthError('wrong_session', 'credencial de outra sessão');
    if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) throw new AuthError('invalid_credential', 'sub inválido');
    if (!payload.cap || payload.cap.join !== true) throw new AuthError('forbidden', 'sem permissão para entrar');
    if (typeof payload.exp !== 'number' || typeof payload.jti !== 'string') throw new AuthError('invalid_credential', 'claims ausentes');
    if (!this.jtis.consume(payload.jti, payload.exp)) throw new AuthError('replayed', 'credencial já utilizada');
    return {
      userId: payload.sub,
      displayName: sanitizeDisplayName(typeof payload.name === 'string' ? payload.name : 'Jogador'),
      activitySessionId: payload.sid,
      jti: payload.jti,
      expiresAt: payload.exp,
      canCreate: payload.cap.create === true,
    };
  }
}

/** Nome exibível: sem controle, sem marcação, tamanho limitado. O cliente também escapa ao exibir. */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]', 'g');

export function sanitizeDisplayName(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 24);
  return cleaned.length ? cleaned : 'Jogador';
}
