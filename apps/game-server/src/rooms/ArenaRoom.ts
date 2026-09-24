import { randomUUID } from 'node:crypto';
import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import {
  C2S,
  CloseCodes,
  GAMEPLAY_PROTOCOL_VERSION,
  GAME_VERSION,
  InputWireSchema,
  JoinOptionsSchema,
  LoadedSchema,
  MAX_CLIENT_MESSAGES_PER_SECOND,
  MAX_PLAYERS,
  MAX_TEAM_SIZE,
  PFLAG_ALIVE,
  PFLAG_CHARGING,
  PFLAG_CLIMBING,
  PFLAG_DRAGGING,
  PFLAG_FIRING,
  PFLAG_GROUNDED,
  PFLAG_IN_ENEMY_INK,
  PFLAG_PROTECTED,
  PFLAG_SPECIAL_READY,
  PFLAG_SUBMERGED,
  PFLAG_SWINGING,
  PFLAG_TRAVEL_FLY,
  PFLAG_TRAVEL_PREP,
  PaintResyncSchema,
  PingSchema,
  RECONNECT_WINDOW_SECONDS,
  S2C,
  SetBotsSchema,
  SetReadySchema,
  SetTeamSchema,
  SetWeaponSchema,
  StartSchema,
  TICKS_PER_SNAPSHOT,
  TICK_RATE,
  SNAPSHOT_RATE,
  VoteSchema,
  GROUND_ENEMY,
  decodeInput,
  encodePaintDelta,
  encodePaintSnapshot,
  paintContextTag,
  type ConnectionStatus,
  type GameEvent,
  type LobbyPlayer,
  type LobbyState,
  type RoundLoadingMessage,
  type NoticeCode,
  type RemotePlayerTuple,
  type RoomPhase,
  type RoundResult,
  type SnapshotMessage,
  type TeamId,
  type WeaponId,
  type WorldObjectState,
} from '@borrifo/game-contracts';
import { DEFAULT_MAP_ID, DEFAULT_TEAM_PAIR_ID, MATCH, MORINGA, RODA_DE_OLEIRO, pickTeamPair } from '@borrifo/game-content';
import { BotBrain, MatchSimulation, PhysicsWorld, toSelfSnapshot, type SimPlayer } from '@borrifo/game-simulation';
import type { ZodType } from 'zod';
import { AuthError, sanitizeDisplayName, type CredentialVerifier, type VerifiedIdentity } from '../auth';
import { log } from '../logger';
import { KeyedRateLimiter, TokenBucket } from '../rateLimit';
import type { ResultSink } from '../results';
import { loadStaticWorld, type StaticWorld } from '../world';

interface RoomPlayer {
  playerId: number;
  userId: string | null;
  displayName: string;
  avatarUrl: string | null;
  isBot: boolean;
  team: TeamId;
  weaponId: WeaponId;
  ready: boolean;
  connection: ConnectionStatus;
  loaded: boolean;
  inRound: boolean;
  sessionId: string | null;
  inputBucket: TokenBucket;
  controlBucket: TokenBucket;
  invalidCount: number;
  lastResyncAt: number;
  reconnect: { reject: Function } | null;
  vote: 'rematch' | 'lobby' | null;
}

export interface ArenaDeps {
  verifier: CredentialVerifier;
  sink: ResultSink;
  roundDurationSeconds: number;
}

const BOT_NAMES = ['Bibelô Jarra', 'Bibelô Vaso', 'Bibelô Cuia', 'Bibelô Tacho', 'Bibelô Pote', 'Bibelô Bule', 'Bibelô Caneca', 'Bibelô Moringa'];

/**
 * Sala de uma sessão de Atividade. É a ÚNICA autoridade de escrita da partida:
 * lobby, equipes, bots, rodada, simulação, snapshots, tinta e resultado.
 * Máquina de estados: lobby → loading → countdown → running → finishing → results → (loading | lobby).
 */
export class ArenaRoom extends Room {
  static deps: ArenaDeps;
  static joinLimiter = new KeyedRateLimiter(10, 1);
  /** Registro por processo: uma sala por activitySessionId. */
  static bySession = new Map<string, string>();

