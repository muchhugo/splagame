import { beforeAll, describe, expect, it } from 'vitest';
import { Buttons, INPUT_QUEUE_MAX, INPUT_STALE_TICKS, TICK_DT, neutralInput, type PlayerInput, type TeamId, type Vec3 } from '@borrifo/game-contracts';
import { HEALTH, MOVEMENT, RODA_DE_OLEIRO, PIAO_GUIA } from '@borrifo/game-content';
import { MatchSimulation, PaintLayout, PhysicsWorld, initPhysics, muzzlePosition, pitchFromDir, yawFromDir, type SimPlayer } from '../src/index';
import { TEST_MAP } from './fixtures';

let layout: PaintLayout;
beforeAll(async () => {
  await initPhysics();
  layout = PaintLayout.build(TEST_MAP);
});

function makeSim(durationSeconds = 60) {
  const physics = new PhysicsWorld(TEST_MAP);
  const sim = new MatchSimulation({ map: TEST_MAP, layout, physics, matchId: 'm', roundId: 1, contextTag: 1, seed: 1234, durationSeconds, countdownSeconds: 0 });
  const seqs = new Map<number, number>();
  const actionIds = new Map<number, number>();
  const add = (id: number, team: TeamId, pos: Vec3, weapon: 'esguicho' | 'rodo' | 'estilingue' = 'esguicho') => {
    const p = sim.addPlayer(id, `p${id}`, team, weapon, false);
    p.state.pos = [...pos] as Vec3;
    p.state.spawnProtect = 0;
    return p;
  };
  const input = (p: SimPlayer, partial: Partial<PlayerInput> & { actions?: Array<{ kind: PlayerInput['pressedActions'][number]['kind']; targetPlayerId?: number }> } = {}) => {
    const seq = (seqs.get(p.id) ?? 0) + 1;
    seqs.set(p.id, seq);
    const acts = (partial.actions ?? []).map((a) => {
      const id = (actionIds.get(p.id) ?? 0) + 1;
      actionIds.set(p.id, id);
      return { actionId: id, ...a };
    });
    const { actions: _a, ...rest } = partial;
    sim.enqueueInput(p.id, { ...neutralInput(seq, p.state.yaw, p.state.pitch), ...rest, sequence: seq, pressedActions: acts });
  };
  /** Mira do cano até um ponto. */
  const aimAt = (p: SimPlayer, target: Vec3) => {
    const m = muzzlePosition(p.state);
    const d: Vec3 = [target[0] - m[0], target[1] - m[1], target[2] - m[2]];
    const L = Math.hypot(...d);
    return { yaw: yawFromDir([d[0] / L, d[1] / L, d[2] / L]), pitch: pitchFromDir([d[0] / L, d[1] / L, d[2] / L]) };
  };
  return { sim, physics, add, input, aimAt };
}

