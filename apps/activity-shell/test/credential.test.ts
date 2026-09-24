import { describe, expect, it } from 'vitest';
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { DEV_CREDENTIAL_ISSUER, MATCH_CREDENTIAL_AUDIENCE, MATCH_CREDENTIAL_MAX_TTL_SECONDS } from '@borrifo/game-contracts';
import { DEV_MATCH_CREDENTIAL_TTL_SECONDS, issueDevMatchCredential } from '../lib/credential';
import { LabError } from '../lib/errors';
import { channelMemberIds, isChannelMember, LAB_CHANNEL_ID, LAB_ROSTER } from '../lib/roster';
import { signLabSession, verifyLabSession } from '../lib/session';
import { TokenBucketLimiter } from '../lib/rateLimit';
import { parseLabConfig } from '../lib/config';
import { buildActivitySrc, newActivitySessionId } from '../lib/activityUrl';

const SECRET = 'x'.repeat(40);
const OTHER_SECRET = 'y'.repeat(40);
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const base = { secret: SECRET, nodeEnv: 'development', gameServerUrl: 'http://localhost:2567', nowMs: NOW };
const key = (s: string) => new TextEncoder().encode(s);

async function expectLabError(p: Promise<unknown>, status: number, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LabError);
  expect((err as LabError).status).toBe(status);
  expect((err as LabError).code).toBe(code);
}

