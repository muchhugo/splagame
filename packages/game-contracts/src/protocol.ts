import { z } from 'zod';
import type { TeamId } from './teams';
import type { Vec3 } from './vec';

/* ------------------------------------------------------------------ */
/* Identificadores                                                     */
/* ------------------------------------------------------------------ */

export type WeaponId = 'esguicho' | 'rodo' | 'estilingue';
export const WEAPON_IDS: readonly WeaponId[] = ['esguicho', 'rodo', 'estilingue'];

/**
 * Aparência COSMÉTICA do personagem, escolhida pelo jogador: base humana ('a' =
 * apresentação masculina, 'b' = apresentação feminina) × tom de pele (0–3) ×
 * cabelo (0–3) × cor do cabelo (0–5). Não muda hitbox, movimento nem regras, e
 * nunca é deduzida de foto, nome ou voz.
 *
 * Forma compacta `a1` (legado: cabelo e cor padrão da base) ou completa `a1h2c3`.
 * `APPEARANCE_IDS` são as predefinições (bots, vitrine).
 */
type AppBase = 'a' | 'b';
type D4 = '0' | '1' | '2' | '3';
type D6 = D4 | '4' | '5';
export type AppearanceId = `${AppBase}${D4}` | `${AppBase}${D4}h${D4}c${D6}`;
export const APPEARANCE_IDS = ['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2', 'b3'] as const satisfies readonly AppearanceId[];
export const DEFAULT_APPEARANCE: AppearanceId = 'a1';
export const HAIR_STYLE_COUNT = 4;
export const HAIR_COLOR_COUNT = 6;
export const APPEARANCE_RE = /^[ab][0-3](h[0-3]c[0-5])?$/;
export function isAppearanceId(v: unknown): v is AppearanceId {
  return typeof v === 'string' && APPEARANCE_RE.test(v);
}
export interface AppearanceParts {
  base: AppBase;
  tone: number;
  hair: number;
  hairColor: number;
}
/** Decompõe (a forma legado usa o cabelo e a cor originais da base). */
export function parseAppearanceId(id: string | undefined): AppearanceParts {
  const a = id && APPEARANCE_RE.test(id) ? id : DEFAULT_APPEARANCE;
  const base: AppBase = a[0] === 'b' ? 'b' : 'a';
  const tone = Number(a[1]);
  if (a.length === 2) return { base, tone, hair: base === 'a' ? 0 : 1, hairColor: base === 'a' ? 0 : 1 };
  return { base, tone, hair: Number(a[3]), hairColor: Number(a[5]) };
}
export function formatAppearanceId(p: AppearanceParts): AppearanceId {
  const c = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n) || 0));
  return `${p.base}${c(p.tone, 3)}h${c(p.hair, 3)}c${c(p.hairColor, 5)}` as AppearanceId;
}

/**
 * Estados da sala. Espelha a máquina de estados documentada em docs/architecture.md:
 * LOBBY → LOADING → COUNTDOWN → RUNNING → FINISHING → RESULTS → (LOBBY | LOADING)
 */
/** Modos de jogo: território (padrão, preservado) e Correio do Ara (objetivo móvel). */
export const GAME_MODES = ['territorio', 'correio'] as const;
export type GameModeId = (typeof GAME_MODES)[number];

/**
 * Formação escolhida por quem organiza: 'flex' dimensiona pelo número de pessoas prontas;
 * um número fixa o limite por equipe (1 = 1 × 1 … 8 = 8 × 8).
 */
export type FormationOption = 'flex' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const FormationOptionSchema = z.union([z.literal('flex'), z.number().int().min(1).max(8)]);

/** Mapa escolhido: rotação entre as famílias ou uma família fixa (a variante sai do tamanho). */
export type MapChoice = 'rotacao' | string;

export type RoomPhase = 'lobby' | 'loading' | 'countdown' | 'running' | 'finishing' | 'results' | 'closed';

/* ------------------------------------------------------------------ */
/* Mensagens cliente → servidor                                        */
/* ------------------------------------------------------------------ */