  activitySessionId = '';
  matchId = '';
  /** Semente da partida para a rotação dos pares de cores (fixa enquanto a sala vive). */
  private readonly paletteSeed = (Math.random() * 2 ** 31) | 0;
  /** Par de apresentação da rodada atual; só muda quando uma rodada nova carrega. */
  private teamPairId = DEFAULT_TEAM_PAIR_ID;
  phase: RoomPhase = 'lobby';
  roundId = 0;
  private world!: StaticWorld;
  private physics: PhysicsWorld | null = null;
  private sim: MatchSimulation | null = null;
  private players = new Map<number, RoomPlayer>();
  private bySessionId = new Map<string, number>();
  private nextPlayerId = 1;
  private hostPlayerId: number | null = null;
  private fillWithBots = true;
  private phaseDeadlineTick = 0;
  private tickCount = 0;
  private pendingEvents: Array<{ ev: GameEvent; to?: number }> = [];
  private lastResult: RoundResult | null = null;
  private replacedSessions = new Set<string>();
  private botSeed = 1;
  private tickDurations: number[] = [];

  /* ------------------------- autenticação ------------------------- */

  static override async onAuth(_token: string | undefined, options: unknown, context: AuthContext): Promise<VerifiedIdentity> {
    const ip = context.ip ?? 'desconhecido';
    if (!ArenaRoom.joinLimiter.take(ip)) throw new ServerError(429, 'muitas tentativas de entrada; aguarde');
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(400, 'opções de entrada inválidas');
    const { activitySessionId, credential, mapHash } = parsed.data;
    const world = await loadStaticWorld(DEFAULT_MAP_ID);
    if (mapHash !== world.mapHash) throw new ServerError(409, 'versão do mapa incompatível com o servidor; recarregue a Atividade');
    try {
      return await ArenaRoom.deps.verifier.verify(credential, activitySessionId);
    } catch (e) {
      if (e instanceof AuthError) {
        log('warn', 'auth.rejected', { activitySessionId, reason: e.code, ip });
        throw new ServerError(401, e.message);
      }
      throw e;
    }
  }

  /* --------------------------- ciclo de vida --------------------------- */

  override async onCreate(options: { activitySessionId?: string }) {
    const sid = typeof options?.activitySessionId === 'string' ? options.activitySessionId : '';
    if (!sid) throw new ServerError(400, 'activitySessionId ausente');
    if (ArenaRoom.bySession.has(sid)) throw new ServerError(409, 'sala da sessão cheia ou já existente');
    ArenaRoom.bySession.set(sid, this.roomId);
    this.activitySessionId = sid;
    this.matchId = randomUUID();
    this.maxClients = MAX_PLAYERS + 2;
    this.maxMessagesPerSecond = MAX_CLIENT_MESSAGES_PER_SECOND;
    this.world = await loadStaticWorld(DEFAULT_MAP_ID);
    this.physics = new PhysicsWorld(this.world.map);
    this.registerMessages();
    this.setFixedTimestep(() => this.fixedStep(), TICK_RATE);
    log('info', 'room.created', { activitySessionId: sid, matchId: this.matchId, roomId: this.roomId });
  }

