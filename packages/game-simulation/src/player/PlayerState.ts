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
  /**
   * Modificadores definidos pelo SERVIDOR (buff Embalo; Fôlego/Mutirão) e replicados
   * para a previsão local: multiplicam só a velocidade horizontal e a recarga de pigmento.
   */
  speedMul: number;
  inkRegenMul: number;
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
    speedMul: 1,
    inkRegenMul: 1,
    submerged: false,
    firingTimer: 0,
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Estado próprio para a reconciliação. Posição, velocidade e temporizadores vão SEM
 * arredondar: o msgpack codifica não inteiros como float64 de qualquer jeito (arredondar
 * não economiza banda) e meio milímetro de diferença basta para o controlador de
 * personagem decidir diferente no cliente e no servidor (correção de ~0,1 m).
 */
export function toSelfSnapshot(s: PlayerSimState): SelfSnapshot {
  return {
    p: [s.pos[0], s.pos[1], s.pos[2]],
    v: [s.vel[0], s.vel[1], s.vel[2]],
    f: s.form,
    ft: s.formTimer,
    g: s.grounded ? 1 : 0,
    co: s.coyote,
    cs: s.climbSurface,
    cn: [s.climbNormal[0], s.climbNormal[1]],
    gs: s.groundState,
    ink: s.ink,
    ird: s.inkRegenDelay,
    wc: s.weaponCooldown,
    ch: s.charge,
    cha: s.charging ? 1 : 0,
    sw: s.swingPhase + s.swingTimer / 10,
    dr: s.dragging ? 1 : 0,
    sc: s.secondaryCooldown,
    hp: Math.round(s.hp * 10) / 10,
    sp: Math.round(s.special * 10) / 10,
    spa: s.specialActive ? 1 : 0,
    al: s.alive ? 1 : 0,
    rs: r3(s.respawnTimer),
    pr: s.spawnProtect,
    tt: s.travelPhase,
    ttt: s.travelTimer,
    sm: s.speedMul,
    im: s.inkRegenMul,
    ac: s.airSpeedCap,
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
  s.speedMul = snap.sm ?? 1;
  if (snap.ac !== undefined) s.airSpeedCap = snap.ac;
  s.inkRegenMul = snap.im ?? 1;
}

export interface PlayerIdentity {
  playerId: number;
  team: TeamId;
  weaponId: WeaponId;
}
