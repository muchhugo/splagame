import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { DEV_CREDENTIAL_ISSUER, MATCH_CREDENTIAL_AUDIENCE } from '@borrifo/game-contracts';

export const TEST_DEV_SECRET = 'test-secret-apenas-para-testes-locais-0123456789';

export interface DevCredentialInput {
  userId: string;
  name: string;
  activitySessionId: string;
  ttlSeconds?: number;
  issuer?: string;
  audience?: string;
  join?: boolean;
  jti?: string;
  iatOffsetSeconds?: number;
  /** Perfil: apelido da comunidade, nome de usuário e avatar. */
  nick?: string;
  uname?: string;
  avatar?: string;
}

/** Emite credencial de partida de DESENVOLVIMENTO (HS256). Uso exclusivo em testes/laboratório. */
export async function issueDevCredential(secret: string, i: DevCredentialInput): Promise<string> {
  const now = Math.floor(Date.now() / 1000) + (i.iatOffsetSeconds ?? 0);
  return new SignJWT({ sid: i.activitySessionId, name: i.name, ...(i.nick !== undefined ? { nick: i.nick } : {}), ...(i.uname !== undefined ? { uname: i.uname } : {}), ...(i.avatar !== undefined ? { avatar: i.avatar } : {}), cap: { join: i.join ?? true, create: true } })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(i.userId)
    .setIssuer(i.issuer ?? DEV_CREDENTIAL_ISSUER)
    .setAudience(i.audience ?? MATCH_CREDENTIAL_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + (i.ttlSeconds ?? 60))
    .setJti(i.jti ?? randomUUID())
    .sign(new TextEncoder().encode(secret));
}
