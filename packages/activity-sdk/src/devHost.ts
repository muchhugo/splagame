import { ActivityClient } from './ActivityClient';
import { ActivityHost } from './ActivityHost';
import { randomNonce, type ActivityContext, type MatchCredentialResponse, type VoiceState } from './protocol';

export const VOICE_NOT_CONFIGURED: VoiceState = { available: false, reason: 'not_configured', connected: false, muted: true, scope: 'none', participants: [] };

/**
 * Host de DESENVOLVIMENTO no mesmo documento (rota standalone do jogo).
 * Usa exatamente o mesmo contrato do host real, por um MessageChannel local.
 * Deve ser incluído no bundle apenas em builds de desenvolvimento.
 */
export function createStandaloneDevHost(opts: {
  context: ActivityContext;
  fetchCredential: (activitySessionId: string) => Promise<MatchCredentialResponse>;
  onClose?: () => void;
}): { client: ActivityClient; host: ActivityHost } {
  const nonce = randomNonce();
  const host = new ActivityHost({
    activityOrigin: location.origin,
    nonce,
    context: opts.context,
    voice: VOICE_NOT_CONFIGURED,
    handlers: {
      requestMatchCredential: (p) => opts.fetchCredential(p.activitySessionId),
      requestFullscreen: async (p) => {
        if (p.enter && !document.fullscreenElement) await document.documentElement.requestFullscreen();
        if (!p.enter && document.fullscreenElement) await document.exitFullscreen();
        return { fullscreen: !!document.fullscreenElement };
      },
      requestClose: () => opts.onClose?.(),
    },
  });
  const port = host.connectLocal();
  const client = ActivityClient.fromPort(port, nonce, host.initPayload());
  return { client, host };
}
