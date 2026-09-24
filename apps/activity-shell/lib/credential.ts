import { SignJWT } from 'jose';
import {
  DEV_CREDENTIAL_ISSUER,
  MATCH_CREDENTIAL_AUDIENCE,
  MATCH_CREDENTIAL_MAX_TTL_SECONDS,
  type MatchCredentialClaims,
} from '@borrifo/game-contracts';
import { assertNotProduction, LabError } from './errors';
import { ACTIVITY_SESSION_ID_RE, findLabUser, isChannelMember, LAB_CHANNEL_ID } from './roster';

/** Validade da credencial de partida de desenvolvimento (s). */
export const DEV_MATCH_CREDENTIAL_TTL_SECONDS = 60;
export const MIN_SECRET_LENGTH = 32;

export interface IssueDevMatchCredentialInput {
  userId: string;
  activitySessionId: string;
  /** DEV_MATCH_CREDENTIAL_SECRET (≥ 32 caracteres). */
  secret: string | null | undefined;
  nodeEnv: string | undefined;
  gameServerUrl: string;
  /** Relógio injetável para testes (ms). */
  nowMs?: number;
  ttlSeconds?: number;
  /** jti injetável para testes; padrão: crypto.randomUUID(). */
  jti?: string;
}

/** Resposta devolvida à Atividade (mesmo formato de MatchCredentialResponse do activity-sdk). */
export interface DevMatchCredential {
  credential: string;
  /** Instante de expiração em milissegundos desde a época Unix (= exp * 1000). */
  expiresAt: number;
  gameServerUrl: string;
}

/**
 * Emite a credencial curta de partida do LABORATÓRIO (HS256, emissor de dev).
 * Aplica a ACL fictícia do canal. Recusa produção. Nunca registre o token.
 */
export async function issueDevMatchCredential(input: IssueDevMatchCredentialInput): Promise<DevMatchCredential> {
  assertNotProduction(input.nodeEnv);
  if (!input.secret || input.secret.length < MIN_SECRET_LENGTH) {
    throw new LabError(500, 'misconfigured', 'DEV_MATCH_CREDENTIAL_SECRET ausente ou curto (mínimo 32 caracteres). Veja .env.example.');
  }
  if (!ACTIVITY_SESSION_ID_RE.test(input.activitySessionId)) {
    throw new LabError(400, 'invalid_session', 'activitySessionId inválido (use a-z, 0-9 e hífen, 4 a 64 caracteres).');
  }
  const user = findLabUser(input.userId);
  if (!user) throw new LabError(403, 'unknown_user', 'Usuário desconhecido no roster do laboratório.');
  if (!isChannelMember(user.id, LAB_CHANNEL_ID)) {
    throw new LabError(403, 'forbidden', `Usuário sem acesso ao canal #${LAB_CHANNEL_ID}.`);
  }
  const ttl = input.ttlSeconds ?? DEV_MATCH_CREDENTIAL_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > MATCH_CREDENTIAL_MAX_TTL_SECONDS) {
    throw new LabError(500, 'misconfigured', `Validade da credencial fora do limite (1..${MATCH_CREDENTIAL_MAX_TTL_SECONDS}s).`);
  }

  const iat = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const exp = iat + ttl;
  const claims: MatchCredentialClaims = {
    sub: user.id,
    sid: input.activitySessionId,
    name: user.displayName,
    ...(user.nickname ? { nick: user.nickname } : {}),
    uname: user.username,
    ch: LAB_CHANNEL_ID,
    cap: { join: true, create: true },
    iss: DEV_CREDENTIAL_ISSUER,
    aud: MATCH_CREDENTIAL_AUDIENCE,
    iat,
    exp,
    jti: input.jti ?? crypto.randomUUID(),
  };
  const { sub, iss, aud, jti, sid, name, nick, uname, ch, cap } = claims;
  const credential = await new SignJWT({ sid, name, ...(nick ? { nick } : {}), ...(uname ? { uname } : {}), ch, cap })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(new TextEncoder().encode(input.secret));

  return { credential, expiresAt: exp * 1000, gameServerUrl: input.gameServerUrl };
}