  override onJoin(client: Client, _options: unknown, auth: VerifiedIdentity) {
    if (!auth || auth.activitySessionId !== this.activitySessionId) throw new ServerError(403, 'credencial não corresponde a esta sessão');
    // Reentrada do mesmo usuário: recupera o slot existente (sem criar segundo jogador).
    const existing = [...this.players.values()].find((p) => !p.isBot && p.userId === auth.userId) ?? [...this.players.values()].find((p) => p.userId === auth.userId);
    if (existing) {
      // a credencial nova traz o perfil atual (apelido ou avatar podem ter mudado)
      existing.displayName = sanitizeDisplayName(auth.displayName);
      existing.avatarUrl = auth.avatarUrl;
      this.takeOverSlot(existing, client);
      log('info', 'player.resumed', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId, playerId: existing.playerId });
      this.sendWelcome(client, existing, true);
      this.afterJoinSync(client, existing);
      this.broadcastLobby();
      return;
    }
    const humans = [...this.players.values()].filter((p) => !p.isBot);
    if (humans.length >= MAX_PLAYERS) throw new ServerError(409, 'sala cheia');
    const midRound = this.phase !== 'lobby' && this.phase !== 'results';
    const team = this.pickTeamForNewcomer();
    const p: RoomPlayer = {
      playerId: this.nextPlayerId++,
      userId: auth.userId,
      displayName: sanitizeDisplayName(auth.displayName),
      avatarUrl: auth.avatarUrl,
      isBot: false,
      team,
      weaponId: 'esguicho',
      ready: false,
      connection: 'connected',
      loaded: false,
      inRound: !midRound,
      sessionId: client.sessionId,
      inputBucket: new TokenBucket(60, 40),
      controlBucket: new TokenBucket(20, 5),
      invalidCount: 0,
      lastResyncAt: 0,
      reconnect: null,
      vote: null,
    };
    this.players.set(p.playerId, p);
    this.bySessionId.set(client.sessionId, p.playerId);
    if (this.hostPlayerId === null) this.hostPlayerId = p.playerId;
    log('info', 'player.joined', { activitySessionId: this.activitySessionId, matchId: this.matchId, playerId: p.playerId, midRound });
    this.sendWelcome(client, p, false);
    if (midRound) this.notice(client, 'late_join_waiting', 'Partida em andamento: você entra na próxima rodada.');
    this.afterJoinSync(client, p);
    this.broadcastLobby();
  }

  override onDrop(client: Client) {
    if (this.replacedSessions.delete(client.sessionId)) return;
    const pid = this.bySessionId.get(client.sessionId);
    const p = pid !== undefined ? this.players.get(pid) : undefined;
    if (!p) return;
    p.connection = 'reconnecting';
    const def = this.allowReconnection(client, RECONNECT_WINDOW_SECONDS);
    p.reconnect = def;
    def.catch(() => {
      /* expiração tratada em onLeave */
    });
    log('info', 'player.dropped', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId, playerId: p.playerId });
    this.broadcastLobby();
  }

  override onReconnect(client: Client) {
    const pid = this.bySessionId.get(client.sessionId);
    const p = pid !== undefined ? this.players.get(pid) : undefined;
    if (!p) return;
    p.connection = 'connected';
    p.reconnect = null;
    log('info', 'player.reconnected', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId, playerId: p.playerId });
    this.sendWelcome(client, p, true);
    this.afterJoinSync(client, p);
    this.broadcastLobby();
  }

  override onLeave(client: Client) {
    if (this.replacedSessions.delete(client.sessionId)) return;
    const pid = this.bySessionId.get(client.sessionId);
    this.bySessionId.delete(client.sessionId);
    const p = pid !== undefined ? this.players.get(pid) : undefined;
    if (!p || p.sessionId !== client.sessionId) return;
    p.sessionId = null;
    p.reconnect = null;
    const inActiveRound = p.inRound && this.sim && (this.phase === 'loading' || this.phase === 'countdown' || this.phase === 'running' || this.phase === 'finishing');
    if (inActiveRound) {
      // Política: janela de reconexão expirada durante a rodada => o slot vira bot
      // (mesma equipe, mesmas regras). O usuário pode retomar o slot se voltar.
      p.connection = 'replaced_by_bot';
      const sp = this.sim!.players.get(p.playerId);
      if (sp) sp.bot = new BotBrain(this.world.nav, this.botSeed++);
      log('info', 'player.replaced_by_bot', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId, playerId: p.playerId });
    } else {
      this.players.delete(p.playerId);
      this.sim?.removePlayer(p.playerId);
      log('info', 'player.left', { activitySessionId: this.activitySessionId, matchId: this.matchId, playerId: p.playerId });
    }
    this.promoteHostIfNeeded();
    this.broadcastLobby();
  }

  override onDispose() {
    if (this.sim && !this.sim.finished && (this.phase === 'running' || this.phase === 'countdown')) {
      // Encerramento sem recuperação: rodada marcada como interrompida, sem vencedor inventado.
      const r = this.sim.finish('interrupted');
      void ArenaRoom.deps.sink.write(this.activitySessionId, { ...r, winner: 'draw', status: 'interrupted' }).catch(() => {});
    }
    this.sim?.dispose();
    this.physics?.dispose();
    this.sim = null;
    this.physics = null;
    if (ArenaRoom.bySession.get(this.activitySessionId) === this.roomId) ArenaRoom.bySession.delete(this.activitySessionId);
    log('info', 'room.disposed', { activitySessionId: this.activitySessionId, matchId: this.matchId, rounds: this.roundId });
  }

  override onBeforeShutdown() {
    this.broadcast(S2C.NOTICE, { code: 'wrong_phase', message: 'O servidor de partidas está reiniciando. A rodada foi interrompida.' });
    this.disconnect(CloseCodes.ROOM_CLOSING);
  }

  /* ----------------------------- mensagens ----------------------------- */

  private guarded<T>(type: string, schema: ZodType<T>, handler: (p: RoomPlayer, msg: T, client: Client) => void, bucket: 'input' | 'control' = 'control') {
    this.onMessage(type, (client: Client, raw: unknown) => {
      const pid = this.bySessionId.get(client.sessionId);
      const p = pid !== undefined ? this.players.get(pid) : undefined;
      if (!p || p.sessionId !== client.sessionId) return;
      const b = bucket === 'input' ? p.inputBucket : p.controlBucket;
      if (!b.take()) {
        if (bucket === 'control') this.notice(client, 'rate_limited', 'Muitas ações seguidas. Aguarde um instante.');
        return;
      }
      const res = schema.safeParse(raw);
      if (!res.success) {
        p.invalidCount++;
        if (p.invalidCount > 50) {
          log('warn', 'client.abusive', { activitySessionId: this.activitySessionId, playerId: p.playerId });
          client.leave(CloseCodes.ABUSE, 'mensagens inválidas em excesso');
        }
        return;
      }
      handler(p, res.data, client);
    });
  }

  private registerMessages() {
    this.guarded(
      C2S.INPUT,
      InputWireSchema,
      (p, w) => {
        if (!this.sim || !p.inRound || (this.phase !== 'countdown' && this.phase !== 'running')) return;
        const sp = this.sim.players.get(p.playerId);
        if (!sp || sp.bot) return;
        this.sim.enqueueInput(p.playerId, decodeInput(w));
      },
      'input',
    );
    this.guarded(C2S.SET_TEAM, SetTeamSchema, (p, m, client) => {
      if (this.phase !== 'lobby') return this.notice(client, 'wrong_phase', 'Troca de equipe só no lobby.');
      if (p.team === m.team) return;
      const count = [...this.players.values()].filter((x) => !x.isBot && x.team === m.team).length;
      if (count >= MAX_TEAM_SIZE) return this.notice(client, 'team_full', 'Essa equipe está completa.');
      p.team = m.team;
      p.ready = false;
      this.broadcastLobby();
    });
    this.guarded(C2S.SET_WEAPON, SetWeaponSchema, (p, m, client) => {
      if (this.phase !== 'lobby' && this.phase !== 'results') return this.notice(client, 'wrong_phase', 'Troque de ferramenta entre rodadas.');
      p.weaponId = m.weaponId;
      this.broadcastLobby();
    });
    this.guarded(C2S.SET_READY, SetReadySchema, (p, m) => {
      if (this.phase !== 'lobby') return;
      p.ready = m.ready;
      this.broadcastLobby();
    });
    this.guarded(C2S.SET_BOTS, SetBotsSchema, (p, m, client) => {
      if (p.playerId !== this.hostPlayerId) return this.notice(client, 'not_host', 'Só quem organiza a sala muda os bots.');
      if (this.phase !== 'lobby') return;
      this.fillWithBots = m.enabled;
      this.broadcastLobby();
    });
    this.guarded(C2S.START, StartSchema, (p, _m, client) => {
      if (p.playerId !== this.hostPlayerId) return this.notice(client, 'not_host', 'Só quem organiza a sala pode iniciar.');
      if (this.phase !== 'lobby') return this.notice(client, 'wrong_phase', 'A partida já começou.');
      const humans = [...this.players.values()].filter((x) => !x.isBot && x.connection === 'connected');
      const notReady = humans.filter((x) => x.playerId !== p.playerId && !x.ready);
      if (notReady.length) return this.notice(client, 'not_all_ready', `Aguardando: ${notReady.map((x) => x.displayName).join(', ')}`);
      const t0 = humans.filter((x) => x.team === 0).length;
      const t1 = humans.filter((x) => x.team === 1).length;
      if (!this.fillWithBots && (t0 === 0 || t1 === 0)) return this.notice(client, 'not_all_ready', 'Cada equipe precisa de alguém (ou ative os bots).');
      this.startRound();
    });
    this.guarded(C2S.LOADED, LoadedSchema, (p, m, client) => {
      if (m.roundId !== this.roundId) return;
      if (m.mapHash !== this.world.mapHash) return this.notice(client, 'map_mismatch', 'Mapa local diferente do servidor. Recarregue a Atividade.');
      p.loaded = true;
      if (this.phase !== 'loading') this.sendPaintSnapshot(client);
      this.broadcastLobby();
    });
    this.guarded(C2S.VOTE, VoteSchema, (p, m) => {
      if (this.phase !== 'results') return;
      p.vote = m.choice;
      if (m.choice === 'lobby' && p.playerId === this.hostPlayerId) return this.returnToLobby();
      this.broadcastLobby();
      const humans = [...this.players.values()].filter((x) => !x.isBot && x.connection === 'connected');
      if (humans.length && humans.every((x) => x.vote === 'rematch')) this.startRound();
    });
    this.guarded(C2S.PAINT_RESYNC, PaintResyncSchema, (p, m, client) => {
      if (!this.sim || m.roundId !== this.roundId) return;
      const now = Date.now();
      if (now - p.lastResyncAt < 1500) return;
      p.lastResyncAt = now;
      log('info', 'paint.resync', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId, playerId: p.playerId, reason: m.reason });
      this.sendPaintSnapshot(client);
    });
    this.guarded(C2S.PING, PingSchema, (_p, m, client) => {
      client.send(S2C.PONG, { c: m.c, s: Date.now(), t: this.sim?.tick ?? 0 });
    });
  }

  /* ------------------------------ lobby ------------------------------ */

  private pickTeamForNewcomer(): TeamId {
    const humans = [...this.players.values()].filter((p) => !p.isBot);
    const t0 = humans.filter((p) => p.team === 0).length;
    const t1 = humans.filter((p) => p.team === 1).length;
    return t0 <= t1 ? 0 : 1;
  }

  private promoteHostIfNeeded() {
    const host = this.hostPlayerId !== null ? this.players.get(this.hostPlayerId) : undefined;
    if (host && !host.isBot && host.connection !== 'replaced_by_bot' && host.sessionId) return;
    const next = [...this.players.values()].filter((p) => !p.isBot && p.sessionId).sort((a, b) => a.playerId - b.playerId)[0];
    this.hostPlayerId = next ? next.playerId : null;
  }

  private takeOverSlot(p: RoomPlayer, client: Client) {
    // derruba a conexão anterior do mesmo usuário (uma pessoa, um slot)
    if (p.sessionId && p.sessionId !== client.sessionId) {
      const old = this.clients.find((c) => c.sessionId === p.sessionId);
      this.replacedSessions.add(p.sessionId);
      this.bySessionId.delete(p.sessionId);
      if (old) {
        this.notice(old, 'replaced', 'Esta sessão foi aberta em outro lugar.');
        old.leave(CloseCodes.REPLACED_BY_NEW_SESSION, 'sessão substituída');
      }
    }
    if (p.reconnect) {
      try {
        p.reconnect.reject(new Error('substituído por nova sessão'));
      } catch {
        /* já resolvido */
      }
      p.reconnect = null;
    }
    p.sessionId = client.sessionId;
    p.connection = 'connected';
    this.bySessionId.set(client.sessionId, p.playerId);
    const sp = this.sim?.players.get(p.playerId);
    if (sp && sp.bot && !p.isBot) sp.bot = null;
    this.promoteHostIfNeeded();
  }

  private lobbyState(): LobbyState {
    const players: LobbyPlayer[] = [...this.players.values()]
      .sort((a, b) => a.playerId - b.playerId)
      .map((p) => ({
        playerId: p.playerId,
        userId: p.userId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        isBot: p.isBot,
        team: p.team,
        weaponId: p.weaponId,
        ready: p.ready,
        connection: p.isBot ? 'bot' : p.connection,
        loaded: p.loaded,
        inRound: p.inRound,
      }));
    return {
      phase: this.phase,
      matchId: this.matchId,
      roundId: this.roundId,
      hostPlayerId: this.hostPlayerId,
      fillWithBots: this.fillWithBots,
      maxTeamSize: MAX_TEAM_SIZE,
      players,
      map: { id: this.world.map.id, name: this.world.map.name },
      roundDurationSeconds: ArenaRoom.deps.roundDurationSeconds,
      phaseRemainingMs: this.phaseRemainingMs(),
      rematchVotes: [...this.players.values()].filter((p) => p.vote === 'rematch').map((p) => p.playerId),
      lastResult: this.lastResult,
      teamPairId: this.teamPairId,
    };
  }

  private roundLoading(): RoundLoadingMessage {
    return { matchId: this.matchId, roundId: this.roundId, mapId: this.world.map.id, mapHash: this.world.mapHash, teamPairId: this.teamPairId, timeoutMs: MATCH.loadingTimeoutSeconds * 1000 };
  }

  private phaseRemainingMs(): number | null {
    if (this.phase === 'countdown' || this.phase === 'running') return this.sim?.phaseRemainingMs ?? null;
    if (this.phase === 'loading' || this.phase === 'finishing' || this.phase === 'results') return Math.max(0, ((this.phaseDeadlineTick - this.tickCount) * 1000) / TICK_RATE);
    return null;
  }

  private broadcastLobby() {
    this.broadcast(S2C.LOBBY, this.lobbyState());
  }

  private notice(client: Client, code: NoticeCode, message: string) {
    client.send(S2C.NOTICE, { code, message });
  }

  private sendWelcome(client: Client, p: RoomPlayer, resumed: boolean) {
    client.send(S2C.WELCOME, {
      protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
      serverVersion: GAME_VERSION,
      matchId: this.matchId,
      playerId: p.playerId,
      tickRate: TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      map: { id: this.world.map.id, version: this.world.map.version, hash: this.world.mapHash },
      resumed,
    });
  }

  /** Reenvia contexto da rodada para quem entra/reconecta no meio dela. */
  private afterJoinSync(client: Client, p: RoomPlayer) {
    client.send(S2C.LOBBY, this.lobbyState());
    if (!this.sim || !p.inRound) return;
    if (this.phase === 'loading' || this.phase === 'countdown' || this.phase === 'running') {
      client.send(S2C.ROUND_LOADING, this.roundLoading());
      if (this.phase !== 'loading' && p.loaded) this.sendPaintSnapshot(client);
      if (this.phase === 'running') client.send(S2C.ROUND_START, { roundId: this.roundId, durationMs: this.sim.phaseRemainingMs, startTick: this.sim.startTick });
    }
  }

  /* ------------------------------ rodada ------------------------------ */

  private startRound() {
    this.sim?.dispose();
    this.roundId++;
    this.phase = 'loading';
    this.phaseDeadlineTick = this.tickCount + MATCH.loadingTimeoutSeconds * TICK_RATE;
    this.pendingEvents = [];
    // remove bots antigos e humanos que não voltaram
    for (const p of [...this.players.values()]) {
      if (p.isBot || p.connection === 'replaced_by_bot') this.players.delete(p.playerId);
    }
    const humans = [...this.players.values()];
    for (const p of humans) {
      p.inRound = true;
      p.loaded = false;
      p.vote = null;
    }
    if (this.fillWithBots) {
      for (const team of [0, 1] as const) {
        let count = humans.filter((p) => p.team === team).length;
        while (count < MAX_TEAM_SIZE) {
          const id = this.nextPlayerId++;
          this.players.set(id, {
            playerId: id,
            userId: null,
            displayName: BOT_NAMES[(id + team) % BOT_NAMES.length],
            avatarUrl: null,
            isBot: true,
            team,
            weaponId: (['esguicho', 'rodo', 'estilingue', 'esguicho'] as const)[count % 4],
            ready: true,
            connection: 'bot',
            loaded: true,
            inRound: true,
            sessionId: null,
            inputBucket: new TokenBucket(1, 1),
            controlBucket: new TokenBucket(1, 1),
            invalidCount: 0,
            lastResyncAt: 0,
            reconnect: null,
            vote: 'rematch',
          });
          count++;
        }
      }
    }
    const seed = (Math.random() * 2 ** 31) | 0;
    this.teamPairId = pickTeamPair(this.paletteSeed, this.roundId).id;
    this.sim = new MatchSimulation({
      map: this.world.map,
      layout: this.world.layout,
      physics: this.physics!,
      matchId: this.matchId,
      roundId: this.roundId,
      contextTag: paintContextTag(this.matchId, this.world.mapHash),
      seed,
      durationSeconds: ArenaRoom.deps.roundDurationSeconds,
      countdownSeconds: MATCH.countdownSeconds,
    });
    for (const p of [...this.players.values()].sort((a, b) => a.playerId - b.playerId)) {
      const sp = this.sim.addPlayer(p.playerId, p.displayName, p.team, p.weaponId, p.isBot);
      if (p.isBot || p.connection === 'replaced_by_bot') sp.bot = new BotBrain(this.world.nav, this.botSeed++);
    }
    log('info', 'round.loading', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId, players: this.players.size });
    this.broadcast(S2C.ROUND_LOADING, this.roundLoading());
    this.broadcastLobby();
  }

  private beginCountdown() {
    if (!this.sim) return;
    this.phase = 'countdown';
    // quem não carregou a tempo continua na rodada; o servidor neutraliza suas entradas
    for (const c of this.clients) {
      const p = this.players.get(this.bySessionId.get(c.sessionId) ?? -1);
      if (p?.inRound) this.sendPaintSnapshot(c);
    }
    this.broadcast(S2C.ROUND_COUNTDOWN, { roundId: this.roundId, countdownMs: MATCH.countdownSeconds * 1000 });
    log('info', 'round.countdown', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId });
    this.broadcastLobby();
  }

  private sendPaintSnapshot(client: Client) {
    if (!this.sim) return;
    client.sendBytes(S2C.PAINT_SNAPSHOT, encodePaintSnapshot(this.sim.paint.toSnapshot()));
  }

  private onRoundFinished() {
    const sim = this.sim!;
    const result = sim.finish('completed');
    this.lastResult = result;
    this.phase = 'finishing';
    this.phaseDeadlineTick = this.tickCount + Math.round(MATCH.finishingSeconds * TICK_RATE);
    this.flushPaint();
    this.sendSnapshots();
    this.broadcast(S2C.ROUND_RESULT, result);
    log('info', 'round.finished', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId, winner: result.winner, percent: result.percent });
    ArenaRoom.deps.sink.write(this.activitySessionId, result).catch((e) => log('error', 'result.persist_failed', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId, error: String(e) }));
    this.broadcastLobby();
  }

  private returnToLobby() {
    this.phase = 'lobby';
    this.sim?.dispose();
    this.sim = null;
    for (const p of [...this.players.values()]) {
      if (p.isBot || p.connection === 'replaced_by_bot') this.players.delete(p.playerId);
      else {
        p.ready = false;
        p.inRound = true;
        p.loaded = false;
        p.vote = null;
      }
    }
    this.promoteHostIfNeeded();
    this.broadcastLobby();
  }

  /* ------------------------------ tick ------------------------------ */

  private fixedStep() {
    this.tickCount++;
    const t0 = performance.now();
    switch (this.phase) {
      case 'loading': {
        const humans = [...this.players.values()].filter((p) => !p.isBot && p.inRound && p.connection === 'connected');
        if (humans.every((p) => p.loaded) || this.tickCount >= this.phaseDeadlineTick) this.beginCountdown();
        break;
      }
      case 'countdown':
      case 'running': {
        const sim = this.sim!;
        sim.step();
        for (const e of sim.drainEvents()) this.pendingEvents.push(e);
        if (this.phase === 'countdown' && sim.phase === 'running') {
          this.phase = 'running';
          this.broadcast(S2C.ROUND_START, { roundId: this.roundId, durationMs: sim.phaseRemainingMs, startTick: sim.startTick });
          log('info', 'round.started', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId });
          this.broadcastLobby();
        }
        if (sim.finished) {
          this.onRoundFinished();
          break;
        }
        if (this.tickCount % TICKS_PER_SNAPSHOT === 0) {
          this.flushPaint();
          this.sendSnapshots();
        }
        break;
      }
      case 'finishing':
        if (this.tickCount >= this.phaseDeadlineTick) {
          this.phase = 'results';
          this.phaseDeadlineTick = this.tickCount + MATCH.resultsTimeoutSeconds * TICK_RATE;
          this.broadcastLobby();
        }
        break;
      case 'results':
        if (this.tickCount >= this.phaseDeadlineTick) this.returnToLobby();
        break;
      default:
        break;
    }
    const dtMs = performance.now() - t0;
    this.tickDurations.push(dtMs);
    if (this.tickDurations.length >= TICK_RATE * 30) {
      const s = [...this.tickDurations].sort((a, b) => a - b);
      const q = (x: number) => Math.round(s[Math.floor(s.length * x)] * 100) / 100;
      log('debug', 'room.tick_stats', { matchId: this.matchId, p50: q(0.5), p95: q(0.95), p99: q(0.99) });
      this.tickDurations = [];
    }
  }

  private flushPaint() {
    if (!this.sim) return;
    for (const d of this.sim.paint.flushDeltas()) {
      const bytes = encodePaintDelta(d);
      for (const c of this.clients) {
        const p = this.players.get(this.bySessionId.get(c.sessionId) ?? -1);
        if (p?.inRound) c.sendBytes(S2C.PAINT_DELTA, bytes);
      }
    }
  }

  private sendSnapshots() {
    const sim = this.sim;
    if (!sim) return;
    const tuples: RemotePlayerTuple[] = [];
    for (const sp of sim.players.values()) tuples.push(remoteTuple(sp));
    const objects: WorldObjectState[] = sim.objects.map((o) =>
      o.kind === 'moringa'
        ? { id: o.id, kind: 'moringa', team: o.team, owner: o.owner, p: r2(o.pos), t: o.armed ? Math.max(0, 1 - o.fuse / MORINGA.fuse) : 0 }
        : { id: o.id, kind: 'wheel', team: o.team, owner: o.owner, p: r2(o.pos), t: o.deployed ? Math.min(1, o.deployAge / RODA_DE_OLEIRO.lifetime) : 0, hp: Math.max(0, Math.round(o.hp)) },
    );
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const sc: [number, number, number] = [sim.paint.teamUnits[0], sim.paint.teamUnits[1], sim.layout.totalScoringUnits];
    for (const c of this.clients) {
      const p = this.players.get(this.bySessionId.get(c.sessionId) ?? -1);
      if (!p || !p.inRound) continue;
      const sp = sim.players.get(p.playerId);
      const msg: SnapshotMessage = {
        t: sim.tick,
        ack: sp?.lastProcessedSeq ?? 0,
        ph: this.phase,
        tl: Math.round(sim.phaseRemainingMs),
        me: sp ? toSelfSnapshot(sp.state) : null,
        pl: tuples,
        ob: objects,
        ev: events.filter((e) => e.to === undefined || e.to === p.playerId).map((e) => e.ev),
        sc,
      };
      c.send(S2C.SNAPSHOT, msg);
    }
  }
}

