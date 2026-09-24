import { z } from 'zod';
import type { TeamId } from './teams';
import type { Vec3 } from './vec';

/* ------------------------------------------------------------------ */
/* Identificadores                                                     */
/* ------------------------------------------------------------------ */

export type WeaponId = 'esguicho' | 'rodo' | 'estilingue';
export const WEAPON_IDS: readonly WeaponId[] = ['esguicho', 'rodo', 'estilingue'];

/**
 * Estados da sala. Espelha a máquina de estados documentada em docs/architecture.md:
 * LOBBY → LOADING → COUNTDOWN → RUNNING → FINISHING → RESULTS → (LOBBY | LOADING)
 */
export type RoomPhase = 'lobby' | 'loading' | 'countdown' | 'running' | 'finishing' | 'results' | 'closed';

/* ------------------------------------------------------------------ */
/* Mensagens cliente → servidor                                        */
/* ------------------------------------------------------------------ */

export const C2S = {
  INPUT: 'in',
  SET_TEAM: 'lobby.team',
  SET_WEAPON: 'lobby.weapon',
  SET_READY: 'lobby.ready',
  SET_BOTS: 'lobby.bots',
  START: 'lobby.start',
  LOADED: 'round.loaded',
  VOTE: 'results.vote',
  PAINT_RESYNC: 'paint.resync',
  PING: 'ping',
} as const;

export const SetTeamSchema = z.object({ team: z.union([z.literal(0), z.literal(1)]) }).strict();
export const SetWeaponSchema = z.object({ weaponId: z.enum(['esguicho', 'rodo', 'estilingue']) }).strict();
export const SetReadySchema = z.object({ ready: z.boolean() }).strict();
export const SetBotsSchema = z.object({ enabled: z.boolean() }).strict();
export const StartSchema = z.object({}).strict();
export const LoadedSchema = z.object({ roundId: z.number().int().nonnegative(), mapHash: z.string().max(64) }).strict();
export const VoteSchema = z.object({ choice: z.enum(['rematch', 'lobby']) }).strict();
export const PaintResyncSchema = z.object({ roundId: z.number().int().nonnegative(), reason: z.string().max(40) }).strict();
export const PingSchema = z.object({ c: z.number().refine(Number.isFinite) }).strict();

/** Opções enviadas no corpo do pedido de matchmaking (POST), nunca na URL. */
export const JoinOptionsSchema = z
  .object({
    activitySessionId: z.string().min(1).max(128),
    credential: z.string().min(10).max(4096),
    clientVersion: z.string().max(32),
    mapHash: z.string().max(64),
  })
  .strict();
export type JoinOptions = z.infer<typeof JoinOptionsSchema>;

/* ------------------------------------------------------------------ */
/* Mensagens servidor → cliente                                        */
/* ------------------------------------------------------------------ */

export const S2C = {
  WELCOME: 'welcome',
  LOBBY: 'lobby',
  ROUND_LOADING: 'round.loading',
  ROUND_COUNTDOWN: 'round.countdown',
  ROUND_START: 'round.start',
  ROUND_RESULT: 'round.result',
  SNAPSHOT: 'snap',
  PAINT_SNAPSHOT: 'paint.snap',
  PAINT_DELTA: 'paint.delta',
  NOTICE: 'notice',
  PONG: 'pong',
} as const;

export interface WelcomeMessage {
  protocolVersion: number;
  serverVersion: string;
  matchId: string;
  playerId: number;
  tickRate: number;
  snapshotRate: number;
  map: { id: string; version: number; hash: string };
  /** Reconexão: verdadeiro quando esta conexão recuperou um slot existente. */
  resumed: boolean;
}

export type ConnectionStatus = 'connected' | 'reconnecting' | 'bot' | 'replaced_by_bot';

