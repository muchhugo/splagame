import type { SelfSnapshot, TeamId, Vec3, WeaponId } from '@borrifo/game-contracts';
import { FORM_COMBAT, GROUND_NONE } from '@borrifo/game-contracts';
import { HEALTH, INK } from '@borrifo/game-content';

/**
 * Estado de simulação de um personagem. A parte "prevista" (movimento, forma,
 * pigmento, cadência) é idêntica no servidor e na previsão do cliente; vida,
 * carga especial, vivo/morto e proteção são exclusivos do servidor.
 */
export interface PlayerSimState {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  form: number;
  formTimer: number;
  grounded: boolean;
  coyote: number;
  climbSurface: number;
  climbNormal: [number, number];
  groundState: number;
  airSpeedCap: number;
  ink: number;
  inkRegenDelay: number;
  weaponCooldown: number;
  charge: number;
  charging: boolean;
  swingPhase: number;
  swingTimer: number;
  dragging: boolean;
  secondaryCooldown: number;
  prevFire: boolean;
  lastActionId: number;
  // exclusivos do servidor (replicados para HUD)
  hp: number;
  special: number;
  specialActive: boolean;
  alive: boolean;
  respawnTimer: number;
  spawnProtect: number;
  travelPhase: number;
  travelTimer: number;
  // derivados por tick
  submerged: boolean;
  firingTimer: number;
}

export function createPlayerState(pos: Vec3, yaw: number): PlayerSimState {
  return {
    pos: [pos[0], pos[1], pos[2]],
    vel: [0, 0, 0],
    yaw,
    pitch: 0,
    form: FORM_COMBAT,
    formTimer: 0,
    grounded: true,
    coyote: 0,
    climbSurface: -1,
    climbNormal: [0, 0],
    groundState: GROUND_NONE,
    airSpeedCap: 5.5,
    ink: INK.capacity,
    inkRegenDelay: 0,
    weaponCooldown: 0,
    charge: 0,
    charging: false,
    swingPhase: 0,
    swingTimer: 0,
    dragging: false,
    secondaryCooldown: 0,
    prevFire: false,
    lastActionId: 0,
    hp: HEALTH.maxHp,
    special: 0,
    specialActive: false,
    alive: true,
    respawnTimer: 0,
    spawnProtect: 0,
    travelPhase: 0,
    travelTimer: 0,
    submerged: false,
    firingTimer: 0,
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function toSelfSnapshot(s: PlayerSimState): SelfSnapshot {
  return {
    p: [r3(s.pos[0]), r3(s.pos[1]), r3(s.pos[2])],
    v: [r3(s.vel[0]), r3(s.vel[1]), r3(s.vel[2])],
    f: s.form,
    ft: r3(s.formTimer),
    g: s.grounded ? 1 : 0,
    co: r3(s.coyote),
    cs: s.climbSurface,
    cn: [r3(s.climbNormal[0]), r3(s.climbNormal[1])],
    gs: s.groundState,
    ink: r3(s.ink),
    ird: r3(s.inkRegenDelay),
    wc: r3(s.weaponCooldown),
    ch: r3(s.charge),
    cha: s.charging ? 1 : 0,
    sw: r3(s.swingPhase + s.swingTimer / 10),
    dr: s.dragging ? 1 : 0,
    sc: r3(s.secondaryCooldown),
    hp: Math.round(s.hp * 10) / 10,
    sp: Math.round(s.special * 10) / 10,
    spa: s.specialActive ? 1 : 0,
    al: s.alive ? 1 : 0,
    rs: r3(s.respawnTimer),
    pr: r3(s.spawnProtect),
    tt: s.travelPhase,
    ttt: r3(s.travelTimer),
  };
}

/** Aplica o estado autoritativo sobre o estado previsto (reconciliação). */
export function applySelfSnapshot(s: PlayerSimState, snap: SelfSnapshot, prevFireHeld: boolean): void {
  s.pos = [snap.p[0], snap.p[1], snap.p[2]];
  s.vel = [snap.v[0], snap.v[1], snap.v[2]];
  s.form = snap.f;
  s.formTimer = snap.ft;
  s.grounded = snap.g === 1;
  s.coyote = snap.co;
  s.climbSurface = snap.cs;
  s.climbNormal = [snap.cn[0], snap.cn[1]];
  s.groundState = snap.gs;
  s.ink = snap.ink;
  s.inkRegenDelay = snap.ird;
  s.weaponCooldown = snap.wc;
  s.charge = snap.ch;
  s.charging = snap.cha === 1;
  s.swingPhase = Math.floor(snap.sw + 1e-6);
  s.swingTimer = Math.max(0, (snap.sw - s.swingPhase) * 10);
  s.dragging = snap.dr === 1;
  s.secondaryCooldown = snap.sc;
  s.hp = snap.hp;
  s.special = snap.sp;
  s.specialActive = snap.spa === 1;
  s.alive = snap.al === 1;
  s.respawnTimer = snap.rs;
  s.spawnProtect = snap.pr;
  s.travelPhase = snap.tt;
  s.travelTimer = snap.ttt;
  s.prevFire = prevFireHeld;
}

export interface PlayerIdentity {
  playerId: number;
  team: TeamId;
  weaponId: WeaponId;
}
