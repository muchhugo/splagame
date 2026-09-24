import { ActivityClient, createStandaloneDevHost, MatchCredentialResponseSchema, HostRequestError, type ActivityContext } from '@borrifo/activity-sdk';
import { GAME_ID } from '@borrifo/game-contracts';
import { CLIENT_CONFIG } from '../config';

/** Lê o nonce do fragmento (não vai ao servidor) e o remove da URL. */
export function readHandshakeFragment(): { nonce: string | null; sid: string | null } {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const nonce = h.get('nonce');
  const sid = h.get('sid');
  if (nonce) history.replaceState(null, '', location.pathname + location.search);
  return { nonce, sid };
}

export function isEmbedded(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

/** Host real ou de laboratório: iframe + handshake validado. */
export async function connectEmbedded(nonce: string): Promise<ActivityClient> {
  return ActivityClient.connect({ allowedHostOrigins: CLIENT_CONFIG.allowedHostOrigins, nonce, timeoutMs: 10000 });
}

export const DEV_USERS = [
  { id: 'ana', name: 'Ana' },
  { id: 'bruno', name: 'Bruno' },
  { id: 'carla', name: 'Carla' },
  { id: 'davi', name: 'Davi' },
  { id: 'elis', name: 'Elis' },
  { id: 'fabio', name: 'Fábio' },
  { id: 'gabi', name: 'Gabi' },
  { id: 'hugo', name: 'Hugo (sem acesso)' },
];

/**
 * Rota standalone de DESENVOLVIMENTO: o próprio documento faz o papel de host
 * pelo mesmo contrato. Só existe quando habilitada no build (nunca por parâmetro de URL).
 */
export function connectStandaloneDev(userId: string, displayName: string, activitySessionId: string): ActivityClient {
  if (!CLIENT_CONFIG.standaloneDevHostEnabled) throw new Error('host de desenvolvimento desabilitado neste build');
  const context: ActivityContext = {
    protocolVersion: 1,
    activityId: GAME_ID,
    activitySessionId,
    channelId: 'canal-arena-dev',
    viewer: { id: userId, displayName },
    capabilities: { canCreateMatch: true, canJoinMatch: true, canInvite: false, canUseVoice: false },
    locale: 'pt-BR',
    theme: 'dark',
    hostKind: 'standalone-dev',
  };
  const { client } = createStandaloneDevHost({
    context,
    fetchCredential: async (sid) => {
      const res = await fetch(`${CLIENT_CONFIG.labBackendUrl}/api/lab/standalone-credential`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, activitySessionId: sid }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new HostRequestError(res.status === 403 ? 'forbidden' : 'backend_error', String((body as { error?: string }).error ?? `HTTP ${res.status}`));
      return MatchCredentialResponseSchema.parse(body);
    },
    onClose: () => location.reload(),
  });
  return client;
}