export const C2S = {
  INPUT: 'in',
  SET_TEAM: 'lobby.team',
  SET_WEAPON: 'lobby.weapon',
  SET_APPEARANCE: 'lobby.appearance',
  SET_READY: 'lobby.ready',
  SET_BOTS: 'lobby.bots',
  SET_OPTIONS: 'lobby.options',
  START: 'lobby.start',
  LOADED: 'round.loaded',
  VOTE: 'results.vote',
  PAINT_RESYNC: 'paint.resync',
  PING: 'ping',
} as const;

export const SetTeamSchema = z.object({ team: z.union([z.literal(0), z.literal(1)]) }).strict();
export const SetWeaponSchema = z.object({ weaponId: z.enum(['esguicho', 'rodo', 'estilingue']) }).strict();
export const SetAppearanceSchema = z.object({ appearance: z.string().max(8).regex(APPEARANCE_RE).transform((v) => v as AppearanceId) }).strict();
export const SetReadySchema = z.object({ ready: z.boolean() }).strict();
export const SetBotsSchema = z.object({ enabled: z.boolean() }).strict();
/** Opções da partida (só anfitrião, só no lobby). A família de mapa é validada no servidor. */
export const SetOptionsSchema = z
  .object({
    mode: z.enum(GAME_MODES).optional(),
    map: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/).optional(),
    formation: FormationOptionSchema.optional(),
  })
  .strict();
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
    /** Hash do CATÁLOGO de mapas do cliente (todas as variantes); o servidor recusa versões diferentes. */
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
  /** Mapa planejado/atual da sala e hash do catálogo (cliente confere antes de jogar). */
  map: { id: string; version: number; hash: string };
  catalogHash: string;
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
  /** Aparência cosmética escolhida (igual para todos os clientes). */
  appearance: AppearanceId;
  ready: boolean;
  connection: ConnectionStatus;
  loaded: boolean;
  /** Falso para quem entrou com a partida em andamento e aguarda a próxima rodada. */
  inRound: boolean;
  /** Na fila/espectador para a próxima rodada (formação cheia ou número ímpar sem bots). */
  queued: boolean;
}

/** Formação real calculada pelo servidor, mostrada antes do início. */
export interface FormationPlan {
  /** Jogadores por equipe na próxima rodada (0 = não dá para começar). */
  teamSize: number;
  /** Humanos por equipe no plano. */
  humans: [number, number];
  /** Bots por equipe no plano. */
  bots: [number, number];
  /** playerIds que ficam na fila (entram na próxima revanche com prioridade). */
  queue: number[];
  /** Equipe planejada de cada playerId humano no plano. */
  teamOf: Record<number, TeamId>;
  /** Total ativo (humanos + bots): define a variante do mapa. */
  active: number;
  /** Variante e mapa resultantes. */
  mapId: string;
  variant: 'compacto' | 'padrao' | 'ampliado';
  /** Motivo quando teamSize = 0 (ex.: sozinho sem bots). */
  blocked: string | null;
}

export interface LobbyState {
  phase: RoomPhase;
  matchId: string;
  roundId: number;
  hostPlayerId: number | null;
  fillWithBots: boolean;
  maxTeamSize: number;
  players: LobbyPlayer[];
  /** Mapa da próxima rodada (ou da atual, durante a partida). */
  map: { id: string; name: string; family: string; variant: 'compacto' | 'padrao' | 'ampliado' };
  mode: GameModeId;
  mapChoice: MapChoice;
  formation: FormationOption;
  plan: FormationPlan;
  roundDurationSeconds: number;
  /** Tempo restante de uma contagem/timeout de fase, em ms, relativo ao envio. */
  phaseRemainingMs: number | null;
  rematchVotes: number[];
  lastResult: RoundResult | null;
  /** Par de cores/nomes de apresentação da rodada atual (id de TEAM_PAIRS), escolhido pelo servidor. */
  teamPairId: string;
}

