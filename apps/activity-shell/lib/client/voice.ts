import { VOICE_NOT_CONFIGURED, type VoiceState } from '@borrifo/activity-sdk';
import type { Participant, RemoteTrack, Room } from 'livekit-client';

type VoiceParticipant = VoiceState['participants'][number];
type VoiceReason = VoiceState['reason'];

export interface VoiceUiExtras {
  /** O navegador bloqueou a reprodução de áudio até um gesto do usuário. */
  audioBlocked: boolean;
  /** O usuário já ativou o microfone pelo botão do host nesta chamada. */
  micConsent: boolean;
  busy: boolean;
}

const IDLE: VoiceState = { available: true, reason: 'not_in_call', connected: false, muted: true, scope: 'shared_call', participants: [] };

/**
 * Dono da chamada de voz no HOST (LiveKit). A Atividade só recebe `VoiceState`
 * (dados puros) — o objeto Room nunca atravessa a fronteira do iframe.
 * O microfone começa DESLIGADO e só é ativado por clique explícito no host.
 * Fechar a Atividade não afeta a chamada; sair é só pelo botão "Sair da chamada".
 */
export class LabVoiceController {
  private room: Room | null = null;
  private state: VoiceState;
  private extras: VoiceUiExtras = { audioBlocked: false, micConsent: false, busy: false };
  private readonly subs = new Set<() => void>();
  private readonly audioEls = new Set<HTMLMediaElement>();
  private reason: VoiceReason = 'not_in_call';

  constructor(
    private readonly opts: {
      configured: boolean;
      fetchToken: () => Promise<{ token: string; url: string }>;
      log: (text: string, level?: 'info' | 'warn' | 'error') => void;
    },
  ) {
    this.state = opts.configured ? IDLE : VOICE_NOT_CONFIGURED;
  }

  readonly subscribe = (cb: () => void): (() => void) => {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  };
  readonly getState = (): VoiceState => this.state;
  readonly getExtras = (): VoiceUiExtras => this.extras;

  get configured() {
    return this.opts.configured;
  }

  private setExtras(patch: Partial<VoiceUiExtras>) {
    this.extras = { ...this.extras, ...patch };
    this.subs.forEach((s) => s());
  }

  private recompute() {
    if (!this.opts.configured) return;
    const room = this.room;
    let next: VoiceState;
    if (!room) {
      next = { ...IDLE, reason: this.reason === 'error' || this.reason === 'connecting' ? this.reason : 'not_in_call' };
    } else {
      const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
      const participants: VoiceParticipant[] = all.slice(0, 64).map((p) => ({
        id: p.identity.slice(0, 128),
        displayName: (p.name || p.identity).slice(0, 64),
        speaking: p.isSpeaking,
        muted: !p.isMicrophoneEnabled,
        isLocal: p.isLocal,
      }));
      // ConnectionState.Connected === 'connected' (enum de string do livekit-client, carregado sob demanda).
      const connected = (room.state as string) === 'connected';
      next = {
        available: true,
        reason: connected && this.reason !== 'permission_denied' ? 'ok' : connected ? 'permission_denied' : 'connecting',
        connected,
        muted: !room.localParticipant.isMicrophoneEnabled,
        scope: 'shared_call',
        participants,
      };
    }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.subs.forEach((s) => s());
  }

