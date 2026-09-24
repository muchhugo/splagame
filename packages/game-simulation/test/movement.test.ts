import { beforeAll, describe, expect, it } from 'vitest';
import { Buttons, FORM_COMBAT, FORM_FLOW, GROUND_ENEMY, GROUND_OWN, TICK_DT, neutralInput, type PlayerInput, type TeamId, type Vec3 } from '@borrifo/game-contracts';
import { ESGUICHO, ESTILINGUE, INK, MOVEMENT, RODO, WEAPONS, type WeaponDefinition } from '@borrifo/game-content';
import { PaintLayout, PaintState, PhysicsWorld, createPlayerState, initPhysics, stepPlayer, type PlayerSimState, type StepContext, type StepIntents } from '../src/index';
import { TEST_MAP } from './fixtures';

let layout: PaintLayout;
let physics: PhysicsWorld;
beforeAll(async () => {
  await initPhysics();
  layout = PaintLayout.build(TEST_MAP);
  physics = new PhysicsWorld(TEST_MAP);
});

function rig(pos: Vec3, yaw: number, weapon: WeaponDefinition = ESGUICHO, team: TeamId = 0) {
  const paint = new PaintState(layout);
  paint.reset(1, 1);
  const body = physics.createCharacter(MOVEMENT);
  const s = createPlayerState(pos, yaw);
  const ctx: StepContext = { body, physics, paint: { layout, owner: paint.owner }, team, weapon, tuning: MOVEMENT };
  let seq = 0;
  let actionId = 0;
  const step = (partial: Partial<PlayerInput> & { actions?: PlayerInput['pressedActions'][number]['kind'][] } = {}, n = 1): StepIntents[] => {
    const out: StepIntents[] = [];
    for (let i = 0; i < n; i++) {
      const input: PlayerInput = { ...neutralInput(++seq, yaw, 0), ...partial, sequence: seq, pressedActions: (partial.actions ?? []).map((k) => ({ actionId: ++actionId, kind: k })) };
      out.push(stepPlayer(s, input, TICK_DT, ctx));
      partial = { ...partial, actions: [] };
    }
    return out;
  };
  const paintAt = (center: Vec3, radius: number, t: TeamId) => paint.paintSplat({ center, radius, team: t, seed: 1, occluded: (a, b) => physics.segmentBlocked(a, b, 0.08) });
  return { s, ctx, step, paint, paintAt, body };
}

const hspeed = (s: PlayerSimState) => Math.hypot(s.vel[0], s.vel[2]);

describe('locomoção da forma de combate', () => {
  it('diagonal é normalizada e a velocidade não passa do alvo', () => {
    const r = rig([-6, 0, -3], 0);
    r.step({ moveX: 1, moveY: 1 }, 30);
    expect(hspeed(r.s)).toBeLessThanOrEqual(MOVEMENT.walkSpeed + 1e-6);
    expect(hspeed(r.s)).toBeGreaterThan(MOVEMENT.walkSpeed * 0.95);
  });

  it('não atravessa paredes nem acumula velocidade empurrando-as', () => {
    const r = rig([-3, 0, 0], Math.PI / 2); // de frente para a parede em x = -0.25
    r.step({ moveY: 1 }, 90);
    expect(r.s.pos[0]).toBeLessThan(-0.25 - MOVEMENT.capsuleRadius + 0.05);
    expect(hspeed(r.s)).toBeLessThan(0.5);
  });

  it('não sobe degrau arbitrário (caixa de 1 m) andando', () => {
    const r = rig([-5.85, 0, -9.2], 0); // atrás da caixa fina, andando em +z
    r.step({ moveY: 1 }, 45);
    expect(r.s.pos[1]).toBeLessThan(0.2);
  });

  it('salto respeita gravidade e pousa; ação duplicada não gera salto duplo', () => {
    const r = rig([-6, 0, 3], 0);
    r.step({}, 5);
    const input: PlayerInput = { ...neutralInput(100, 0, 0), pressedActions: [{ actionId: 999, kind: 'jump' }] };
    const i1 = stepPlayer(r.s, input, TICK_DT, r.ctx);
    const i2 = stepPlayer(r.s, { ...input, sequence: 101 }, TICK_DT, r.ctx); // retransmissão: mesmo actionId
    expect(i1.jumped).toBe(true);
    expect(i2.jumped).toBe(false);
    let peak = 0;
    for (let k = 0; k < 60; k++) {
      r.step({}, 1);
      peak = Math.max(peak, r.s.pos[1]);
    }
    expect(peak).toBeGreaterThan(0.9);
    expect(peak).toBeLessThan(1.6);
    expect(r.s.grounded).toBe(true);
  });
});

