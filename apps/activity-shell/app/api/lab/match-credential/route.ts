import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { issueDevMatchCredential } from '@/lib/credential';
import { assertNotProduction, LabError } from '@/lib/errors';
import { clientIp, errorResponse, getLabConfig, json, limiters, parseBody, rateLimit, readJson, requireLabUser } from '@/lib/server/lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    activitySessionId: z.string().min(1).max(128),
    /** Opcional: usuário que a aba acredita estar logado. Detecta troca de usuário em outra aba (cookie compartilhado). */
    viewerId: z.string().min(1).max(128).optional(),
  })
  .strict();

/**
 * Credencial curta de partida para a Atividade aberta pelo host do laboratório.
 * Exige o cookie lab_session; aplica a ACL fictícia do canal. O token nunca é registrado em log.
 */
export async function POST(req: NextRequest) {
  try {
    const cfg = getLabConfig();
    assertNotProduction(cfg.nodeEnv);
    const user = await requireLabUser(req, cfg);
    rateLimit(limiters.credential, `${clientIp(req)}|${user.id}`);
    const body = parseBody(Body, await readJson(req));
    if (body.viewerId && body.viewerId !== user.id) {
      throw new LabError(409, 'session_changed', 'A sessão do laboratório mudou em outra aba. Escolha o usuário novamente nesta aba.');
    }
    const cred = await issueDevMatchCredential({
      userId: user.id,
      activitySessionId: body.activitySessionId,
      secret: cfg.devMatchSecret,
      nodeEnv: cfg.nodeEnv,
      gameServerUrl: cfg.gameServerPublicUrl,
    });
    return json(cred);
  } catch (e) {
    return errorResponse(e);
  }
}