  /** Entrar na chamada (gesto do usuário). O microfone continua desligado. */
  async join(): Promise<void> {
    if (!this.opts.configured || this.room || this.extras.busy) return;
    this.setExtras({ busy: true });
    this.reason = 'connecting';
    this.recompute();
    try {
      const { token, url } = await this.opts.fetchToken();
      const { Room, RoomEvent, Track } = await import('livekit-client');
      const room = new Room({
        adaptiveStream: false,
        dynacast: false,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const refresh = () => this.recompute();
      room
        .on(RoomEvent.ParticipantConnected, refresh)
        .on(RoomEvent.ParticipantDisconnected, refresh)
        .on(RoomEvent.ActiveSpeakersChanged, refresh)
        .on(RoomEvent.TrackMuted, refresh)
        .on(RoomEvent.TrackUnmuted, refresh)
        .on(RoomEvent.LocalTrackPublished, refresh)
        .on(RoomEvent.LocalTrackUnpublished, refresh)
        .on(RoomEvent.ParticipantNameChanged, refresh)
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.dataset.labVoice = '1';
            el.style.display = 'none';
            document.body.appendChild(el);
            this.audioEls.add(el);
          }
          refresh();
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          for (const el of track.detach()) {
            el.remove();
            this.audioEls.delete(el);
          }
          refresh();
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, () => this.setExtras({ audioBlocked: !room.canPlaybackAudio }))
        .on(RoomEvent.Reconnecting, () => {
          this.opts.log('Voz: reconectando…', 'warn');
          refresh();
        })
        .on(RoomEvent.Reconnected, () => {
          this.opts.log('Voz: reconectado.');
          refresh();
        })
        .on(RoomEvent.MediaDevicesError, (e: Error) => {
          this.opts.log(`Voz: erro de dispositivo (${e.name || 'desconhecido'}).`, 'error');
        })
        .on(RoomEvent.Disconnected, () => {
          if (this.room !== room) return;
          this.teardown();
          this.opts.log('Voz: desconectado da chamada.');
        });
      this.room = room;
      await room.connect(url, token, { autoSubscribe: true });
      this.reason = 'ok';
      this.opts.log('Voz: conectado à chamada (microfone desligado).');
      try {
        await room.startAudio();
      } catch {
        /* sem gesto válido: o botão "Ativar áudio" aparece */
      }
      this.setExtras({ audioBlocked: !room.canPlaybackAudio });
      this.recompute();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'falha desconhecida';
      this.opts.log(`Voz: não foi possível entrar na chamada (${msg.slice(0, 120)}).`, 'error');
      const room = this.room;
      this.room = null;
      if (room) void room.disconnect();
      this.detachAll();
      this.reason = 'error';
      this.recompute();
    } finally {
      this.setExtras({ busy: false });
    }
  }

  /** Sair da chamada — somente pelo botão explícito do host. */
  async leave(): Promise<void> {
    const room = this.room;
    if (!room) return;
    this.teardown();
    await room.disconnect();
    this.opts.log('Voz: você saiu da chamada.');
  }

  private teardown() {
    this.room = null;
    this.detachAll();
    this.reason = 'not_in_call';
    this.extras = { ...this.extras, micConsent: false, audioBlocked: false };
    this.recompute();
    this.subs.forEach((s) => s());
  }

  private detachAll() {
    for (const el of this.audioEls) el.remove();
    this.audioEls.clear();
  }

  async startAudio(): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.startAudio();
    } finally {
      this.setExtras({ audioBlocked: !this.room?.canPlaybackAudio });
    }
  }

  /** Liga/desliga o microfone. `byUser` = clique no host (consentimento explícito). */
  async setMicEnabled(enabled: boolean, byUser: boolean): Promise<boolean> {
    const room = this.room;
    if (!room) return false;
    if (enabled && !byUser && !this.extras.micConsent) {
      this.opts.log('A Atividade pediu para ligar o microfone: use "Ativar microfone" no host (consentimento explícito).', 'warn');
      return false;
    }
    try {
      await room.localParticipant.setMicrophoneEnabled(enabled);
      if (enabled && byUser) this.setExtras({ micConsent: true });
      if (this.reason === 'permission_denied') this.reason = 'ok';
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.reason = 'permission_denied';
        this.opts.log('Voz: permissão de microfone negada pelo navegador.', 'error');
      } else {
        this.opts.log(`Voz: falha ao alterar o microfone (${name || 'erro'}).`, 'error');
      }
      this.recompute();
      return false;
    }
    this.recompute();
    return true;
  }

  /** Pedido vindo da Atividade (ACTIVITY_REQUEST_VOICE_ACTION). */
  async handleActivityAction(action: 'toggle_mute' | 'join' | 'leave'): Promise<{ accepted: boolean }> {
    if (action === 'toggle_mute') {
      if (!this.room) return { accepted: false };
      return { accepted: await this.setMicEnabled(this.state.muted, false) };
    }
    // Entrar/sair da chamada é decisão do usuário no host, nunca da Atividade.
    this.opts.log(`A Atividade pediu "${action === 'join' ? 'entrar na' : 'sair da'} chamada": use os botões do painel de voz.`, 'warn');
    return { accepted: false };
  }
}