export interface RoundLoadingMessage {
  matchId: string;
  roundId: number;
  mapId: string;
  mapHash: string;
  mode: GameModeId;
  /** Par de cores/nomes desta rodada; igual para quem entra ou reconecta. */
  teamPairId: string;
  timeoutMs: number;
  /** No banco: assiste à rodada como espectador (sem personagem, sem entradas). */
  spectator?: boolean;
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
  /** Correio do Ara: entregas feitas por este jogador. */
  deliveries: number;
  /** Mutirões ativados junto de um aliado. */
  mutiroes: number;
}

export interface RoundResult {
  matchId: string;
  roundId: number;
  mapId: string;
  mode: GameModeId;
  /** Correio do Ara: entregas por equipe (território: [0, 0]). */
  deliveries: [number, number];
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
  sm?: number; // multiplicador de velocidade horizontal (Embalo)
  im?: number; // multiplicador de recarga de pigmento (Fôlego/Mutirão)
  ac?: number; // teto de velocidade horizontal no ar (velocidade do último chão)
  bf?: BuffKind | null; // buff ativo
  bt?: number; // tempo restante do buff (s)
  bk?: number; // ticks restantes do buff (exato: a previsão desliga o Embalo no mesmo tick)
  mt?: number; // tempo restante do Mutirão (s)
  mc?: number; // recarga do Mutirão (s)
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
/** Portador da cápsula (informação pública do Correio do Ara). */
export const PFLAG_CARRIER = 1 << 13;
export const PFLAG_EMBALO = 1 << 14;
export const PFLAG_FOLEGO = 1 << 15;
export const PFLAG_MUTIRAO = 1 << 16;
/**
 * Oculto para quem recebe: a posição é a ÚLTIMA vista (congelada), sem velocidade, mira
 * nem estado de ação. O servidor só manda isso a adversários e ao banco; aliados recebem
 * a posição real. O cliente não desenha, não toca som nem mira em quem vem oculto.
 */
export const PFLAG_HIDDEN = 1 << 17;

export type BuffKind = 'embalo' | 'folego';

/**
 * Estados explícitos da cápsula do Correio do Ara. 'aguardando' só antes da primeira
 * aparição. Transições: disponivel → carregada → (caida ↔ carregada) → em_entrega →
 * entregue → disponivel; caida abandonada → retornando → disponivel.
 */
export type CapsuleState = 'aguardando' | 'disponivel' | 'carregada' | 'caida' | 'em_entrega' | 'entregue' | 'retornando';

export interface ObjectiveSnapshot {
  st: CapsuleState;
  /** Posição da cápsula (no portador, quando carregada). */
  p: Vec3;
  /** playerId do portador (público), ou null. */
  c: number | null;
  /** Índice da estação ativa em map.objectives.stations. */
  s: number;
  /** Fração da área da estação com a tinta de cada equipe. */
  sp: [number, number];
  /** Progresso da entrega em curso (0..1). */
  pr: number;
  /** Entregas por equipe. */
  d: [number, number];
  /** Segundos até mudar de estado (retorno, reaparecimento), 0 se não se aplica. */
  t: number;
}

/** Pickups de buff: disponível ou tempo até reaparecer. */
export interface PickupSnapshot {
  i: number;
  k: BuffKind;
  a: 0 | 1;
  t: number;
  /** Ticks exatos até aparecer (0 se disponível): a previsão acerta o tick da coleta. */
  tk?: number;
}

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
  | { k: 'denied'; reason: string }
  | { k: 'buff'; pid: number; kind: BuffKind; replaced: BuffKind | null; pickup: number }
  | { k: 'buffEnd'; pid: number; kind: BuffKind }
  | { k: 'pickupSpawn'; pickup: number; kind: BuffKind }
  | { k: 'mutirao'; a: number; b: number; team: TeamId; p: Vec3 }
  | { k: 'capsule'; st: CapsuleState; pid: number | null; team: TeamId | null; station: number };

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
  /** Correio do Ara (só nesse modo). */
  obj?: ObjectiveSnapshot;
  /** Pickups de buff (quando o modo usa buffs). */
  pk?: PickupSnapshot[];
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
  | 'late_join_waiting'
  | 'queued';

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