describe('pigmento: custo, esgotamento e recarga', () => {
  it('Esguicho consome por disparo, respeita a cadência e para sem pigmento', () => {
    const r = rig([-6, 0, 3], 0);
    r.step({}, 3);
    const shots = r.step({ heldButtons: Buttons.FIRE }, 30).reduce((a, i) => a + i.shots, 0);
    // 1 s de fogo: ~1/intervalo disparos
    expect(shots).toBeGreaterThanOrEqual(Math.floor(1 / ESGUICHO.fireInterval) - 1);
    expect(shots).toBeLessThanOrEqual(Math.ceil(1 / ESGUICHO.fireInterval) + 1);
    expect(r.s.ink).toBeCloseTo(INK.capacity - shots * ESGUICHO.inkCost, 5);
    r.s.ink = 0.5;
    const none = r.step({ heldButtons: Buttons.FIRE }, 10).reduce((a, i) => a + i.shots, 0);
    expect(none).toBe(0);
  });

  it('forma de fluxo recarrega rápido só sobre tinta própria; tinta inimiga bloqueia regeneração', () => {
    const r = rig([-5, 0, 5], 0);
    r.paintAt([-5, 0.1, 5], 1.6, 0);
    r.s.ink = 10;
    r.step({ heldButtons: Buttons.FLOW }, 30);
    expect(r.s.form).toBe(FORM_FLOW);
    expect(r.s.submerged).toBe(true);
    expect(r.s.ink).toBeGreaterThan(40);
    // tinta inimiga: sem regeneração
    const e = rig([4, 0, 6], 0);
    e.paintAt([4, 0.1, 6], 1.6, 1);
    e.s.ink = 10;
    e.step({ heldButtons: Buttons.FLOW }, 45);
    expect(e.s.groundState).toBe(GROUND_ENEMY);
    expect(e.s.ink).toBeCloseTo(10, 5);
    // chão neutro: regeneração lenta após atraso
    const n = rig([2, 0, -7], 0);
    n.s.ink = 10;
    n.step({}, 60);
    expect(n.s.ink).toBeGreaterThan(10);
    expect(n.s.ink).toBeLessThan(10 + INK.regenIdle * 2 + 0.01);
  });
});

describe('forma de fluxo', () => {
  it('é mais rápida na tinta própria, lenta no neutro e penalizada na tinta inimiga', () => {
    const own = rig([-8, 0, -6], 0);
    for (let z = -6; z <= 2; z += 1) own.paintAt([-8, 0.1, z], 1.4, 0);
    own.step({ heldButtons: Buttons.FLOW, moveY: 1 }, 20);
    expect(own.s.groundState).toBe(GROUND_OWN);
    expect(hspeed(own.s)).toBeCloseTo(MOVEMENT.flowSpeedOwnInk, 0);
    const neutral = rig([8, 0, 5], Math.PI);
    neutral.step({ heldButtons: Buttons.FLOW, moveY: 1 }, 20);
    expect(hspeed(neutral.s)).toBeLessThan(MOVEMENT.walkSpeed);
    const enemy = rig([2, 0, 6], 0);
    for (let z = 5; z <= 9; z += 1) enemy.paintAt([2, 0.1, z], 1.4, 1);
    enemy.step({ heldButtons: Buttons.FLOW, moveY: 1 }, 20);
    expect(hspeed(enemy.s)).toBeLessThanOrEqual(MOVEMENT.flowSpeedEnemyInk + 0.01);
  });

  it('pedir disparo durante o fluxo sai para o combate e só atira após a transição', () => {
    const r = rig([-6, 0, 3], 0);
    r.step({ heldButtons: Buttons.FLOW }, 10);
    expect(r.s.form).toBe(FORM_FLOW);
    const first = r.step({ heldButtons: Buttons.FLOW | Buttons.FIRE }, 1)[0];
    expect(r.s.form).toBe(FORM_COMBAT);
    expect(first.shots).toBe(0); // em transição
    const later = r.step({ heldButtons: Buttons.FLOW | Buttons.FIRE }, 12).reduce((a, i) => a + i.shots, 0);
    expect(later).toBeGreaterThan(0);
  });
});

