import type { RoomPhase, TeamId, WeaponId } from '@borrifo/game-contracts';
import { createStore } from '../app/store';

export interface KillfeedEntry {
  id: number;
  killer: string | null;
  killerTeam: TeamId | null;
  victim: string;
  victimTeam: TeamId;
  cause: string;
  mine: boolean;
}

export interface RosterEntry {
  playerId: number;
  name: string;
  team: TeamId;
  alive: boolean;
  isMe: boolean;
  specialReady: boolean;
}

/** Estado do HUD (atualizado ~15 Hz pelo runtime; React só lê). */
export interface HudState {
  active: boolean;
  phase: RoomPhase;
  timeLeftMs: number;
  myTeam: TeamId;
  weaponId: WeaponId;
  hp: number;
  ink: number;
  special: number;
  specialActive: boolean;
  alive: boolean;
  respawnIn: number;
  protectedFor: number;
  form: number;
  submerged: boolean;
  inEnemyInk: boolean;
  charging: boolean;
  charge: number;
  secondaryReady: boolean;
  territory: [number, number];
  roster: RosterEntry[];
  killfeed: KillfeedEntry[];
  denied: string | null;
  travelPhase: number;
  fps: number;
  corrections: number;
  pendingInputs: number;
}

export const hudStore = createStore<HudState>({
  active: false,
  phase: 'lobby',
  timeLeftMs: 0,
  myTeam: 0,
  weaponId: 'esguicho',
  hp: 100,
  ink: 100,
  special: 0,
  specialActive: false,
  alive: true,
  respawnIn: 0,
  protectedFor: 0,
  form: 0,
  submerged: false,
  inEnemyInk: false,
  charging: false,
  charge: 0,
  secondaryReady: true,
  territory: [0, 0],
  roster: [],
  killfeed: [],
  denied: null,
  travelPhase: 0,
  fps: 0,
  corrections: 0,
  pendingInputs: 0,
});

/** Elementos atualizados direto no DOM a cada frame (sem React). */
export const hudDom: { reticle: HTMLDivElement | null; blocked: HTMLDivElement | null; hitmarker: HTMLDivElement | null; damage: HTMLDivElement | null } = {
  reticle: null,
  blocked: null,
  hitmarker: null,
  damage: null,
};