describe('issueDevMatchCredential', () => {
  it('emite JWT HS256 com as claims do contrato', async () => {
    const res = await issueDevMatchCredential({ ...base, userId: 'fabio', activitySessionId: 'sessao-dev-1', jti: 'jti-fixo' });
    expect(res.gameServerUrl).toBe('http://localhost:2567');
    expect(decodeProtectedHeader(res.credential).alg).toBe('HS256');

    const { payload } = await jwtVerify(res.credential, key(SECRET), {
      algorithms: ['HS256'],
      issuer: DEV_CREDENTIAL_ISSUER,
      audience: MATCH_CREDENTIAL_AUDIENCE,
      currentDate: new Date(NOW + 1000),
      maxTokenAge: `${MATCH_CREDENTIAL_MAX_TTL_SECONDS}s`,
      requiredClaims: ['sub', 'exp', 'iat', 'jti'],
    });
    expect(payload).toMatchObject({
      sub: 'fabio',
      sid: 'sessao-dev-1',
      // perfil sem nome de exibição: o servidor cai no nome de usuário
      name: '',
      uname: 'fabio_22',
      ch: LAB_CHANNEL_ID,
      cap: { join: true, create: true },
      iss: DEV_CREDENTIAL_ISSUER,
      aud: MATCH_CREDENTIAL_AUDIENCE,
      jti: 'jti-fixo',
      iat: NOW / 1000,
      exp: NOW / 1000 + DEV_MATCH_CREDENTIAL_TTL_SECONDS,
    });
    expect(payload.nick).toBeUndefined();
    expect(DEV_MATCH_CREDENTIAL_TTL_SECONDS).toBe(60);
    const ana = await issueDevMatchCredential({ ...base, userId: 'ana', activitySessionId: 'sessao-dev-1' });
    expect(decodeJwt(ana.credential)).toMatchObject({ name: 'Ana', nick: 'Aninha', uname: 'ana.souza' });
    expect(res.expiresAt).toBe((NOW / 1000 + 60) * 1000);
  });

  it('gera jti único por emissão', async () => {
    const a = await issueDevMatchCredential({ ...base, userId: 'ana', activitySessionId: 'sessao-dev-1' });
    const b = await issueDevMatchCredential({ ...base, userId: 'ana', activitySessionId: 'sessao-dev-1' });
    expect(decodeJwt(a.credential).jti).not.toBe(decodeJwt(b.credential).jti);
  });

  it('expira em 60 s e não valida com outro segredo', async () => {
    const { credential } = await issueDevMatchCredential({ ...base, userId: 'ana', activitySessionId: 'sessao-dev-1' });
    await expect(jwtVerify(credential, key(SECRET), { currentDate: new Date(NOW + 61_000) })).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' });
    await expect(jwtVerify(credential, key(OTHER_SECRET), { currentDate: new Date(NOW) })).rejects.toMatchObject({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' });
  });

  it('recusa NODE_ENV=production', async () => {
    await expectLabError(issueDevMatchCredential({ ...base, nodeEnv: 'production', userId: 'ana', activitySessionId: 'sessao-dev-1' }), 403, 'dev_disabled_in_production');
  });

  it('aplica a ACL do canal: hugo não é membro (403)', async () => {
    expect(isChannelMember('hugo')).toBe(false);
    expect(channelMemberIds()).toEqual(LAB_ROSTER.map((u) => u.id).filter((id) => id !== 'hugo'));
    await expectLabError(issueDevMatchCredential({ ...base, userId: 'hugo', activitySessionId: 'sessao-dev-1' }), 403, 'forbidden');
  });

  it('recusa usuário fora do roster', async () => {
    await expectLabError(issueDevMatchCredential({ ...base, userId: 'mallory', activitySessionId: 'sessao-dev-1' }), 403, 'unknown_user');
  });

  it.each(['abc', 'Sessao-1', 'sessão-1', 'a'.repeat(65), 'sess_1', 'sess 1', '../x'])('recusa activitySessionId inválido: %s', async (sid) => {
    await expectLabError(issueDevMatchCredential({ ...base, userId: 'ana', activitySessionId: sid }), 400, 'invalid_session');
  });

  it('recusa segredo ausente ou curto', async () => {
    await expectLabError(issueDevMatchCredential({ ...base, secret: 'curto', userId: 'ana', activitySessionId: 'sessao-dev-1' }), 500, 'misconfigured');
    await expectLabError(issueDevMatchCredential({ ...base, secret: null, userId: 'ana', activitySessionId: 'sessao-dev-1' }), 500, 'misconfigured');
  });

  it('não permite validade acima do máximo aceito pelo servidor de partidas', async () => {
    await expectLabError(
      issueDevMatchCredential({ ...base, userId: 'ana', activitySessionId: 'sessao-dev-1', ttlSeconds: MATCH_CREDENTIAL_MAX_TTL_SECONDS + 1 }),
      500,
      'misconfigured',
    );
  });
});

describe('sessão do laboratório', () => {
  it('assina e verifica o cookie de sessão; expira em 12 h', async () => {
    const { token, user } = await signLabSession({ userId: 'carla', secret: SECRET, nodeEnv: 'development', nowMs: NOW });
    expect(user.displayName).toBe('Carla');
    expect(await verifyLabSession(token, SECRET, NOW + 1000)).toMatchObject({ id: 'carla', displayName: 'Carla', nickname: 'Carla ✨' });
    expect(await verifyLabSession(token, SECRET, NOW + 12 * 3600 * 1000 + 1000)).toBeNull();
    expect(await verifyLabSession(token, OTHER_SECRET, NOW)).toBeNull();
    expect(await verifyLabSession('lixo', SECRET, NOW)).toBeNull();
  });

  it('não aceita uma credencial de partida como sessão', async () => {
    const { credential } = await issueDevMatchCredential({ ...base, userId: 'ana', activitySessionId: 'sessao-dev-1' });
    expect(await verifyLabSession(credential, SECRET, NOW)).toBeNull();
  });

  it('recusa login de desenvolvimento em produção', async () => {
    await expectLabError(signLabSession({ userId: 'ana', secret: SECRET, nodeEnv: 'production' }), 403, 'dev_disabled_in_production');
  });
});

describe('TokenBucketLimiter', () => {
  it('bloqueia após a rajada e recarrega com o tempo', () => {
    let t = 0;
    const rl = new TokenBucketLimiter({ capacity: 3, refillPerMinute: 3, now: () => t });
    expect([rl.take('k'), rl.take('k'), rl.take('k')].every((r) => r.ok)).toBe(true);
    const blocked = rl.take('k');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBe(20);
    expect(rl.take('outra-chave').ok).toBe(true);
    t += 20_000;
    expect(rl.take('k').ok).toBe(true);
    expect(rl.take('k').ok).toBe(false);
  });
});

describe('configuração e URL da Atividade', () => {
  it('usa padrões, detecta LiveKit parcial e desliga standalone em produção', () => {
    const cfg = parseLabConfig({ DEV_MATCH_CREDENTIAL_SECRET: SECRET, LAB_SESSION_SECRET: SECRET, LAB_ENABLE_STANDALONE: '1', LIVEKIT_URL: 'wss://x' });
    expect(cfg.activityUrl).toBe('http://localhost:5173/');
    expect(cfg.activityOrigin).toBe('http://localhost:5173');
    expect(cfg.gameServerPublicUrl).toBe('http://localhost:2567');
    expect(cfg.standaloneEnabled).toBe(true);
    expect(cfg.livekit).toBeNull();
    expect(cfg.problems.some((p) => p.includes('LiveKit'))).toBe(true);
    const prod = parseLabConfig({ NODE_ENV: 'production', LAB_ENABLE_STANDALONE: '1', DEV_MATCH_CREDENTIAL_SECRET: 'curto' });
    expect(prod.standaloneEnabled).toBe(false);
    expect(prod.devMatchSecret).toBeNull();
  });

  it('coloca nonce e sessão no fragmento da URL', () => {
    expect(buildActivitySrc('http://localhost:5173/', 'abcdef0123456789', 'sessao-dev-1')).toBe('http://localhost:5173/#nonce=abcdef0123456789&sid=sessao-dev-1');
    expect(newActivitySessionId()).toMatch(/^sess-[0-9a-f]{8}$/);
  });
});