describe('escalada', () => {
  const paintWallFace = (r: ReturnType<typeof rig>, x: number, z: number, team: TeamId) => {
    for (let y = 0.3; y <= 2.9; y += 0.5) r.paintAt([x, y, z], 1.0, team);
  };

  it('sobe parede com tinta própria e perde aderência quando o inimigo a toma', () => {
    const r = rig([1.6, 0, 0], -Math.PI / 2); // de frente para a face +x da parede
    paintWallFace(r, 0.45, 0, 0);
    r.step({ heldButtons: Buttons.FLOW }, 8);
    r.step({ heldButtons: Buttons.FLOW, moveY: 1 }, 12);
    expect(r.s.climbSurface).toBeGreaterThanOrEqual(0);
    expect(r.s.pos[1]).toBeGreaterThan(0.3);
    // inimigo pinta a parede: perde aderência e cai com transição controlada
    paintWallFace(r, 0.45, 0, 1);
    r.step({ heldButtons: Buttons.FLOW, moveY: 1 }, 2);
    expect(r.s.climbSurface).toBe(-1);
    r.step({ heldButtons: Buttons.FLOW }, 60);
    expect(r.s.pos[1]).toBeLessThan(0.1);
    expect(r.s.pos[0]).toBeGreaterThan(0.25); // continua do lado de cá (sem atravessar)
  });

  it('chega à borda superior e sai por cima com salto de borda (sem teleporte)', () => {
    const r = rig([1.6, 0, 2], -Math.PI / 2);
    paintWallFace(r, 0.45, 2, 0);
    r.step({ heldButtons: Buttons.FLOW }, 8);
    let maxStep = 0;
    let maxY = 0;
    let prev = [...r.s.pos];
    for (let k = 0; k < 45; k++) {
      r.step({ heldButtons: Buttons.FLOW, moveY: 1 }, 1);
      maxStep = Math.max(maxStep, Math.hypot(r.s.pos[0] - prev[0], r.s.pos[1] - prev[1], r.s.pos[2] - prev[2]));
      maxY = Math.max(maxY, r.s.pos[1]);
      prev = [...r.s.pos];
    }
    expect(r.s.climbSurface).toBe(-1);
    expect(maxY).toBeGreaterThan(3.0); // os pés passaram acima do topo (3 m)
    expect(r.s.pos[0]).toBeLessThan(-0.25); // saiu por cima: parede de 0,5 m ficou para trás
    expect(maxStep).toBeLessThan(0.5); // deslocamento contínuo por tick, sem teleporte
  });

  it('não escala parede sem tinta própria na face tocada, mesmo com tinta do outro lado', () => {
    const r = rig([1.6, 0, -2], -Math.PI / 2);
    paintWallFace(r, -0.45, -2, 0); // lado −x
    r.paintAt([2.2, 0.1, -2], 0.8, 0); // chão longe da parede (o respingo não alcança a face)
    r.step({ heldButtons: Buttons.FLOW }, 8);
    r.step({ heldButtons: Buttons.FLOW, moveY: 1 }, 30);
    expect(r.s.climbSurface).toBe(-1);
    expect(r.s.pos[1]).toBeLessThan(0.1);
  });
});

describe('ferramentas: cadência, carga e cancelamento', () => {
  it('Estilingue: carga mínima, máxima, custo e cancelamento pela forma de fluxo', () => {
    const r = rig([-6, 0, 3], 0, ESTILINGUE);
    r.step({ heldButtons: Buttons.FIRE }, 2);
    const early = r.step({}, 1)[0];
    expect(early.chargeRelease).toBe(0); // abaixo do mínimo: sem disparo e sem custo
    expect(early.denied).toContain('charge_low');
    expect(r.s.ink).toBeCloseTo(INK.capacity, 5);
    r.step({ heldButtons: Buttons.FIRE }, 40);
    expect(r.s.charge).toBeCloseTo(1, 5);
    const full = r.step({}, 1)[0];
    expect(full.chargeRelease).toBeCloseTo(1, 5);
    expect(r.s.ink).toBeCloseTo(INK.capacity - ESTILINGUE.maxCost, 5);
    r.step({}, 15);
    r.step({ heldButtons: Buttons.FIRE }, 15);
    expect(r.s.charging).toBe(true);
    r.step({ heldButtons: Buttons.FLOW }, 1);
    expect(r.s.charging).toBe(false);
    expect(r.s.charge).toBe(0);
  });

  it('Rodo: balanço antes do lançamento, depois arrasto com custo por movimento', () => {
    const r = rig([-8, 0, -6], 0, RODO);
    const out = r.step({ heldButtons: Buttons.FIRE }, 12);
    const flickTick = out.findIndex((i) => i.flick);
    expect(flickTick).toBeGreaterThanOrEqual(Math.floor(RODO.swingWindup / TICK_DT) - 1);
    const ink1 = r.s.ink;
    const drag = r.step({ heldButtons: Buttons.FIRE, moveY: 1 }, 30);
    expect(drag.some((i) => i.dragging)).toBe(true);
    expect(r.s.ink).toBeLessThan(ink1);
    expect(hspeed(r.s)).toBeLessThanOrEqual(RODO.dragSpeed + 0.01);
    void WEAPONS;
  });

  it('Moringa exige forma de combate e pigmento suficiente', () => {
    const r = rig([-6, 0, 3], 0);
    r.s.ink = 20;
    const a = r.step({ actions: ['secondary'] })[0];
    expect(a.throwSecondary).toBe(false);
    expect(a.denied).toContain('secondary_ink');
    r.s.ink = 100;
    const b = r.step({ actions: ['secondary'] })[0];
    expect(b.throwSecondary).toBe(true);
    expect(r.s.ink).toBeLessThan(50);
  });
});
