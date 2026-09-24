import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { issueDevMatchCredential } from '@/lib/credential';
import { LabError } from '@/lib/errors';
import { LAB_USER_IDS } from '@/lib/roster';
import { clientIp, errorResponse, getLabConfig, json, limiters, parseBody, rateLimit, readJson, userKeyFrom } from '@/lib/server/lab';
import type { LabConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rota EXCLUSIVA de desenvolvimento: o jogo aberto diretamente (fora do iframe)
 * pede credencial aqui, sem cookie, escolhendo um usuário do roster fictício.
 * Só funciona com LAB_ENABLE_STANDALONE=1, fora de produção e a partir da
 * origem exata LAB_GAME_ORIGIN (CORS sem credenciais).
 */
const Body = z
  .object({
    userId: z.enum(LAB_USER_IDS as [string, ...string[]]),
    activitySessionId: z.string().min(1).max(128),
  })
  .strict();

function gate(req: NextRequest): { cfg: LabConfig; cors: Record<string, string> } {
  const cfg = getLabConfig();
  if (!cfg.standaloneEnabled) {
    throw new LabError(403, 'standalone_disabled', 'Rota standalone desativada (exige LAB_ENABLE_STANDALONE=1 e NODE_ENV diferente de production).');
  }
  const origin = req.headers.get('origin');
  if (!origin || origin !== cfg.labGameOrigin) {
    throw new LabError(403, 'origin_forbidden', 'Origem não autorizada para a rota standalone.');
  }
  return {
    cfg,
    cors: {
      'Access-Control-Allow-Origin': cfg.labGameOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  };
}

export function OPTIONS(req: NextRequest) {
  try {
    const { cors } = gate(req);
    return new NextResponse(null, { status: 204, headers: { ...cors, 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e, { Vary: 'Origin' });
  }
}

export async function POST(req: NextRequest) {
  let cors: Record<string, string> = { Vary: 'Origin' };
  try {
    const g = gate(req);
    cors = g.cors;
    const raw = await readJson(req);
    rateLimit(limiters.standalone, `${clientIp(req)}|${userKeyFrom(raw)}`);
    const body = parseBody(Body, raw);
    const cred = await issueDevMatchCredential({
      userId: body.userId,
      activitySessionId: body.activitySessionId,
      secret: g.cfg.devMatchSecret,
      nodeEnv: g.cfg.nodeEnv,
      gameServerUrl: g.cfg.gameServerPublicUrl,
    });
    return json(cred, 200, cors);
  } catch (e) {
    return errorResponse(e, cors);
  }
}
