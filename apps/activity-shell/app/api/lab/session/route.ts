import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertNotProduction } from '@/lib/errors';
import { accountName, isChannelMember, LAB_CHANNEL_ID, LAB_USER_IDS, type LabUser } from '@/lib/roster';
import { LAB_SESSION_COOKIE, LAB_SESSION_TTL_SECONDS, signLabSession } from '@/lib/session';
import { clientIp, errorResponse, getLabConfig, json, limiters, parseBody, rateLimit, readJson, requireLabUser } from '@/lib/server/lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LoginBody = z.object({ userId: z.enum(LAB_USER_IDS as [string, ...string[]]) }).strict();

function view(user: LabUser) {
  return { user: { id: user.id, displayName: accountName(user) }, channel: { id: LAB_CHANNEL_ID, member: isChannelMember(user.id) } };
}

/** Sessão atual do laboratório (cookie httpOnly). */
export async function GET(req: NextRequest) {
  try {
    const cfg = getLabConfig();
    assertNotProduction(cfg.nodeEnv);
    return json(view(await requireLabUser(req, cfg)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Login de DESENVOLVIMENTO: escolhe um usuário do roster fictício. Sem senha — por isso proibido em produção. */
export async function POST(req: NextRequest) {
  try {
    const cfg = getLabConfig();
    assertNotProduction(cfg.nodeEnv);
    rateLimit(limiters.session, clientIp(req));
    const body = parseBody(LoginBody, await readJson(req));
    const { token, user } = await signLabSession({ userId: body.userId, secret: cfg.labSessionSecret, nodeEnv: cfg.nodeEnv });
    const res = json(view(user));
    res.cookies.set(LAB_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: LAB_SESSION_TTL_SECONDS,
    });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

/** Logout: apaga o cookie. */
export async function DELETE() {
  const res = json({ ok: true });
  res.cookies.set(LAB_SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
