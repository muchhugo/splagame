import type { PlayerInput, TeamId, Vec3 } from '@borrifo/game-contracts';
import { Buttons, FORM_COMBAT, FORM_FLOW, GROUND_ENEMY, GROUND_NEUTRAL, GROUND_NONE, GROUND_OWN } from '@borrifo/game-contracts';
import type { MovementTuning, WeaponDefinition } from '@borrifo/game-content';
import { INK, MORINGA } from '@borrifo/game-content';
import { approach, clamp, forwardFromYaw, rightFromYaw, lerp } from '../math';
import type { CharacterBody, PhysicsWorld } from '../physics/PhysicsWorld';
import type { PaintLayout } from '../paint/PaintLayout';
import type { PlayerSimState } from './PlayerState';

/** Consulta de tinta compartilhada: movimento, recarga, penalidade e escalada usam a mesma fonte. */
export interface PaintQuery {
  layout: PaintLayout;
  owner: Int8Array;
}

export interface StepContext {
  body: CharacterBody;
  physics: PhysicsWorld;
  paint: PaintQuery;
  team: TeamId;
  weapon: WeaponDefinition;
  tuning: MovementTuning;
  /** Verdadeiro na previsão do cliente durante o replay (sem efeitos cosméticos). */
  replay?: boolean;
}

export interface StepIntents {
  /** Disparos do emissor contínuo neste tick. */
  shots: number;
  /** Rodo: lançamento do leque neste tick. */
  flick: boolean;
  /** Rodo: arrasto ativo (pintura em faixa + contato). */
  dragging: boolean;
  /** Estilingue: carga liberada (0 = nenhum disparo). */
  chargeRelease: number;
  throwSecondary: boolean;
  specialRequested: boolean;
  travelTarget: number;
  jumped: boolean;
  /** Ações recusadas pelo estado atual (para feedback). */
  denied: string[];
}

const FOOT_SAMPLE_OFFSETS: Array<[number, number]> = [
  [0, 0],
  [0.2, 0],
  [-0.2, 0],
  [0, 0.2],
  [0, -0.2],
];

const FOOT_PROBE: Vec3 = [0, 0, 0];

/** Classifica a tinta sob os pés com histerese (evita oscilação na borda das células). */
export function sampleGround(pos: Vec3, team: TeamId, paint: PaintQuery, prev: number): number {
  let own = 0,
    enemy = 0,
    none = 0;
  for (let k = 0; k < FOOT_SAMPLE_OFFSETS.length; k++) {
    FOOT_PROBE[0] = pos[0] + FOOT_SAMPLE_OFFSETS[k][0];
    FOOT_PROBE[1] = pos[1];
    FOOT_PROBE[2] = pos[2] + FOOT_SAMPLE_OFFSETS[k][1];
    const hit = paint.layout.floorAt(FOOT_PROBE);
    if (!hit) {
      none++;
      continue;
    }
    const o = paint.owner[hit.cell];
    if (o === team) own++;
    else if (o !== -1) enemy++;
  }
  if (own >= 3) return GROUND_OWN;
  if (enemy >= 3) return GROUND_ENEMY;
  if (prev === GROUND_OWN && own >= 2) return GROUND_OWN;
  if (prev === GROUND_ENEMY && enemy >= 2) return GROUND_ENEMY;
  if (none === FOOT_SAMPLE_OFFSETS.length) return GROUND_NONE;
  return GROUND_NEUTRAL;
}

/** Dono da tinta na parede atrás do personagem escalando; null se não há parede. */
export function wallOwnerBehind(pos: Vec3, normal: [number, number], height: number, ctx: StepContext): { owner: number; surface: number } | null {
  const n: Vec3 = [normal[0], 0, normal[1]];
  const origin: Vec3 = [pos[0], pos[1] + height, pos[2]];
  const reach = ctx.tuning.capsuleRadius + 0.35;
  const hit = ctx.physics.raycast(origin, [-n[0], 0, -n[2]], reach);
  if (!hit) return null;
  if (Math.abs(hit.normal[1]) > 0.35) return null;
  const w = ctx.paint.layout.wallAt(hit.point, hit.normal, 0.08);
  if (!w) return { owner: -2, surface: -1 }; // parede existe mas não é pintável
  return { owner: ctx.paint.owner[w.cell], surface: w.surface.index };
}

