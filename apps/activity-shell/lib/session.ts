import { jwtVerify, SignJWT } from 'jose';
import { assertNotProduction, LabError } from './errors';
import { MIN_SECRET_LENGTH } from './credential';
import { findLabUser, type LabUser } from './roster';

/** Cookie httpOnly com a sessão de desenvolvimento do shell (JWT HS256). */
export const LAB_SESSION_COOKIE = 'lab_session';
export const LAB_SESSION_TTL_SECONDS = 12 * 60 * 60;
const LAB_SESSION_ISSUER = 'borrifo-activity-shell:lab-dev';
const LAB_SESSION_AUDIENCE = 'borrifo-activity-shell';

function key(secret: string | null | undefined): Uint8Array {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new LabError(500, 'misconfigured', 'LAB_SESSION_SECRET ausente ou curto (mínimo 32 caracteres). Veja .env.example.');
  }
  return new TextEncoder().encode(secret);
}

export async function signLabSession(opts: { userId: string; secret: string | null | undefined; nodeEnv: string | undefined; nowMs?: number }): Promise<{ token: string; user: LabUser }> {
  assertNotProduction(opts.nodeEnv);
  const user = findLabUser(opts.userId);
  if (!user) throw new LabError(400, 'unknown_user', 'Usuário desconhecido no roster do laboratório.');
  const iat = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(LAB_SESSION_ISSUER)
    .setAudience(LAB_SESSION_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + LAB_SESSION_TTL_SECONDS)
    .sign(key(opts.secret));
  return { token, user };
}

/** Devolve o usuário da sessão ou null (token ausente, inválido, expirado ou de usuário fora do roster). */
export async function verifyLabSession(token: string | undefined, secret: string | null | undefined, nowMs?: number): Promise<LabUser | null> {
  if (!token || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      issuer: LAB_SESSION_ISSUER,
      audience: LAB_SESSION_AUDIENCE,
      requiredClaims: ['sub', 'exp', 'iat'],
      ...(nowMs !== undefined ? { currentDate: new Date(nowMs) } : {}),
    });
    return typeof payload.sub === 'string' ? (findLabUser(payload.sub) ?? null) : null;
  } catch (e) {
    if (e instanceof LabError) throw e;
    return null;
  }
}