describe('dano, eliminação e regras de equipe', () => {
  it('Esguicho elimina o adversário e credita estatísticas; aliado no caminho não bloqueia nem sofre dano', () => {
    const { sim, add, input, aimAt } = makeSim();
    const a = add(1, 0, [-3, 0, -7]);
    const ally = add(2, 0, [-1, 0, -7]);
    const b = add(3, 1, [2, 0, -7]);
    sim.step();
    for (let t = 0; t < 90 && b.state.alive; t++) {
      input(a, { ...aimAt(a, [b.state.pos[0], b.state.pos[1] + 0.9, b.state.pos[2]]), heldButtons: Buttons.FIRE });
      input(ally, {});
      input(b, {});
      sim.step();
    }
    expect(b.state.alive).toBe(false);
    expect(ally.state.hp).toBe(HEALTH.maxHp);
    expect(a.stats.eliminations).toBe(1);
    expect(b.stats.deaths).toBe(1);
    const ev = sim.drainEvents().map((e) => e.ev);
    expect(ev.some((e) => e.k === 'elim' && e.killer === 1 && e.victim === 3)).toBe(true);
  });

  it('tinta inimiga causa dano gradual NÃO letal (piso) e impede regeneração', () => {
    const { sim, add, input } = makeSim();
    const b = add(3, 1, [4, 0, 6]);
    sim.step();
    sim.paint.paintSplat({ center: [4, 0.1, 6], radius: 2.5, team: 0, seed: 1 });
    for (let t = 0; t < 30 * 12; t++) {
      input(b, {});
      sim.step();
    }
    expect(b.state.alive).toBe(true);
    expect(b.state.hp).toBeCloseTo(HEALTH.enemyInkFloor, 5);
    // sai da tinta inimiga: recupera após o atraso
    b.state.pos = [-4, 0, 6];
    for (let t = 0; t < 30 * 4; t++) {
      input(b, {});
      sim.step();
    }
    expect(b.state.hp).toBe(HEALTH.maxHp);
  });

  it('reaparece após o atraso com proteção curta que termina ao sair da área e não renova', () => {
    const { sim, add, input } = makeSim();
    const b = add(3, 1, [2, 0, -7]);
    sim.step();
    sim.damage(b, 200, null, 'esguicho');
    expect(b.state.alive).toBe(false);
    const ticks = Math.round(HEALTH.respawnDelay / TICK_DT);
    for (let t = 0; t < ticks + 1; t++) {
      input(b, {});
      sim.step();
    }
    expect(b.state.alive).toBe(true);
    expect(b.state.spawnProtect).toBeGreaterThan(0);
    const zone = TEST_MAP.spawnZones[1];
    expect(b.state.pos[0]).toBeGreaterThanOrEqual(zone.min[0]);
    // protegido: dano ignorado
    sim.damage(b, 50, null, 'esguicho');
    expect(b.state.hp).toBe(HEALTH.maxHp);
    // sai da área segura: proteção termina
    b.state.pos = [3, 0, -4];
    input(b, {});
    sim.step();
    expect(b.state.spawnProtect).toBe(0);
    // voltar à área não renova
    b.state.pos = [7, 2, 0];
    for (let t = 0; t < 10; t++) {
      input(b, {});
      sim.step();
    }
    expect(b.state.spawnProtect).toBe(0);
  });
});

describe('Moringa e obstrução', () => {
  it('explosão não causa dano nem pinta através da parede', () => {
    const { sim, add, input } = makeSim();
    const a = add(1, 0, [3, 0, 0]);
    const b = add(3, 1, [-0.9, 0, 0]); // atrás da parede em relação à moringa
    const c = add(4, 1, [1.5, 0, 1.2]); // mesmo lado da moringa
    sim.step();
    // coloca uma moringa armada direto no chão junto à face +x da parede
    sim.objects.push({ id: 999, kind: 'moringa', owner: a.id, team: 0, pos: [0.6, 0.18, 0], vel: [0, 0, 0], age: 0, fuse: 0.05, armed: true, resting: true, bounces: 0 });
    for (let t = 0; t < 5; t++) {
      input(a, {});
      input(b, {});
      input(c, {});
      sim.step();
    }
    expect(b.state.hp).toBe(HEALTH.maxHp);
    expect(c.state.hp).toBeLessThan(HEALTH.maxHp);
    const floor = layout.surfaces.find((s) => s.id === 'piso:top')!;
    let behind = 0;
    for (let k = 0; k < floor.cols * floor.rows; k++) {
      if (sim.paint.owner[floor.cellOffset + k] !== 0) continue;
      const x = floor.origin[0] + ((k % floor.cols) + 0.5) * 0.25;
      const z = floor.origin[2] + (Math.floor(k / floor.cols) + 0.5) * 0.25;
      if (x < -0.25 && Math.abs(z) < 4.5) behind++;
    }
    expect(behind).toBe(0);
  });
});

