import { Client, type Room } from '@colyseus/sdk';
import {
  C2S,
  GAME_VERSION,
  MATCH_ROOM_NAME,
  S2C,
  decodePaintDelta,
  decodePaintSnapshot,
  encodeInput,
  type LobbyState,
  type PaintDeltaWire,
  type PaintSnapshotWire,
  type PlayerInput,
  type RoundResult,
  type SnapshotMessage,
  type WelcomeMessage,
} from '@borrifo/game-contracts';

/**
 * Cliente headless que fala o protocolo REAL pelo transporte REAL (WebSocket
 * Colyseus). Usado em testes de integração e de carga local.
 */
export class HeadlessClient {
  client: Client;
  room: Room | null = null;
  welcome: WelcomeMessage | null = null;
  lobby: LobbyState | null = null;
  snapshots: SnapshotMessage[] = [];
  lastSnapshot: SnapshotMessage | null = null;
  paintSnapshots: PaintSnapshotWire[] = [];
  paintDeltas: PaintDeltaWire[] = [];
  results: RoundResult[] = [];
  notices: Array<{ code: string; message: string }> = [];
  roundLoading: { roundId: number; mapHash: string } | null = null;
  seq = 0;
  actionId = 0;
  keepSnapshots = 50;

  constructor(readonly endpoint: string) {
    this.client = new Client(endpoint);
  }

  async join(opts: { activitySessionId: string; credential: string; mapHash: string }) {
    const room = await this.client.joinOrCreate(MATCH_ROOM_NAME, { activitySessionId: opts.activitySessionId, credential: opts.credential, clientVersion: GAME_VERSION, mapHash: opts.mapHash });
    this.attach(room);
    return room;
  }

  async reconnect(token: string) {
    const room = await this.client.reconnect(token);
    this.attach(room);
    return room;
  }

  attach(room: Room) {
    this.room = room;
    room.onMessage(S2C.WELCOME, (m: WelcomeMessage) => (this.welcome = m));
    room.onMessage(S2C.LOBBY, (m: LobbyState) => (this.lobby = m));
    room.onMessage(S2C.SNAPSHOT, (m: SnapshotMessage) => {
      this.lastSnapshot = m;
      this.snapshots.push(m);
      if (this.snapshots.length > this.keepSnapshots) this.snapshots.shift();
    });
    room.onMessage(S2C.PAINT_SNAPSHOT, (b: Uint8Array) => this.paintSnapshots.push(decodePaintSnapshot(new Uint8Array(b))));
    room.onMessage(S2C.PAINT_DELTA, (b: Uint8Array) => this.paintDeltas.push(decodePaintDelta(new Uint8Array(b))));
    room.onMessage(S2C.ROUND_RESULT, (m: RoundResult) => this.results.push(m));
    room.onMessage(S2C.NOTICE, (m: { code: string; message: string }) => this.notices.push(m));
    room.onMessage(S2C.ROUND_LOADING, (m: { roundId: number; mapHash: string }) => {
      this.roundLoading = m;
      room.send(C2S.LOADED, { roundId: m.roundId, mapHash: m.mapHash });
    });
    for (const t of [S2C.ROUND_COUNTDOWN, S2C.ROUND_START, S2C.PONG]) room.onMessage(t, () => {});
  }

  send(type: string, msg: unknown) {
    this.room!.send(type, msg);
  }

  sendInput(partial: Partial<PlayerInput> = {}) {
    const input: PlayerInput = { sequence: ++this.seq, clientTick: this.seq, moveX: 0, moveY: 0, yaw: 0, pitch: 0, heldButtons: 0, pressedActions: [], ...partial };
    this.room!.send(C2S.INPUT, encodeInput(input));
  }

  async waitFor<T>(pred: () => T | null | undefined | false, timeoutMs = 10000, label = 'condição'): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = pred();
      if (v) return v as T;
      if (Date.now() - start > timeoutMs) throw new Error(`timeout aguardando ${label}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async leave(consented = true) {
    await this.room?.leave(consented);
  }
}