export function emptyIntents(): StepIntents {
  return { shots: 0, flick: false, dragging: false, chargeRelease: 0, throwSecondary: false, specialRequested: false, travelTarget: -1, jumped: false, denied: [] };
}

/**
 * Um passo fixo do personagem. Mesma função no servidor (autoridade) e no
 * cliente (previsão/reconciliação). Não gera projéteis: devolve intenções que
 * o servidor valida e materializa.
 */
export function stepPlayer(s: PlayerSimState, input: PlayerInput, dt: number, ctx: StepContext): StepIntents {
  const T = ctx.tuning;
  const out = emptyIntents();
  s.yaw = input.yaw;
  s.pitch = input.pitch;
  if (!s.alive || s.travelPhase !== 0) {
    s.vel = [0, 0, 0];
    s.charging = false;
    s.charge = 0;
    s.dragging = false;
    s.swingPhase = 0;
    return out;
  }

  const fireHeld = (input.heldButtons & Buttons.FIRE) !== 0;
  const flowHeld = (input.heldButtons & Buttons.FLOW) !== 0;

  // ---------- ações discretas (deduplicadas por actionId) ----------
  let jumpRequested = false;
  for (const a of input.pressedActions) {
    if (a.actionId <= s.lastActionId) continue;
    s.lastActionId = a.actionId;
    if (a.kind === 'jump') jumpRequested = true;
    else if (a.kind === 'special') out.specialRequested = true;
    else if (a.kind === 'tacticalTravel' && a.targetPlayerId !== undefined) out.travelTarget = a.targetPlayerId;
    else if (a.kind === 'secondary') {
      if (s.form !== FORM_COMBAT || s.formTimer > 0) out.denied.push('secondary_form');
      else if (s.secondaryCooldown > 0) out.denied.push('secondary_cooldown');
      else if (s.ink < MORINGA.inkCost) out.denied.push('secondary_ink');
      else {
        s.ink -= MORINGA.inkCost;
        s.inkRegenDelay = INK.regenDelay;
        s.secondaryCooldown = MORINGA.cooldown;
        out.throwSecondary = true;
      }
    }
  }

  // ---------- forma ----------
  // Pedir disparo durante o fluxo inicia a saída para a forma de combate.
  const wantFlow = flowHeld && !fireHeld;
  s.formTimer = Math.max(0, s.formTimer - dt);
  if (wantFlow && s.form !== FORM_FLOW) {
    s.form = FORM_FLOW;
    s.formTimer = T.combatToFlowTime;
    s.charging = false;
    s.charge = 0;
    s.dragging = false;
    s.swingPhase = 0;
    s.swingTimer = 0;
  } else if (!wantFlow && s.form === FORM_FLOW) {
    s.form = FORM_COMBAT;
    s.formTimer = T.flowToCombatTime;
    if (s.climbSurface >= 0) detachFromWall(s, T.climbDetachPush);
  }
  const flowSettled = s.form === FORM_FLOW && s.formTimer <= 0;

  // ---------- intenção de movimento ----------
  const fwd = forwardFromYaw(input.yaw);
  const right = rightFromYaw(input.yaw);
  let wx = fwd[0] * input.moveY + right[0] * input.moveX;
  let wz = fwd[2] * input.moveY + right[2] * input.moveX;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) {
    wx /= wl;
    wz /= wl;
  }

  const w = ctx.weapon;
  const climbing = s.climbSurface >= 0;

  if (climbing) {
    stepClimbing(s, input, dt, ctx, jumpRequested, wx, wz, out);
  } else {
    // velocidade alvo conforme forma, tinta e ferramenta
    let speed: number;
    if (s.form === FORM_FLOW && flowSettled) {
      speed = s.groundState === GROUND_OWN ? T.flowSpeedOwnInk : s.groundState === GROUND_ENEMY ? T.flowSpeedEnemyInk : T.flowSpeedNeutral;
    } else {
      speed = s.groundState === GROUND_OWN ? T.walkSpeedOwnInk : s.groundState === GROUND_ENEMY ? T.walkSpeedEnemyInk : T.walkSpeed;
      if (s.form === FORM_COMBAT) {
        if (w.kind === 'automatic' && fireHeld && s.ink >= w.inkCost) speed *= w.moveSpeedFactor;
        else if (w.kind === 'charge' && s.charging) speed *= w.chargingMoveFactor;
        else if (w.kind === 'contact') {
          if (s.swingPhase === 1) speed *= w.swingMoveFactor;
          else if (s.dragging) speed = Math.min(speed, w.dragSpeed);
        }
      }
    }
    // Embalo: só a velocidade horizontal (não muda hitbox, projéteis, viagem tática nem colisão)
    speed *= s.speedMul;
    if (!s.grounded) speed = Math.max(speed, s.airSpeedCap);
    else s.airSpeedCap = speed;

    const accel = s.grounded ? (wl > 0.01 ? T.groundAccel : T.groundDecel) : T.airAccel;
    const tx = wx * speed;
    const tz = wz * speed;
    // aproxima o vetor horizontal do alvo, sem ultrapassar (sem velocidade acumulada)
    const dvx = tx - s.vel[0];
    const dvz = tz - s.vel[2];
    const dvl = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dvl <= maxDv) {
      s.vel[0] = tx;
      s.vel[2] = tz;
    } else {
      s.vel[0] += (dvx / dvl) * maxDv;
      s.vel[2] += (dvz / dvl) * maxDv;
    }

    // salto (com coyote time)
    if (jumpRequested && (s.grounded || s.coyote > 0)) {
      let js = T.jumpSpeed;
      if (s.groundState === GROUND_ENEMY) js = T.jumpSpeedEnemyInk;
      else if (flowSettled && s.groundState === GROUND_OWN) js = T.jumpSpeedFlowOwn;
      s.vel[1] = js;
      s.grounded = false;
      s.coyote = 0;
      out.jumped = true;
    }
    // gravidade
    if (!s.grounded || s.vel[1] > 0) s.vel[1] = Math.max(-T.maxFallSpeed, s.vel[1] - T.gravity * dt);
    else s.vel[1] = -1; // mantém contato com o chão

    ctx.body.setSnap(s.grounded && s.vel[1] <= 0);
    const desired: Vec3 = [s.vel[0] * dt, s.vel[1] * dt, s.vel[2] * dt];
    const res = ctx.body.move(s.pos, desired);
    s.pos = [s.pos[0] + res.moved[0], s.pos[1] + res.moved[1], s.pos[2] + res.moved[2]];
    // corrige a velocidade pelo deslocamento efetivo (bloqueios não acumulam velocidade)
    if (Math.abs(res.moved[0]) < Math.abs(desired[0]) - 1e-5) s.vel[0] = res.moved[0] / dt;
    if (Math.abs(res.moved[2]) < Math.abs(desired[2]) - 1e-5) s.vel[2] = res.moved[2] / dt;
    if (desired[1] > 0 && res.moved[1] < desired[1] - 1e-4) s.vel[1] = Math.min(0, s.vel[1]); // teto
    const wasGrounded = s.grounded;
    s.grounded = res.grounded;
    if (s.grounded && s.vel[1] < 0) s.vel[1] = 0;
    if (s.grounded) s.coyote = T.coyoteTime;
    else s.coyote = wasGrounded && s.vel[1] <= 0 ? T.coyoteTime : Math.max(0, s.coyote - dt);

    // entrar na escalada: fluxo assentado, empurrando contra parede com tinta própria
    if (flowSettled && wl > 0.2) {
      for (const c of res.contacts) {
        const n = c.normal;
        if (Math.abs(n[1]) > 0.35) continue;
        const nl = Math.hypot(n[0], n[2]);
        const nx = n[0] / nl,
          nz = n[2] / nl;
        if (wx * -nx + wz * -nz < 0.3) continue;
        const wall = wallOwnerBehind(s.pos, [nx, nz], 0.35, { ...ctx });
        if (wall && wall.owner === ctx.team) {
          s.climbSurface = wall.surface;
          s.climbNormal = [nx, nz];
          s.vel = [0, Math.max(0, s.vel[1]), 0];
          s.grounded = false;
          break;
        }
      }
    }
  }

  // ---------- estado do chão, imersão, pigmento ----------
  if (s.climbSurface >= 0) s.groundState = GROUND_OWN;
  else s.groundState = sampleGround(s.pos, ctx.team, ctx.paint, s.groundState);
  s.submerged = s.form === FORM_FLOW && s.formTimer <= 0 && (s.climbSurface >= 0 || (s.grounded && s.groundState === GROUND_OWN));

  s.inkRegenDelay = Math.max(0, s.inkRegenDelay - dt);
  // Fôlego/Mutirão aceleram só a RECARGA (nunca além do tanque, nem durante o atraso após atacar)
  if (s.submerged) s.ink = Math.min(INK.capacity, s.ink + INK.refillSubmerged * s.inkRegenMul * dt);
  else if (s.inkRegenDelay <= 0 && s.groundState !== GROUND_ENEMY) s.ink = Math.min(INK.capacity, s.ink + INK.regenIdle * s.inkRegenMul * dt);
  s.secondaryCooldown = Math.max(0, s.secondaryCooldown - dt);

  // ---------- ferramenta ----------
  const canUseWeapon = s.form === FORM_COMBAT && s.formTimer <= 0;
  s.firingTimer = Math.max(0, s.firingTimer - dt);
  if (w.kind === 'automatic') {
    s.weaponCooldown -= dt;
    if (canUseWeapon && fireHeld) {
      while (s.weaponCooldown <= 0 && s.ink >= w.inkCost) {
        s.ink -= w.inkCost;
        s.weaponCooldown += w.fireInterval;
        s.inkRegenDelay = INK.regenDelay;
        s.firingTimer = 0.2;
        out.shots++;
      }
    }
    if (s.weaponCooldown < 0) s.weaponCooldown = 0;
  } else if (w.kind === 'contact') {
    s.weaponCooldown = Math.max(0, s.weaponCooldown - dt);
    const pressed = fireHeld && !s.prevFire;
    if (!canUseWeapon) {
      s.swingPhase = 0;
      s.dragging = false;
    } else {
      if (s.swingPhase === 0 && pressed && s.weaponCooldown <= 0 && s.ink >= w.flickCost) {
        s.swingPhase = 1;
        s.swingTimer = w.swingWindup;
      } else if (s.swingPhase === 1) {
        s.swingTimer -= dt;
        if (s.swingTimer <= 0) {
          s.ink -= w.flickCost;
          s.inkRegenDelay = INK.regenDelay;
          out.flick = true;
          s.firingTimer = 0.25;
          s.swingPhase = 2;
          s.swingTimer = w.swingRecover;
        }
      } else if (s.swingPhase === 2) {
        s.swingTimer -= dt;
        if (s.swingTimer <= 0) {
          s.swingPhase = 0;
          s.swingTimer = 0;
        }
      }
      const hspeed = Math.hypot(s.vel[0], s.vel[2]);
      s.dragging = fireHeld && s.swingPhase === 0 && s.grounded && s.ink > 0 && s.weaponCooldown <= 0;
      if (s.dragging && hspeed > 1) {
        s.ink = Math.max(0, s.ink - w.dragInkPerSecond * dt);
        s.inkRegenDelay = INK.regenDelay;
      }
      if (!fireHeld) s.dragging = false;
    }
    out.dragging = s.dragging;
  } else {
    s.weaponCooldown = Math.max(0, s.weaponCooldown - dt);
    if (!canUseWeapon) {
      s.charging = false;
      s.charge = 0;
    } else if (s.charging) {
      const maxByInk = clamp((s.ink - w.minCost) / (w.maxCost - w.minCost), 0, 1);
      s.charge = Math.min(maxByInk, s.charge + dt / w.chargeTime);
      if (!fireHeld) {
        if (s.charge >= w.minCharge) {
          out.chargeRelease = s.charge;
          s.ink -= lerp(w.minCost, w.maxCost, s.charge);
          s.inkRegenDelay = INK.regenDelay;
          s.weaponCooldown = w.fireRecovery;
          s.firingTimer = 0.3;
        } else {
          out.denied.push('charge_low');
        }
        s.charging = false;
        s.charge = 0;
      }
    } else if (fireHeld && s.weaponCooldown <= 0 && s.ink >= w.minCost) {
      s.charging = true;
      s.charge = 0;
    }
  }
  s.prevFire = fireHeld;
  return out;
}