describe('carga especial verificada pelo servidor', () => {
  it('conquistar área neutra carrega; repintar área própria não carrega', () => {
    const { sim, add, input, aimAt } = makeSim();
    const a = add(1, 0, [-6, 0, 3]);
    sim.step();
    for (let t = 0; t < 30; t++) {
      input(a, { ...aimAt(a, [-6, 0, 7]), heldButtons: Buttons.FIRE });
      sim.step();
    }
    const charged = a.state.special;
    expect(charged).toBeGreaterThan(0);
    // área já pintada: continua atirando no mesmo ponto até o respingo não conquistar nada novo
    for (let t = 0; t < 60; t++) {
      input(a, { ...aimAt(a, [-6, 0, 7]), heldButtons: Buttons.FIRE });
      sim.step();
    }
    const after = a.state.special;
    a.state.ink = 100;
    for (let t = 0; t < 30; t++) {
      input(a, { ...aimAt(a, [-6, 0, 7]), heldButtons: Buttons.FIRE });
      sim.step();
    }
    // ganho marginal (bordas orgânicas), muito menor que a primeira conquista
    expect(a.state.special - after).toBeLessThan(charged * 0.35);
    // ativação só com carga cheia
    a.state.special = RODA_DE_OLEIRO.pointsRequired - 1;
    input(a, { actions: [{ kind: 'special' }] });
    sim.step();
    expect(a.state.specialActive).toBe(false);
    a.state.special = RODA_DE_OLEIRO.pointsRequired;
    input(a, { actions: [{ kind: 'special' }] });
    sim.step();
    expect(a.state.specialActive).toBe(true);
    expect(a.state.special).toBe(0);
    expect(sim.objects.some((o) => o.kind === 'wheel')).toBe(true);
  });
});

describe('término e resultado', () => {
  it('fecha exatamente uma vez, congela e rejeita passos posteriores', () => {
    const { sim, add, input } = makeSim(1);
    const a = add(1, 0, [-6, 0, 3]);
    add(2, 1, [6, 0, 3]);
    for (let t = 0; t < 40; t++) {
      input(a, { heldButtons: Buttons.FIRE, pitch: 0.5 });
      sim.step();
    }
    expect(sim.finished).toBe(true);
    const r1 = sim.finish('completed');
    const tickAtEnd = sim.tick;
    sim.step();
    sim.step();
    expect(sim.tick).toBe(tickAtEnd);
    expect(sim.finish('completed')).toBe(r1);
    expect(r1.teamUnits[0] + r1.teamUnits[1]).toBeLessThanOrEqual(r1.totalUnits);
    expect(r1.percent[0] + r1.percent[1] + r1.neutralPercent).toBeCloseTo(100, 0);
    expect(r1.winner).toBe(0);
  });

  it('empate real produz empate (valores internos exatos)', () => {
    const { sim } = makeSim(1);
    // pinta áreas simétricas idênticas (mesma semente, espelhadas no mapa simétrico)
    const floor = layout.surfaces.find((s) => s.id === 'piso:top')!;
    for (let k = 0; k < 40; k++) {
      sim.paint.setOwner(floor.cellOffset + k, 0);
      sim.paint.setOwner(floor.cellOffset + floor.cols * floor.rows - 1 - k, 1);
    }
    for (let t = 0; t < 40; t++) sim.step();
    const r = sim.finish('completed');
    expect(r.teamUnits[0]).toBe(r.teamUnits[1]);
    expect(r.winner).toBe('draw');
  });
});

