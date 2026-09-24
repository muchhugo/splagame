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
  MAX_ROOM_HUMANS,
  MAX_TEAM_SIZE,
  PFLAG_CARRIER,
  PFLAG_EMBALO,
  PFLAG_FOLEGO,
  PFLAG_MUTIRAO,
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
  SetAppearanceSchema,
  SetOptionsSchema,
  type FormationOption,
  type FormationPlan,
  type GameModeId,
  type MapChoice,
  APPEARANCE_IDS,
  DEFAULT_APPEARANCE,
  type AppearanceId,
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
import { CATALOG_HASH, DEFAULT_MAP_ID, DEFAULT_TEAM_PAIR_ID, MAP_FAMILIES, MAP_FAMILY_IDS, MATCH, MODES, MORINGA, RODA_DE_OLEIRO, mapFor, pickTeamPair } from '@borrifo/game-content';
import { BotBrain, MatchSimulation, PhysicsWorld, toSelfSnapshot, type SimPlayer } from '@borrifo/game-simulation';
import type { ZodType } from 'zod';
import { AuthError, sanitizeDisplayName, type CredentialVerifier, type VerifiedIdentity } from '../auth';
import { log } from '../logger';
import { KeyedRateLimiter, TokenBucket } from '../rateLimit';
import type { ResultSink } from '../results';
import { staticWorld, type StaticWorld } from '../world';
import { planFormation, type Formation } from '../formation';

interface RoomPlayer {
  playerId: number;
  userId: string | null;
  displayName: string;
  avatarUrl: string | null;
  appearance: AppearanceId;
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
  /** Ordem de chegada (desempate da fila). */
  joinOrder: number;
  /** Rodadas seguidas na fila: prioridade na próxima formação. */
  sitOuts: number;
  /** Na fila/espectador nesta rodada. */
  queued: boolean;
}

export interface ArenaDeps {
  verifier: CredentialVerifier;
  sink: ResultSink;
  roundDurationSeconds: number;
  correioDurationSeconds: number;
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
  /** Opções da partida (anfitrião, no lobby). */
  private mode: GameModeId = 'territorio';
  private mapChoice: MapChoice = 'rotacao';
  private formation: FormationOption = 'flex';
  /** Família da próxima rodada na rotação (alterna a cada rodada). */
  private rotation = 0;
  private joinCounter = 0;

  /* ------------------------- autenticação ------------------------- */