export interface LobbyPlayer {
  playerId: number;
  /** userId verificado pela credencial (null para bots): liga o jogador ao participante da chamada. */
  userId: string | null;
  /** Nome já resolvido pelo servidor (apelido → nome de exibição → usuário). Texto puro. */
  displayName: string;
  /** Avatar https de host permitido, ou null (a interface mostra as iniciais). */
  avatarUrl: string | null;
  isBot: boolean;
  team: TeamId;
  weaponId: WeaponId;
  ready: boolean;
  connection: ConnectionStatus;
  loaded: boolean;
  /** Falso para quem entrou com a partida em andamento e aguarda a próxima rodada. */
  inRound: boolean;
}

export interface LobbyState {
  phase: RoomPhase;
  matchId: string;
  roundId: number;
  hostPlayerId: number | null;
  fillWithBots: boolean;
  maxTeamSize: number;
  players: LobbyPlayer[];
  map: { id: string; name: string };
  roundDurationSeconds: number;
  /** Tempo restante de uma contagem/timeout de fase, em ms, relativo ao envio. */
  phaseRemainingMs: number | null;
  rematchVotes: number[];
  lastResult: RoundResult | null;
}

export interface RoundLoadingMessage {
  matchId: string;
  roundId: number;
  mapId: string;
  mapHash: string;
  timeoutMs: number;
}

export interface RoundCountdownMessage {
  roundId: number;
  countdownMs: number;
}

export interface RoundStartMessage {
  roundId: number;
  durationMs: number;
  startTick: number;
}

export interface PlayerRoundStats {
  playerId: number;
  displayName: string;
  team: TeamId;
  isBot: boolean;
  weaponId: WeaponId;
  /** Área conquistada durante a rodada (m²), estatística individual — não decide a vitória. */
  paintedArea: number;
  eliminations: number;
  deaths: number;
  specialsUsed: number;
}

export interface RoundResult {
  matchId: string;
  roundId: number;
  mapId: string;
  /** Área pontuável total (m²). */
  totalArea: number;
  teamArea: [number, number];
  neutralArea: number;
  /** Unidades internas exatas (inteiros), usadas na decisão. */
  teamUnits: [number, number];
  totalUnits: number;
  /** Percentuais para apresentação, com uma casa decimal. */
  percent: [number, number];
  neutralPercent: number;
  winner: TeamId | 'draw';
  endedAtTick: number;
  players: PlayerRoundStats[];
  /** 'completed' ou 'interrupted' (por exemplo, encerramento do servidor). */
  status: 'completed' | 'interrupted';
}

/* ------------------------------------------------------------------ */
/* Snapshot de estado (15 Hz)                                         */
/* ------------------------------------------------------------------ */

/** Formas do personagem. */
export const FORM_COMBAT = 0;
export const FORM_FLOW = 1;

/** Estado do chão sob o jogador, com histerese. */
export const GROUND_NONE = 0;
export const GROUND_NEUTRAL = 1;
export const GROUND_OWN = 2;
export const GROUND_ENEMY = 3;

/**
 * Estado completo do próprio jogador, usado para reconciliação.
 * Campos curtos para reduzir banda.
 */
export interface SelfSnapshot {
  p: Vec3;
  v: Vec3;
  f: number; // forma
  ft: number; // transição de forma restante (s)
  g: 0 | 1; // no chão
  co: number; // coyote time restante
  cs: number; // superfície de escalada (-1 = nenhuma)
  cn: [number, number]; // normal horizontal da parede
  gs: number; // estado do chão (GROUND_*)
  ink: number;
  ird: number; // atraso de regeneração de pigmento
  wc: number; // cooldown da ferramenta
  ch: number; // carga (0..1)
  cha: 0 | 1; // carregando
  sw: number; // balanço do Rodo restante
  dr: 0 | 1; // arrastando o Rodo
  sc: number; // cooldown do dispositivo
  hp: number;
  sp: number; // carga especial (0..100)
  spa: 0 | 1; // especial ativo
  al: 0 | 1; // vivo
  rs: number; // tempo para reaparecer (s)
  pr: number; // proteção de reaparecimento restante (s)
  tt: number; // deslocamento tático: fase (0 nenhum, 1 preparando, 2 em voo)
  ttt: number; // tempo restante da fase de deslocamento tático
}