describe('política de entradas', () => {
  it('descarta sequência antiga, limita a fila e neutraliza entrada ausente', () => {
    const { sim, add } = makeSim();
    const a = add(1, 0, [-6, 0, 3]);
    sim.step();
    expect(sim.enqueueInput(1, { ...neutralInput(5), moveY: 1 })).toBe('queued');
    expect(sim.enqueueInput(1, { ...neutralInput(5), moveY: 1 })).toBe('stale');
    expect(sim.enqueueInput(1, { ...neutralInput(3), moveY: 1 })).toBe('stale');
    for (let s = 6; s < 30; s++) sim.enqueueInput(1, { ...neutralInput(s), moveY: 1 });
    expect(a.inputQueue.length).toBeLessThanOrEqual(INPUT_QUEUE_MAX);
    // esgota a fila e para de enviar: o personagem deve parar após o prazo
    for (let t = 0; t < INPUT_QUEUE_MAX + INPUT_STALE_TICKS + 20; t++) sim.step();
    expect(Math.hypot(a.state.vel[0], a.state.vel[2])).toBeLessThan(0.05);
    // disparo contínuo também é neutralizado
    sim.enqueueInput(1, { ...neutralInput(100), heldButtons: Buttons.FIRE });
    for (let t = 0; t < INPUT_STALE_TICKS + 10; t++) sim.step();
    const inkBefore = a.state.ink;
    for (let t = 0; t < 20; t++) sim.step();
    expect(a.state.ink).toBeGreaterThanOrEqual(inkBefore);
    expect(sim.enqueueInput(999, neutralInput(1))).toBe('unknown');
  });
});

describe('Pião-Guia (deslocamento tático)', () => {
  it('prepara, lança e pousa perto do aliado; cancela se o aliado cai na preparação', () => {
    const { sim, add, input } = makeSim();
    const a = add(1, 0, [-8, 0, 0]);
    const ally = add(2, 0, [3, 0, -7]);
    sim.step();
    input(a, { actions: [{ kind: 'tacticalTravel', targetPlayerId: ally.id }] });
    input(ally, {});
    sim.step();
    expect(a.state.travelPhase).toBe(1);
    const total = Math.round((PIAO_GUIA.prepTime + PIAO_GUIA.flightTime) / TICK_DT) + 3;
    for (let t = 0; t < total; t++) {
      input(a, {});
      input(ally, {});
      sim.step();
    }
    expect(a.state.travelPhase).toBe(0);
    expect(Math.hypot(a.state.pos[0] - ally.state.pos[0], a.state.pos[2] - ally.state.pos[2])).toBeLessThan(PIAO_GUIA.maxDestinationSearch + 0.5);
    // cancelamento
    const b = add(3, 0, [-8, 0, 3]);
    input(b, { actions: [{ kind: 'tacticalTravel', targetPlayerId: ally.id }] });
    sim.step();
    expect(b.state.travelPhase).toBe(1);
    sim.damage(ally, 999, null, 'esguicho');
    input(b, {});
    sim.step();
    expect(b.state.travelPhase).toBe(0);
    expect(Math.hypot(b.state.pos[0] + 8, b.state.pos[2] - 3)).toBeLessThan(0.1);
    // alvo inválido (adversário) é recusado
    const enemy = add(4, 1, [6, 0, 6]);
    input(b, { actions: [{ kind: 'tacticalTravel', targetPlayerId: enemy.id }] });
    sim.step();
    expect(b.state.travelPhase).toBe(0);
    void MOVEMENT;
  });
});

