import type { ActivityClient, VoiceState } from '@borrifo/activity-sdk';
import { VOICE_NOT_CONFIGURED } from '@borrifo/activity-sdk';

export type { VoiceState };

/**
 * Contrato limitado de voz visto pelo jogo. A conexão de mídia (LiveKit) é do
 * HOST: o jogo não cria outra captura de microfone, não recebe o objeto Room e
 * não controla volume. Fechar o jogo não sai da chamada.
 */
export interface VoiceAdapter {
  getState(): VoiceState;
  subscribe(cb: (s: VoiceState) => void): () => void;
  /** Pede ao host para alternar o mudo. O host decide e publica o novo estado. */
  requestToggleMute(): Promise<boolean>;
  dispose(): void;
}

/** Adaptador que fala com o host pela bridge da Atividade. */
export class HostVoiceAdapter implements VoiceAdapter {
  private state: VoiceState;
  private subs = new Set<(s: VoiceState) => void>();
  private off: () => void;

  constructor(private readonly client: ActivityClient) {
    this.state = client.voice;
    this.off = client.on('VOICE_STATE_UPDATED', (p) => {
      this.state = p.voice;
      for (const s of this.subs) s(this.state);
    });
  }

  getState() {
    return this.state;
  }

  subscribe(cb: (s: VoiceState) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  async requestToggleMute(): Promise<boolean> {
    if (!this.state.available || !this.client.context.capabilities.canUseVoice) return false;
    const r = await this.client.request<{ accepted: boolean }>('ACTIVITY_REQUEST_VOICE_ACTION', { action: 'toggle_mute' });
    return r.accepted;
  }

  dispose() {
    this.off();
    this.subs.clear();
  }
}

/** Sem voz: estado explícito "não configurada neste ambiente" (nada é simulado). */
export class NullVoiceAdapter implements VoiceAdapter {
  getState() {
    return VOICE_NOT_CONFIGURED;
  }
  subscribe() {
    return () => {};
  }
  async requestToggleMute() {
    return false;
  }
  dispose() {}
}