/**
 * Jogador remoto compacto:
 * [playerId, x, y, z, yaw, pitch, form, flags, hp, charge, velX, velZ]
 * posições em centímetros inteiros; ângulos em milirradianos.
 */
export type RemotePlayerTuple = [number, number, number, number, number, number, number, number, number, number, number, number];

export const PFLAG_ALIVE = 1 << 0;
export const PFLAG_GROUNDED = 1 << 1;
export const PFLAG_SUBMERGED = 1 << 2;
export const PFLAG_CLIMBING = 1 << 3;
export const PFLAG_IN_ENEMY_INK = 1 << 4;
export const PFLAG_CHARGING = 1 << 5;
export const PFLAG_FIRING = 1 << 6;
export const PFLAG_PROTECTED = 1 << 7;
export const PFLAG_DRAGGING = 1 << 8;
export const PFLAG_SWINGING = 1 << 9;
export const PFLAG_TRAVEL_PREP = 1 << 10;
export const PFLAG_TRAVEL_FLY = 1 << 11;
export const PFLAG_SPECIAL_READY = 1 << 12;

/** Objetos de mundo persistentes (Roda de Oleiro ativa, Moringa armada). */
export interface WorldObjectState {
  id: number;
  kind: 'wheel' | 'moringa';
  team: TeamId;
  owner: number;
  p: Vec3;
  /** Progresso normalizado (fusível da Moringa ou vida útil da Roda). */
  t: number;
  hp?: number;
}

export type GameEvent =
  | { k: 'shot'; pid: number; w: WeaponId | 'flick'; p: Vec3; v: Vec3; gd: number; g: number; life: number }
  | { k: 'beam'; pid: number; team: TeamId; from: Vec3; to: Vec3; charge: number }
  | { k: 'impact'; p: Vec3; n: Vec3; team: TeamId; s: number }
  | { k: 'hit'; src: number; dst: number; dmg: number; lethal: boolean }
  | { k: 'elim'; killer: number | null; victim: number; cause: WeaponId | 'moringa' | 'wheel' | 'contact' }
  | { k: 'respawn'; pid: number }
  | { k: 'throw'; id: number; pid: number; team: TeamId; kind: 'moringa' | 'wheel'; p: Vec3; v: Vec3 }
  | { k: 'burst'; id: number; team: TeamId; p: Vec3; r: number }
  | { k: 'wave'; id: number; team: TeamId; p: Vec3; r: number; n: number }
  | { k: 'objectDestroyed'; id: number }
  | { k: 'special'; pid: number; kind: 'wheel' }
  | { k: 'travel'; pid: number; target: number; to: Vec3; phase: 'prep' | 'launch' | 'land' | 'cancel' }
  | { k: 'denied'; reason: string };

export interface SnapshotMessage {
  t: number; // tick do servidor
  ack: number; // última sequência de entrada processada deste cliente
  ph: RoomPhase;
  tl: number; // ms restantes da fase atual
  me: SelfSnapshot | null;
  pl: RemotePlayerTuple[];
  ob: WorldObjectState[];
  ev: GameEvent[];
  /** Placar parcial em unidades internas [time0, time1, total]. */
  sc: [number, number, number];
}

/* ------------------------------------------------------------------ */
/* Avisos e erros                                                      */
/* ------------------------------------------------------------------ */

export type NoticeCode =
  | 'invalid_message'
  | 'rate_limited'
  | 'team_full'
  | 'not_host'
  | 'wrong_phase'
  | 'not_all_ready'
  | 'map_mismatch'
  | 'replaced'
  | 'late_join_waiting';

export interface NoticeMessage {
  code: NoticeCode;
  message: string;
}

/** Códigos de fechamento de conexão definidos pelo projeto. */
export const CloseCodes = {
  REPLACED_BY_NEW_SESSION: 4101,
  ABUSE: 4102,
  PROTOCOL_MISMATCH: 4103,
  ROOM_CLOSING: 4104,
} as const;