  static override async onAuth(_token: string | undefined, options: unknown, context: AuthContext): Promise<VerifiedIdentity> {
    const ip = context.ip ?? 'desconhecido';
    if (!ArenaRoom.joinLimiter.take(ip)) throw new ServerError(429, 'muitas tentativas de entrada; aguarde');
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(400, 'opções de entrada inválidas');
    const { activitySessionId, credential, mapHash } = parsed.data;
    // o cliente precisa de TODAS as variantes na mesma versão: qualquer escolha do servidor é carregável
    if (mapHash !== CATALOG_HASH) throw new ServerError(409, 'versão dos mapas incompatível com o servidor; recarregue a Atividade');
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
    this.maxClients = MAX_ROOM_HUMANS + 2;
    this.maxMessagesPerSecond = MAX_CLIENT_MESSAGES_PER_SECOND;
    this.world = staticWorld(DEFAULT_MAP_ID);
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
    if (humans.length >= MAX_ROOM_HUMANS) throw new ServerError(409, 'sala cheia');
    const midRound = this.phase !== 'lobby' && this.phase !== 'results';
    const team = this.pickTeamForNewcomer();
    const p: RoomPlayer = {
      playerId: this.nextPlayerId++,
      userId: auth.userId,
      displayName: sanitizeDisplayName(auth.displayName),
      avatarUrl: auth.avatarUrl,
      appearance: DEFAULT_APPEARANCE,
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
      joinOrder: this.joinCounter++,
      sitOuts: 0,
      queued: false,
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
    // Correio do Ara: quem cai da conexão solta a cápsula (o slot segue na rodada)
    this.sim?.dropObjective(p.playerId);
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
    this.guarded(C2S.SET_APPEARANCE, SetAppearanceSchema, (p, m, client) => {
      if (this.phase !== 'lobby' && this.phase !== 'results') return this.notice(client, 'wrong_phase', 'Troque de visual entre rodadas.');
      p.appearance = m.appearance;
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
    this.guarded(C2S.SET_OPTIONS, SetOptionsSchema, (p, m, client) => {
      if (p.playerId !== this.hostPlayerId) return this.notice(client, 'not_host', 'Só quem organiza a sala muda as opções da partida.');
      if (this.phase !== 'lobby') return this.notice(client, 'wrong_phase', 'Mude as opções no lobby.');
      if (m.map !== undefined && m.map !== 'rotacao' && !MAP_FAMILY_IDS.includes(m.map)) return this.notice(client, 'invalid_message', 'Mapa desconhecido.');
      if (m.mode !== undefined) this.mode = m.mode;
      if (m.map !== undefined) this.mapChoice = m.map;
      if (m.formation !== undefined) this.formation = m.formation as FormationOption;
      this.broadcastLobby();
    });
    this.guarded(C2S.START, StartSchema, (p, _m, client) => {
      if (p.playerId !== this.hostPlayerId) return this.notice(client, 'not_host', 'Só quem organiza a sala pode iniciar.');
      if (this.phase !== 'lobby') return this.notice(client, 'wrong_phase', 'A partida já começou.');
      const humans = [...this.players.values()].filter((x) => !x.isBot && x.connection === 'connected');
      const notReady = humans.filter((x) => x.playerId !== p.playerId && !x.ready);
      if (notReady.length) return this.notice(client, 'not_all_ready', `Aguardando: ${notReady.map((x) => x.displayName).join(', ')}`);
      const plan = this.plan();
      if (plan.f.blocked) return this.notice(client, 'not_all_ready', plan.f.blocked);
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
      if (humans.length && humans.every((x) => x.vote === 'rematch') && !this.plan().f.blocked) this.startRound();
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

  /** Família de mapa da próxima rodada (rotação alterna a cada rodada iniciada). */
  private nextFamily(): string {
    if (this.mapChoice !== 'rotacao') return this.mapChoice;
    return MAP_FAMILIES[this.rotation % MAP_FAMILIES.length].id;
  }

  /**
   * Formação e mapa da PRÓXIMA rodada, a partir de quem está conectado. Mostrado no
   * lobby antes do início; aplicado em startRound. Nunca muda a rodada em andamento.
   */
  private plan(): { f: Formation; mapId: string } {
    const cands = [...this.players.values()]
      .filter((p) => !p.isBot && p.connection === 'connected' && p.connection !== ('replaced_by_bot' as string))
      .map((p) => ({ playerId: p.playerId, team: p.team, joinOrder: p.joinOrder, sitOuts: p.sitOuts }));
    const f = planFormation(cands, this.formation, this.fillWithBots);
    const mapId = mapFor(this.nextFamily(), Math.max(2, f.active)).id;
    return { f, mapId };
  }

  private planWire(): FormationPlan {
    const { f, mapId } = this.plan();
    const teamOf: Record<number, TeamId> = {};
    for (const [id, t] of f.teamOf) teamOf[id] = t;
    return { teamSize: f.teamSize, humans: f.humans, bots: f.bots, queue: f.queue, teamOf, active: f.active, mapId, variant: staticWorld(mapId).map.variant, blocked: f.blocked };
  }

  private lobbyState(): LobbyState {
    const players: LobbyPlayer[] = [...this.players.values()]
      .sort((a, b) => a.playerId - b.playerId)
      .map((p) => ({
        playerId: p.playerId,
        userId: p.userId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        appearance: p.appearance,
        isBot: p.isBot,
        team: p.team,
        weaponId: p.weaponId,
        ready: p.ready,
        connection: p.isBot ? 'bot' : p.connection,
        loaded: p.loaded,
        inRound: p.inRound,
        queued: p.queued,
      }));
    const plan = this.planWire();
    // no lobby/resultado mostra o mapa planejado; durante a rodada, o mapa em jogo
    const shown = this.phase === 'lobby' || this.phase === 'results' ? staticWorld(plan.mapId).map : this.world.map;
    return {
      phase: this.phase,
      matchId: this.matchId,
      roundId: this.roundId,
      hostPlayerId: this.hostPlayerId,
      fillWithBots: this.fillWithBots,
      maxTeamSize: MAX_TEAM_SIZE,
      players,
      map: { id: shown.id, name: shown.name, family: shown.family, variant: shown.variant },
      mode: this.mode,
      mapChoice: this.mapChoice,
      formation: this.formation,
      plan,
      // duração efetiva do modo da rodada (planejado no lobby; em jogo, o da simulação)
      roundDurationSeconds: MODES[this.sim && this.phase !== 'lobby' ? this.sim.mode : this.mode].durationSeconds === null ? ArenaRoom.deps.roundDurationSeconds : ArenaRoom.deps.correioDurationSeconds,
      phaseRemainingMs: this.phaseRemainingMs(),
      rematchVotes: [...this.players.values()].filter((p) => p.vote === 'rematch').map((p) => p.playerId),
      lastResult: this.lastResult,
      teamPairId: this.teamPairId,
    };
  }

  private roundLoading(): RoundLoadingMessage {
    return { matchId: this.matchId, roundId: this.roundId, mapId: this.world.map.id, mapHash: this.world.mapHash, mode: this.sim?.mode ?? this.mode, teamPairId: this.teamPairId, timeoutMs: MATCH.loadingTimeoutSeconds * 1000 };
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
      catalogHash: CATALOG_HASH,
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
    // formação e mapa definidos ANTES da rodada (mudanças de grupo valem para a próxima)
    const { f, mapId } = this.plan();
    const humans = [...this.players.values()];
    for (const p of humans) {
      const t = f.teamOf.get(p.playerId);
      p.loaded = false;
      p.vote = null;
      if (t === undefined) {
        // fila/espectador: avisado antes; entra com prioridade na próxima revanche
        p.inRound = false;
        p.queued = true;
        p.sitOuts++;
        const c = this.clients.find((x) => x.sessionId === p.sessionId);
        if (c) this.notice(c, 'queued', 'Formação completa: você fica na fila e entra na próxima rodada.');
      } else {
        p.team = t;
        p.inRound = true;
        p.queued = false;
        p.sitOuts = 0;
      }
    }
    for (const team of [0, 1] as const) {
      for (let k = 0; k < f.bots[team]; k++) {
        const id = this.nextPlayerId++;
        this.players.set(id, {
          playerId: id,
          userId: null,
          displayName: BOT_NAMES[(id + team) % BOT_NAMES.length],
          avatarUrl: null,
          // bots variam entre as duas bases e os tons (identificados como bots na interface)
          appearance: APPEARANCE_IDS[(id * 3) % APPEARANCE_IDS.length],
          isBot: true,
          team,
          weaponId: (['esguicho', 'rodo', 'estilingue', 'esguicho'] as const)[(f.humans[team] + k) % 4],
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
          joinOrder: Number.MAX_SAFE_INTEGER,
          sitOuts: 0,
          queued: false,
        });
      }
    }
    // mapa e física da rodada (troca só entre rodadas)
    if (!this.physics || this.world.map.id !== mapId) {
      this.physics?.dispose();
      this.world = staticWorld(mapId);
      this.physics = new PhysicsWorld(this.world.map);
    }
    if (this.mapChoice === 'rotacao') this.rotation++;
    const seed = (Math.random() * 2 ** 31) | 0;
    this.teamPairId = pickTeamPair(this.paletteSeed, this.roundId).id;
    const modeDef = MODES[this.mode];
    this.sim = new MatchSimulation({
      map: this.world.map,
      layout: this.world.layout,
      physics: this.physics,
      matchId: this.matchId,
      roundId: this.roundId,
      contextTag: paintContextTag(this.matchId, this.world.mapHash),
      seed,
      durationSeconds: modeDef.durationSeconds === null ? ArenaRoom.deps.roundDurationSeconds : ArenaRoom.deps.correioDurationSeconds,
      countdownSeconds: MATCH.countdownSeconds,
      mode: this.mode,
    });
    for (const p of [...this.players.values()].filter((x) => x.inRound).sort((a, b) => a.playerId - b.playerId)) {
      const sp = this.sim.addPlayer(p.playerId, p.displayName, p.team, p.weaponId, p.isBot);
      if (p.isBot || p.connection === 'replaced_by_bot') sp.bot = new BotBrain(this.world.nav, this.botSeed++);
    }
    log('info', 'round.loading', { activitySessionId: this.activitySessionId, matchId: this.matchId, roundId: this.roundId, players: this.sim.players.size, mapId: this.world.map.id, mode: this.mode, teamSize: f.teamSize, queued: f.queue.length });
    for (const c of this.clients) {
      const p = this.players.get(this.bySessionId.get(c.sessionId) ?? -1);
      if (p?.inRound) c.send(S2C.ROUND_LOADING, this.roundLoading());
    }
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
        p.queued = false;
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
    for (const sp of sim.players.values()) tuples.push(remoteTuple(sp, sim.isCarrier(sp.id)));
    const objects: WorldObjectState[] = sim.objects.map((o) =>
      o.kind === 'moringa'
        ? { id: o.id, kind: 'moringa', team: o.team, owner: o.owner, p: r2(o.pos), t: o.armed ? Math.max(0, 1 - o.fuse / MORINGA.fuse) : 0 }
        : { id: o.id, kind: 'wheel', team: o.team, owner: o.owner, p: r2(o.pos), t: o.deployed ? Math.min(1, o.deployAge / RODA_DE_OLEIRO.lifetime) : 0, hp: Math.max(0, Math.round(o.hp)) },
    );
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const sc: [number, number, number] = [sim.paint.teamUnits[0], sim.paint.teamUnits[1], sim.layout.totalScoringUnits];
    const obj = sim.objectiveSnapshot();
    const pk = sim.pickupSnapshot();
    for (const c of this.clients) {
      const p = this.players.get(this.bySessionId.get(c.sessionId) ?? -1);
      if (!p || !p.inRound) continue;
      const sp = sim.players.get(p.playerId);
      const msg: SnapshotMessage = {
        t: sim.tick,
        ack: sp?.lastProcessedSeq ?? 0,
        ph: this.phase,
        tl: Math.round(sim.phaseRemainingMs),
        me: sp ? { ...toSelfSnapshot(sp.state), bf: sp.mode.buff, bt: Math.round(sp.mode.buffTicks / TICK_RATE * 10) / 10, mt: Math.round(sp.mode.mutiraoTicks / TICK_RATE * 10) / 10, mc: Math.round(sp.mode.mutiraoCooldownTicks / TICK_RATE * 10) / 10 } : null,
        pl: tuples,
        ob: objects,
        ev: events.filter((e) => e.to === undefined || e.to === p.playerId).map((e) => e.ev),
        sc,
        ...(obj ? { obj } : {}),
        ...(pk ? { pk } : {}),
      };
      c.send(S2C.SNAPSHOT, msg);
    }
  }
}

function r2(v: [number, number, number]): [number, number, number] {
  return [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100, Math.round(v[2] * 100) / 100];
}

export function remoteTuple(sp: SimPlayer, carrier = false): RemotePlayerTuple {
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
  // informação pública do modo: portador e buffs ativos (efeito visível no personagem)
  if (carrier) flags |= PFLAG_CARRIER;
  if (sp.mode.buff === 'embalo' && sp.mode.buffTicks > 0) flags |= PFLAG_EMBALO;
  if (sp.mode.buff === 'folego' && sp.mode.buffTicks > 0) flags |= PFLAG_FOLEGO;
  if (sp.mode.mutiraoTicks > 0) flags |= PFLAG_MUTIRAO;
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
