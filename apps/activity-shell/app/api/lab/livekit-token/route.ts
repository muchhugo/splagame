import type { NextRequest } from 'next/server';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { z } from 'zod';
import { assertNotProduction, LabError } from '@/lib/errors';
import { isChannelMember, LAB_CHANNEL_ID } from '@/lib/roster';
import { clientIp, errorResponse, getLabConfig, json, limiters, parseBody, rateLimit, readJson, requireLabUser } from '@/lib/server/lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `viewerId` opcional: detecta troca de usuário em outra aba (o cookie é compartilhado). */
const Body = z.object({ viewerId: z.string().min(1).max(128).optional() }).strict();

/**
 * Token de acesso LiveKit para a chamada compartilhada do canal. A chave e o
 * segredo da API ficam no servidor; o navegador recebe só o JWT de 10 minutos.
 */
export async function POST(req: NextRequest) {
  try {
    const cfg = getLabConfig();
    assertNotProduction(cfg.nodeEnv);
    const user = await requireLabUser(req, cfg);
    if (!cfg.livekit) return json({ error: 'voz não configurada neste ambiente', code: 'voice_not_configured' }, 501);
    rateLimit(limiters.livekit, `${clientIp(req)}|${user.id}`);
    const body = parseBody(Body, await readJson(req));
    if (body.viewerId && body.viewerId !== user.id) {
      throw new LabError(409, 'session_changed', 'A sessão do laboratório mudou em outra aba. Escolha o usuário novamente nesta aba.');
    }
    // A chamada é a do canal: quem não é membro não entra (mesma ACL da partida).
    if (!isChannelMember(user.id, LAB_CHANNEL_ID)) throw new LabError(403, 'forbidden', `Usuário sem acesso ao canal #${LAB_CHANNEL_ID}.`);

    const at = new AccessToken(cfg.livekit.apiKey, cfg.livekit.apiSecret, { identity: user.id, name: user.displayName, ttl: '10m' });
    at.addGrant({
      roomJoin: true,
      room: LAB_CHANNEL_ID,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      // Somente voz: nada de câmera ou compartilhamento de tela.
      canPublishSources: [TrackSource.MICROPHONE],
    });
    return json({ token: await at.toJwt(), url: cfg.livekit.url });
  } catch (e) {
    return errorResponse(e);
  }
}
