import type { GameEvent, PlayerInput, TeamId, Vec3, WeaponId } from '@borrifo/game-contracts';
import type { CharacterBody } from '../physics/PhysicsWorld';
import type { PlayerSimState } from '../player/PlayerState';

export interface PlayerStats {
  /** Unidades de área pontuável conquistadas (estatística individual). */
  paintedUnits: number;
  eliminations: number;
  deaths: number;
  specialsUsed: number;
}

export interface SimPlayer {
  id: number;
  name: string;
  team: TeamId;
  weaponId: WeaponId;
  isBot: boolean;
  state: PlayerSimState;
  body: CharacterBody;
  inputQueue: PlayerInput[];
  lastInput: PlayerInput;
  staleTicks: number;
  lastProcessedSeq: number;
  /** Ticks simulados com entrada repetida ainda não compensados. */
  inputDebt: number;
  hpRegenDelay: number;
  stats: PlayerStats;
  contactCooldowns: Map<number, number>;
  /** Controlador de bot, quando o slot é controlado pelo servidor. */
  bot: BotController | null;
  /** Posições recentes (tick → pés) para testes e diagnóstico. */
  lastDamagedBy: number | null;
  travel: TravelState | null;
}

export interface TravelState {
  targetId: number;
  destination: Vec3 | null;
  origin: Vec3;
}

export interface BotController {
  think(self: SimPlayer, sim: unknown): PlayerInput;
}

export interface Projectile {
  id: number;
  owner: number;
  team: TeamId;
  kind: 'droplet' | 'flick';
  pos: Vec3;
  vel: Vec3;
  age: number;
  straightTime: number;
  gravity: number;
  maxLife: number;
  damage: number;
  paintRadius: number;
  dripRadius: number;
  dripDone: boolean;
  hitRadius: number;
  /** Flick do Rodo: grupo para limitar o dano total por alvo. */
  group: number;
}

export interface MoringaObject {
  id: number;
  kind: 'moringa';
  owner: number;
  team: TeamId;
  pos: Vec3;
  vel: Vec3;
  age: number;
  fuse: number;
  armed: boolean;
  resting: boolean;
  bounces: number;
}

export interface WheelObject {
  id: number;
  kind: 'wheel';
  owner: number;
  team: TeamId;
  pos: Vec3;
  vel: Vec3;
  age: number;
  deployed: boolean;
  deployAge: number;
  hp: number;
  /** Ondas: índice → raio já processado; dano uma vez por onda por alvo. */
  waveRadius: number[];
  waveHit: Array<Set<number>>;
}

export type WorldObject = MoringaObject | WheelObject;

export interface AddressedEvent {
  ev: GameEvent;
  /** Se definido, só este jogador recebe (ex.: ação recusada). */
  to?: number;
}
