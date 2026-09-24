import { Client, type Room } from '@colyseus/sdk';
import {
  C2S,
  CloseCodes,
  GAME_VERSION,
  MATCH_ROOM_NAME,
  S2C,
  decodePaintDelta,
  decodePaintSnapshot,
  type LobbyState,
  type NoticeMessage,
  type PaintDeltaWire,
  type PaintSnapshotWire,
  type RoundCountdownMessage,
  type RoundLoadingMessage,
  type RoundResult,
  type RoundStartMessage,
  type SnapshotMessage,
  type WelcomeMessage,
  type InputWire,
} from '@borrifo/game-contracts';

export interface MatchHandlers {
  onWelcome(m: WelcomeMessage): void;
  onLobby(m: LobbyState): void;
  onRoundLoading(m: RoundLoadingMessage): void;
  onRoundCountdown(m: RoundCountdownMessage): void;
  onRoundStart(m: RoundStartMessage): void;
  onRoundResult(m: RoundResult): void;
  onSnapshot(m: SnapshotMessage, receivedAt: number): void;
  onPaintSnapshot(m: PaintSnapshotWire): void;
  onPaintDelta(m: PaintDeltaWire): void;
  onNotice(m: NoticeMessage): void;
  onConnectionState(s: 'connected' | 'reconnecting' | 'lost', detail?: string): void;
  onRtt(ms: number): void;
}

/**
 * Conexão de gameplay (Colyseus sobre WebSocket). A credencial curta vai no
 * corpo do POST de matchmaking; a URL do WebSocket carrega só a reserva de
 * assento de uso único emitida pelo servidor.
 */
export class MatchConnection {
  private client: Client;
  room: Room | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUs = false;
  private rttSamples: number[] = [];

  constructor(
    private readonly serverUrl: string,
    private readonly handlers: MatchHandlers,
  ) {
    this.client = new Client(serverUrl);
  }

  async join(activitySessionId: string, credential: string, mapHash: string): Promise<void> {
    this.closedByUs = false;
    const room = await this.client.joinOrCreate(MATCH_ROOM_NAME, { activitySessionId, credential, clientVersion: GAME_VERSION, mapHash });
    this.bind(room);
  }

  private bind(room: Room) {
    this.room = room;
    // Reconexão automática do SDK: ~20 s de tentativas, alinhada à janela do servidor.
    room.reconnection.maxRetries = 12;
    room.reconnection.maxDelay = 2500;
    room.reconnection.minUptime = 1000;
    const h = this.handlers;
    room.onMessage(S2C.WELCOME, (m: WelcomeMessage) => h.onWelcome(m));
    room.onMessage(S2C.LOBBY, (m: LobbyState) => h.onLobby(m));
    room.onMessage(S2C.ROUND_LOADING, (m: RoundLoadingMessage) => h.onRoundLoading(m));
    room.onMessage(S2C.ROUND_COUNTDOWN, (m: RoundCountdownMessage) => h.onRoundCountdown(m));
    room.onMessage(S2C.ROUND_START, (m: RoundStartMessage) => h.onRoundStart(m));
    room.onMessage(S2C.ROUND_RESULT, (m: RoundResult) => h.onRoundResult(m));
    room.onMessage(S2C.SNAPSHOT, (m: SnapshotMessage) => h.onSnapshot(m, performance.now()));
    room.onMessage(S2C.PAINT_SNAPSHOT, (b: Uint8Array) => {
      try {
        h.onPaintSnapshot(decodePaintSnapshot(new Uint8Array(b)));
      } catch (e) {
        console.warn('snapshot de tinta inválido', e);
      }
    });
    room.onMessage(S2C.PAINT_DELTA, (b: Uint8Array) => {
      try {
        h.onPaintDelta(decodePaintDelta(new Uint8Array(b)));
      } catch (e) {
        console.warn('delta de tinta inválido', e);
      }
    });
    room.onMessage(S2C.NOTICE, (m: NoticeMessage) => h.onNotice(m));
    room.onMessage(S2C.PONG, (m: { c: number }) => {
      const rtt = performance.now() - m.c;
      this.rttSamples.push(rtt);
      if (this.rttSamples.length > 5) this.rttSamples.shift();
      h.onRtt(Math.round(this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length));
    });
    room.onDrop(() => h.onConnectionState('reconnecting'));
    room.onReconnect(() => h.onConnectionState('connected'));
    room.onLeave((code: number, reason?: string) => {
      this.stopPing();
      if (this.closedByUs) return;
      const detail = code === CloseCodes.REPLACED_BY_NEW_SESSION ? 'replaced' : code === CloseCodes.ABUSE ? 'abuse' : reason ?? String(code);
      h.onConnectionState('lost', detail);
    });
    h.onConnectionState('connected');
    this.stopPing();
    this.pingTimer = setInterval(() => this.send(C2S.PING, { c: performance.now() }), 2000);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  send(type: string, msg: unknown) {
    try {
      this.room?.send(type, msg);
    } catch {
      /* conexão fechando */
    }
  }

  sendInput(w: InputWire) {
    this.send(C2S.INPUT, w);
  }

  async leave() {
    this.closedByUs = true;
    this.stopPing();
    const r = this.room;
    this.room = null;
    if (r) {
      try {
        await r.leave(true);
      } catch {
        /* já fechado */
      }
    }
  }
}