function detachFromWall(s: PlayerSimState, push: number) {
  s.vel = [s.climbNormal[0] * push, Math.min(s.vel[1], 0), s.climbNormal[1] * push];
  s.climbSurface = -1;
  s.grounded = false;
}

function stepClimbing(s: PlayerSimState, input: PlayerInput, dt: number, ctx: StepContext, jumpRequested: boolean, wx: number, wz: number, out: StepIntents) {
  const T = ctx.tuning;
  const [nx, nz] = s.climbNormal;
  // pular da parede
  if (jumpRequested) {
    s.vel = [nx * T.wallJumpOut, T.wallJumpUp, nz * T.wallJumpOut];
    s.climbSurface = -1;
    s.grounded = false;
    out.jumped = true;
    ctx.body.setSnap(false);
    const res = ctx.body.move(s.pos, [s.vel[0] * dt, s.vel[1] * dt, s.vel[2] * dt]);
    s.pos = [s.pos[0] + res.moved[0], s.pos[1] + res.moved[1], s.pos[2] + res.moved[2]];
    return;
  }
  // a tinta da parede ainda é nossa? (perde aderência se o inimigo tomou)
  const here = wallOwnerBehind(s.pos, s.climbNormal, 0.35, ctx);
  if (!here) {
    // acabou a parede: se estávamos subindo, é a borda superior — salto de borda controlado
    const above = wallOwnerBehind(s.pos, s.climbNormal, 0.05, ctx);
    if (above && s.vel[1] > 0.5) {
      s.vel = [-nx * T.ledgeVaultForward, T.ledgeVaultUp, -nz * T.ledgeVaultForward];
    } else {
      s.vel = [nx * T.climbDetachPush, 0, nz * T.climbDetachPush];
    }
    s.climbSurface = -1;
    s.grounded = false;
  } else if (here.owner !== ctx.team) {
    detachFromWall(s, T.climbDetachPush);
  }
  if (s.climbSurface < 0) {
    ctx.body.setSnap(false);
    const res = ctx.body.move(s.pos, [s.vel[0] * dt, s.vel[1] * dt, s.vel[2] * dt]);
    s.pos = [s.pos[0] + res.moved[0], s.pos[1] + res.moved[1], s.pos[2] + res.moved[2]];
    s.grounded = res.grounded;
    return;
  }

  // Entrada: "para frente" olhando para a parede = subir; lateral ao longo da parede.
  const fwd = forwardFromYaw(input.yaw);
  const facing = -(fwd[0] * nx + fwd[2] * nz);
  const tx = nz,
    tz = -nx; // tangente horizontal
  let vert = input.moveY * (facing >= -0.2 ? 1 : -1);
  const lat = wx * tx + wz * tz;
  // afastar-se da parede com intenção clara solta a escalada
  const away = wx * nx + wz * nz;
  if (away > 0.75 && facing < -0.3) {
    detachFromWall(s, T.climbDetachPush * 1.5);
    return;
  }
  // continuidade da tinta acima: sem tinta própria acima, não sobe (mas a borda livre é permitida)
  if (vert > 0) {
    const up = wallOwnerBehind(s.pos, s.climbNormal, 1.25, ctx);
    if (up && up.owner !== ctx.team) vert = 0;
  }
  const speed = T.climbSpeed;
  let vy = vert * speed;
  if (Math.abs(vert) < 0.05 && Math.abs(lat) < 0.05) vy = -T.climbSlideSpeed;
  s.vel = [tx * lat * speed - nx * 0.6, vy, tz * lat * speed - nz * 0.6];
  ctx.body.setSnap(false);
  const desired: Vec3 = [s.vel[0] * dt, s.vel[1] * dt, s.vel[2] * dt];
  const res = ctx.body.move(s.pos, desired);
  s.pos = [s.pos[0] + res.moved[0], s.pos[1] + res.moved[1], s.pos[2] + res.moved[2]];
  // tocou o chão descendo: sai da escalada
  if (res.grounded && vy <= 0) {
    s.climbSurface = -1;
    s.grounded = true;
    s.vel = [0, 0, 0];
  } else {
    s.grounded = false;
  }
  s.coyote = 0;
  s.airSpeedCap = T.flowSpeedOwnInk;
  // mantém a velocidade vertical para detectar a borda no próximo passo
  s.vel[1] = res.moved[1] / dt;
  void approach;
}