describe('Roda de Oleiro: ondas, dano, linha de visão e destruição', () => {
  /** Lança a roda de `a` mirando o chão à frente e espera ela pousar. */
  const deploy = (h: ReturnType<typeof makeSim>, a: SimPlayer, others: SimPlayer[]) => {
    a.state.special = RODA_DE_OLEIRO.pointsRequired;
    h.input(a, { ...h.aimAt(a, [a.state.pos[0] + 3, 0, a.state.pos[2]]), actions: [{ kind: 'special' }] });
    for (const o of others) h.input(o, {});
    h.sim.step();
    expect(a.state.specialActive).toBe(true);
    for (let t = 0; t < 90; t++) {
      const w = h.sim.objects.find((o) => o.kind === 'wheel') as { deployed: boolean; pos: Vec3 } | undefined;
      if (w?.deployed) return w;
      h.input(a, {});
      for (const o of others) h.input(o, {});
      h.sim.step();
    }
    throw new Error('a roda não pousou');
  };

  it('pousa, solta 4 ondas que pintam o chão, fere adversários visíveis e poupa aliados e quem está atrás de parede', () => {
    const h = makeSim();
    const a = h.add(1, 0, [-5, 0, -3]);
    const ally = h.add(2, 0, [-8, 0, -6]);
    const foe = h.add(3, 1, [-8, 0, 3]);
    const hidden = h.add(4, 1, [8, 0, 8]);
    h.sim.step();
    const units0 = h.sim.paint.teamUnits[0];
    const w = deploy(h, a, [ally, foe, hidden]);
    // em volta da roda: aliado e adversário a 2,5 m (do mesmo lado da parede); outro adversário atrás da parede central
    ally.state.pos = [w.pos[0] - 2.5, w.pos[1], w.pos[2]];
    foe.state.pos = [w.pos[0], w.pos[1], w.pos[2] + 2.5];
    hidden.state.pos = [0.8, 0, w.pos[2]];
    expect(Math.hypot(hidden.state.pos[0] - w.pos[0], hidden.state.pos[2] - w.pos[2])).toBeLessThan(RODA_DE_OLEIRO.waveRadius);
    const waves: number[] = [];
    for (let t = 0; t < Math.ceil((RODA_DE_OLEIRO.lifetime + 0.5) / TICK_DT); t++) {
      for (const p of [a, ally, foe, hidden]) h.input(p, {});
      h.sim.step();
      for (const e of h.sim.drainEvents()) if (e.ev.k === 'wave') waves.push(e.ev.n);
      // o adversário fica parado no alcance das ondas (reaparece longe se for eliminado)
      if (foe.state.alive) foe.state.pos = [w.pos[0], w.pos[1], w.pos[2] + 2.5];
    }
    expect(waves).toEqual([0, 1, 2, 3]);
    expect(h.sim.paint.teamUnits[0]).toBeGreaterThan(units0 + 100);
    expect(ally.state.hp).toBe(HEALTH.maxHp);
    expect(hidden.state.hp).toBe(HEALTH.maxHp);
    // 40 por onda: o adversário exposto cai na terceira
    expect(foe.state.alive === false || foe.stats.deaths >= 1).toBe(true);
    expect(a.stats.eliminations).toBeGreaterThanOrEqual(1);
    // depois do tempo de vida: some e libera o especial
    expect(h.sim.objects.some((o) => o.kind === 'wheel')).toBe(false);
    expect(a.state.specialActive).toBe(false);
  });

  it('adversário quebra a roda com tiros antes de todas as ondas', () => {
    const h = makeSim();
    const a = h.add(1, 0, [-8, 0, -3]);
    const foe = h.add(3, 1, [-8, 0, 6]);
    h.sim.step();
    const w = deploy(h, a, [foe]);
    // a 3,5 m, com linha de tiro até a roda (a vida é reposta: o teste é sobre a roda)
    foe.state.pos = [w.pos[0] + 3.5, w.pos[1], w.pos[2]];
    let waves = 0;
    let destroyed = false;
    for (let t = 0; t < Math.ceil(RODA_DE_OLEIRO.lifetime / TICK_DT); t++) {
      foe.state.ink = 100;
      foe.state.hp = HEALTH.maxHp;
      h.input(foe, { ...h.aimAt(foe, [w.pos[0], w.pos[1] + 0.4, w.pos[2]]), heldButtons: Buttons.FIRE });
      h.input(a, {});
      h.sim.step();
      for (const e of h.sim.drainEvents()) {
        if (e.ev.k === 'wave') waves++;
        if (e.ev.k === 'objectDestroyed') destroyed = true;
      }
      if (destroyed) break;
    }
    expect(destroyed).toBe(true);
    expect(waves).toBeLessThan(RODA_DE_OLEIRO.waveCount);
    expect(a.state.specialActive).toBe(false);
    expect(h.sim.objects.some((o) => o.kind === 'wheel')).toBe(false);
  });
});