function r2(v: [number, number, number]): [number, number, number] {
  return [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100, Math.round(v[2] * 100) / 100];
}

export function remoteTuple(sp: SimPlayer): RemotePlayerTuple {
  const s = sp.state;
  let flags = 0;
  if (s.alive) flags |= PFLAG_ALIVE;
  if (s.grounded) flags |= PFLAG_GROUNDED;
  if (s.submerged) flags |= PFLAG_SUBMERGED;
  if (s.climbSurface >= 0) flags |= PFLAG_CLIMBING;
  if (s.groundState === GROUND_ENEMY) flags |= PFLAG_IN_ENEMY_INK;
  if (s.charging) flags |= PFLAG_CHARGING;
  if (s.firingTimer > 0) flags |= PFLAG_FIRING;
  if (s.spawnProtect > 0) flags |= PFLAG_PROTECTED;
  if (s.dragging) flags |= PFLAG_DRAGGING;
  if (s.swingPhase === 1) flags |= PFLAG_SWINGING;
  if (s.travelPhase === 1) flags |= PFLAG_TRAVEL_PREP;
  if (s.travelPhase === 2) flags |= PFLAG_TRAVEL_FLY;
  if (s.special >= RODA_DE_OLEIRO.pointsRequired) flags |= PFLAG_SPECIAL_READY;
  return [
    sp.id,
    Math.round(s.pos[0] * 100),
    Math.round(s.pos[1] * 100),
    Math.round(s.pos[2] * 100),
    Math.round(s.yaw * 1000),
    Math.round(s.pitch * 1000),
    s.form,
    flags,
    Math.round(s.hp),
    Math.round(s.charge * 100),
    Math.round(s.vel[0] * 100),
    Math.round(s.vel[2] * 100),
  ];
}
