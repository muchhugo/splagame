import { beforeAll, describe, expect, it } from 'vitest';
import { Buttons, TICK_DT, neutralInput, type GameEvent, type PlayerInput, type TeamId, type Vec3 } from '@borrifo/game-contracts';
import { BUFFS, CORREIO, INK, MOVEMENT, MUTIRAO, type MapSpec } from '@borrifo/game-content';
import { MatchSimulation, PaintLayout, PhysicsWorld, initPhysics, type SimPlayer } from '../src/index';
import { TEST_MAP } from './fixtures';

const T = (s: number) => Math.round(s / TICK_DT);
let layout: PaintLayout;
beforeAll(async () => {
  await initPhysics();
  layout = PaintLayout.build(TEST_MAP);
});

function makeSim(mode: 'territorio' | 'correio', map: MapSpec = TEST_MAP, lay?: PaintLayout) {
  const L = lay ?? layout;
  const physics = new PhysicsWorld(map);
  const sim = new MatchSimulation({ map, layout: L, physics, matchId: 'm', roundId: 1, contextTag: 1, seed: 7, durationSeconds: 400, countdownSeconds: 0, mode });
  const events: GameEvent[] = [];
  const seqs = new Map<number, number>();
  const add = (id: number, team: TeamId, pos: Vec3) => {
    const p = sim.addPlayer(id, `p${id}`, team, 'esguicho', false);
    p.state.pos = [...pos] as Vec3;
    p.state.spawnProtect = 0;
    return p;
  };
  const input = (p: SimPlayer, partial: Partial<PlayerInput> = {}) => {
    const seq = (seqs.get(p.id) ?? 0) + 1;
    seqs.set(p.id, seq);
    sim.enqueueInput(p.id, { ...neutralInput(seq, p.state.yaw, p.state.pitch), ...partial, sequence: seq });
  };
  const step = (n = 1, each?: () => void) => {
    for (let i = 0; i < n; i++) {
      each?.();
      sim.step();
      for (const e of sim.drainEvents()) events.push(e.ev);
    }
  };
  /** Pinta um disco de raio r como `p` (passa pelo mesmo sink das ferramentas). */
  const paintAs = (p: SimPlayer, c: Vec3, r = 1) =>
    sim.paint.paintSplat({ center: [c[0], c[1] + 0.05, c[2]], radius: r, team: p.team, seed: 1, floorsOnly: true }, (sim as unknown as { sinkFor(p: SimPlayer): never }).sinkFor(p));
  return { sim, add, input, step, events, paintAs };
}

describe('buffs Embalo e Fôlego', () => {
  it('pickup só aparece no tempo anunciado; Embalo dá +15% só na velocidade horizontal por 6 s', () => {
    const { sim, add, input, step, events } = makeSim('territorio');
    const a = add(1, 0, [-3, 0, -3]);
    const ref = add(2, 1, [3, 0, -8]);
    step(T(BUFFS.firstSpawnSeconds) - 2, () => {
      input(a);
      input(ref);
    });
    expect(a.mode.buff).toBeNull();
    step(3, () => {
      input(a);
      input(ref);
    });
    expect(events.some((e) => e.k === 'pickupSpawn')).toBe(true);
    expect(a.mode.buff).toBe('embalo');
    expect(a.state.speedMul).toBeCloseTo(BUFFS.embalo.speedMul);
    // corre em linha reta: velocidade horizontal final ≈ 1,15 × a de referência
    a.state.pos = [-4, 0, -8];
    ref.state.pos = [3, 0, -8];
    step(30, () => {
      input(a, { moveY: 1, yaw: 0 });
      input(ref, { moveY: 1, yaw: 0 });
    });
    const va = Math.hypot(a.state.vel[0], a.state.vel[2]);
    const vr = Math.hypot(ref.state.vel[0], ref.state.vel[2]);
    expect(va / vr).toBeCloseTo(BUFFS.embalo.speedMul, 2);
    expect(va).toBeCloseTo(MOVEMENT.walkSpeed * BUFFS.embalo.speedMul, 1);
    step(T(BUFFS.embalo.duration), () => {
      input(a);
      input(ref);
    });
    expect(a.mode.buff).toBeNull();
    expect(a.state.speedMul).toBe(1);
    expect(events.some((e) => e.k === 'buffEnd' && e.pid === 1)).toBe(true);
  });

  it('Fôlego acelera 25% a recarga, sem passar do tanque; outro buff substitui com aviso', () => {
    const { sim, add, input, step, events } = makeSim('territorio');
    const a = add(1, 0, [3, 0, 3]);
    step(T(BUFFS.firstSpawnSeconds) + 1, () => input(a));
    expect(a.mode.buff).toBe('folego');
    a.state.ink = 10;
    a.state.inkRegenDelay = 0;
    step(30, () => input(a));
    expect(a.state.ink - 10).toBeCloseTo(INK.regenIdle * BUFFS.folego.inkMul * 30 * TICK_DT, 1);
    step(T(5), () => input(a));
    expect(a.state.ink).toBeLessThanOrEqual(INK.capacity);
    // vai ao Embalo: substitui o Fôlego (um buff ativo por vez), com o substituído no evento
    a.state.pos = [-3, 0, -3];
    step(3, () => input(a));
    expect(a.mode.buff).toBe('embalo');
    expect(events.find((e) => e.k === 'buff' && e.kind === 'embalo')).toMatchObject({ replaced: 'folego' });
    expect(a.state.inkRegenMul).toBe(1);
  });

  it('coleta simultânea: só um recebe; o pickup some e reaparece depois do tempo', () => {
    const { add, input, step, events } = makeSim('territorio');
    const a = add(1, 0, [-3.3, 0, -3]);
    const b = add(2, 1, [-2.7, 0, -3]);
    step(T(BUFFS.firstSpawnSeconds) + 1, () => {
      input(a);
      input(b);
    });
    const got = [a, b].filter((p) => p.mode.buff === 'embalo');
    expect(got.length).toBe(1);
    expect(events.filter((e) => e.k === 'buff').length).toBe(1);
    const spawnsBefore = events.filter((e) => e.k === 'pickupSpawn').length;
    step(T(BUFFS.respawnSeconds) + 1, () => {
      input(a);
      input(b);
    });
    expect(events.filter((e) => e.k === 'pickupSpawn').length).toBeGreaterThan(spawnsBefore);
  });

  it('não coleta através de parede nem dentro da proteção de spawn; eliminação remove o buff', () => {
    // pickup 1 encostado na parede central; pickup 2 dentro da zona protegida da turma 0
    const map: MapSpec = { ...TEST_MAP, objectives: { ...TEST_MAP.objectives, pickups: [{ pos: [-0.3, 0, 0], kind: 'embalo' }, { pos: [-8, 0, 1.5], kind: 'folego' }] } };
    const lay = PaintLayout.build(map);
    const { sim, add, input, step } = makeSim('territorio', map, lay);
    const across = add(1, 1, [0.62, 0, 0]); // do outro lado da parede, a menos de 1 m
    const prot = add(2, 0, [-8, 0, 1.3]);
    prot.state.spawnProtect = 30;
    step(T(BUFFS.firstSpawnSeconds) + 2, () => (input(across), input(prot)));
    expect(across.mode.buff).toBeNull();
    expect(prot.mode.buff).toBeNull();
    prot.state.spawnProtect = 0;
    step(2, () => (input(across), input(prot)));
    expect(prot.mode.buff).toBe('folego');
    (sim as unknown as { eliminate(t: SimPlayer, k: SimPlayer | null, c: string): void }).eliminate(prot, null, 'contact');
    expect(prot.mode.buff).toBeNull();
    expect(prot.state.inkRegenMul).toBe(1);
  });
});

describe('Mutirão', () => {
  it('dois aliados convertem ≥ 2 m² cada no mesmo setor em 3 s → +10% de recarga por 4 s; recarga de 20 s', () => {
    const { sim, add, input, step, events, paintAs } = makeSim('territorio');
    const a = add(1, 0, [-6, 0, -6]);
    const b = add(2, 0, [-6, 0, -3]);
    step(1, () => (input(a), input(b)));
    paintAs(a, [-7, 0, -8]);
    paintAs(b, [-4, 0, -8]);
    step(3, () => (input(a), input(b)));
    expect(events.some((e) => e.k === 'mutirao')).toBe(true);
    expect(a.mode.mutiraoTicks).toBeGreaterThan(0);
    expect(b.state.inkRegenMul).toBeCloseTo(MUTIRAO.inkMul);
    expect(a.mode.mutiroes).toBe(1);
    // novas conversões durante a recarga não reativam
    paintAs(a, [-7, 0, 8]);
    paintAs(b, [-4, 0, 8]);
    step(6, () => (input(a), input(b)));
    expect(events.filter((e) => e.k === 'mutirao').length).toBe(1);
    step(T(MUTIRAO.duration), () => (input(a), input(b)));
    expect(a.state.inkRegenMul).toBe(1);
    void sim;
  });

  it('não ativa longe (> 6 m), com área insuficiente, sem aliado (1 × 1) nem pintando o que já é da equipe', () => {
    const { add, input, step, events, paintAs } = makeSim('territorio');
    const a = add(1, 0, [-6, 0, -6]);
    const b = add(2, 0, [-6, 0, 6]);
    const enemy = add(3, 1, [6, 0, 6]);
    step(1, () => (input(a), input(b), input(enemy)));
    paintAs(a, [-8, 0, -8]);
    paintAs(b, [-8, 0, 8]); // 16 m de distância
    paintAs(enemy, [-6, 0, -8]); // inimigo perto não é aliado
    step(4, () => (input(a), input(b), input(enemy)));
    expect(events.some((e) => e.k === 'mutirao')).toBe(false);
    // já da equipe: repintar não conta
    paintAs(b, [-8, 0, -8]);
    step(4, () => (input(a), input(b), input(enemy)));
    expect(events.some((e) => e.k === 'mutirao')).toBe(false);
    // área pequena (0,3 m de raio ≈ 0,28 m²)
    paintAs(a, [-3, 0, -2], 0.3);
    paintAs(b, [-4, 0, -2], 0.3);
    step(4, () => (input(a), input(b), input(enemy)));
    expect(events.some((e) => e.k === 'mutirao')).toBe(false);
  });

  it('a mesma célula não financia outra ativação em 30 s; não acumula com Fôlego (vale o maior)', () => {
    const { add, input, step, events, paintAs } = makeSim('territorio');
    const a = add(1, 0, [-6, 0, -6]);
    const b = add(2, 0, [-6, 0, -3]);
    const e = add(3, 1, [6, 0, 6]);
    const tick = () => (input(a), input(b), input(e));
    step(1, tick);
    paintAs(a, [-7, 0, -8]);
    paintAs(b, [-4, 0, -8]);
    step(3, tick);
    expect(events.filter((x) => x.k === 'mutirao').length).toBe(1);
    step(T(MUTIRAO.cooldown) + 1, tick);
    // inimigo repinta as mesmas células; aliados reconvertem as MESMAS células (< 30 s)
    paintAs(e, [-7, 0, -8]);
    paintAs(e, [-4, 0, -8]);
    paintAs(a, [-7, 0, -8]);
    paintAs(b, [-4, 0, -8]);
    step(4, tick);
    expect(events.filter((x) => x.k === 'mutirao').length).toBe(1);
    // áreas novas ativam
    paintAs(a, [-7, 0, 8]);
    paintAs(b, [-4, 0, 8]);
    step(4, tick);
    expect(events.filter((x) => x.k === 'mutirao').length).toBe(2);
    a.mode.buff = 'folego';
    a.mode.buffTicks = 100;
    step(1, tick);
    expect(a.state.inkRegenMul).toBeCloseTo(BUFFS.folego.inkMul);
  });
});

describe('Correio do Ara', () => {
  const carry = () => {
    const h = makeSim('correio');
    const a = h.add(1, 0, [0.9, 0, 7]);
    const b = h.add(2, 1, [6, 0, 8]);
    const tick = () => (h.input(a), h.input(b));
    return { ...h, a, b, tick };
  };

  it('aparece após o tempo inicial; posse de um de cada vez; Pião-Guia indisponível para o portador', () => {
    const { sim, a, b, step, tick, events, input } = carry();
    expect(sim.correio!.state).toBe('aguardando');
    step(T(CORREIO.firstSpawnSeconds) + 2, tick);
    expect(sim.correio!.state).toBe('carregada');
    expect(sim.correio!.carrier).toBe(1);
    expect(sim.isCarrier(2)).toBe(false);
    const c = sim.objectiveSnapshot()!;
    expect(c.c).toBe(1); // portador revelado a todos
    // Pião-Guia recusado
    const ally = sim.addPlayer(5, 'p5', 0, 'esguicho', false);
    ally.state.pos = [-8, 0, -8];
    ally.state.spawnProtect = 0;
    a.state.special = 0;
    input(a, { pressedActions: [{ actionId: 1, kind: 'tacticalTravel', targetPlayerId: 5 }] });
    input(b);
    input(ally);
    sim.step();
    expect(sim.drainEvents().some((e) => e.ev.k === 'denied' && e.ev.reason === 'travel_carrying')).toBe(true);
    void events;
  });

  it('portador que cai da conexão solta a cápsula e não a recolhe parado; ao voltar, controla o slot', () => {
    const { sim, a, b, step, tick, input } = carry();
    step(T(CORREIO.firstSpawnSeconds) + 2, tick);
    expect(sim.correio!.carrier).toBe(1);
    // queda de conexão (o servidor suspende o slot e solta o objetivo)
    sim.dropObjective(1);
    sim.setSuspended(1, true);
    step(T(2), tick);
    expect(sim.correio!.carrier).not.toBe(1);
    expect(sim.correio!.state === 'caida' || sim.correio!.carrier === 2).toBe(true);
    // volta com um cliente novo: sequências e ações recomeçam do zero e valem de novo
    sim.setSuspended(1, false);
    const seqBefore = a.lastProcessedSeq;
    expect(seqBefore).toBeGreaterThan(10);
    sim.resetInputStream(1);
    const x0 = a.state.pos[0];
    for (let i = 1; i <= T(1); i++) {
      sim.enqueueInput(1, { ...neutralInput(i, Math.PI / 2, 0), moveY: 1 });
      input(b);
      sim.step();
    }
    expect(a.lastProcessedSeq).toBe(T(1));
    expect(Math.abs(a.state.pos[0] - x0)).toBeGreaterThan(1);
  });

  it('entrega exige 60% da estação com a tinta da equipe e 1,2 s dentro; alterna a estação', () => {
    const { sim, a, step, tick, paintAs, events } = carry();
    step(T(CORREIO.firstSpawnSeconds) + 2, tick);
    const st = TEST_MAP.objectives.stations[sim.correio!.station];
    expect(sim.correio!.station).toBe(0);
    a.state.pos = [st[0], 0, st[2]];
    step(T(CORREIO.deliverSeconds) + 5, tick);
    expect(sim.correio!.deliveries).toEqual([0, 0]); // estação sem tinta
    paintAs(a, st, CORREIO.stationRadius + 0.3);
    expect(sim.correio!.stationShare(0)[0]).toBeGreaterThanOrEqual(CORREIO.stationPaintShare);
    step(T(CORREIO.deliverSeconds) - 2, tick);
    expect(sim.correio!.state).toBe('em_entrega');
    expect(sim.correio!.deliveries).toEqual([0, 0]);
    step(4, tick);
    expect(sim.correio!.deliveries).toEqual([1, 0]);
    expect(a.mode.deliveries).toBe(1);
    expect(sim.correio!.state).toBe('entregue');
    expect(sim.correio!.station).toBe(1); // próxima: o outro lado
    expect(events.filter((e) => e.k === 'capsule' && e.st === 'entregue').length).toBe(1);
    step(T(CORREIO.deliveredPauseSeconds) + 1, tick);
    expect(sim.correio!.state).toBe('disponivel');
  });

  it('eliminação deixa a cápsula no chão; abandonada, retorna; nunca existem duas', () => {
    const { sim, a, b, step, tick } = carry();
    step(T(CORREIO.firstSpawnSeconds) + 2, tick);
    a.state.pos = [-7, 0, -7];
    step(3, tick);
    (sim as unknown as { eliminate(t: SimPlayer, k: SimPlayer | null, c: string): void }).eliminate(a, b, 'esguicho');
    expect(sim.correio!.state).toBe('caida');
    expect(sim.correio!.pos[1]).toBeCloseTo(0, 1);
    step(T(CORREIO.dropReturnSeconds) + 1, tick);
    expect(sim.correio!.state).toBe('retornando');
    step(T(CORREIO.returningSeconds) + 1, tick);
    expect(['disponivel', 'carregada']).toContain(sim.correio!.state);
    expect(sim.correio!.pos[2]).toBeCloseTo(7, 0);
  });

  it('adversário pega a cápsula caída; posse longa demais devolve ao centro', () => {
    const { sim, a, b, step, tick } = carry();
    step(T(CORREIO.firstSpawnSeconds) + 2, tick);
    a.state.pos = [3, 0, 8];
    step(2, tick);
    (sim as unknown as { eliminate(t: SimPlayer, k: SimPlayer | null, c: string): void }).eliminate(a, null, 'contact');
    b.state.pos = [3.3, 0, 8];
    step(2, tick);
    expect(sim.correio!.carrier).toBe(2);
    step(T(CORREIO.maxCarrySeconds) + 1, tick);
    expect(sim.correio!.state === 'retornando' || sim.correio!.state === 'disponivel' || sim.correio!.state === 'carregada').toBe(true);
    expect(sim.correio!.carrier === 2 && sim.correio!.state === 'carregada').toBe(false);
  });

  it('cinco entregas encerram a rodada com vencedor; depois do fim não há mais pontos', () => {
    const { sim, a, step, tick, paintAs } = carry();
    paintAs(a, TEST_MAP.objectives.stations[0], CORREIO.stationRadius + 0.3);
    paintAs(a, TEST_MAP.objectives.stations[1], CORREIO.stationRadius + 0.3);
    step(T(CORREIO.firstSpawnSeconds) + 2, tick);
    for (let k = 0; k < CORREIO.targetDeliveries && !sim.finished; k++) {
      a.state.pos = [0.9, 0, 7];
      for (let i = 0; i < T(CORREIO.deliveredPauseSeconds) + 10 && sim.correio!.carrier !== 1; i++) step(1, tick);
      const st = TEST_MAP.objectives.stations[sim.correio!.station];
      a.state.pos = [st[0], 0, st[2]];
      step(T(CORREIO.deliverSeconds) + 2, tick);
    }
    expect(sim.finished).toBe(true);
    const r = sim.finish('completed');
    expect(r.mode).toBe('correio');
    expect(r.deliveries).toEqual([5, 0]);
    expect(r.winner).toBe(0);
    expect(r.players.find((p) => p.playerId === 1)!.deliveries).toBe(5);
    step(10, tick);
    expect(sim.correio!.deliveries).toEqual([5, 0]);
  });

  it('empate em entregas no tempo é empate (independe da área pintada)', () => {
    const physics = new PhysicsWorld(TEST_MAP);
    const sim = new MatchSimulation({ map: TEST_MAP, layout, physics, matchId: 'm', roundId: 1, contextTag: 1, seed: 1, durationSeconds: 1, countdownSeconds: 0, mode: 'correio' });
    const a = sim.addPlayer(1, 'a', 0, 'esguicho', false);
    sim.paint.paintSplat({ center: [-5, 0.05, -5], radius: 3, team: 0, seed: 1, floorsOnly: true });
    void a;
    while (!sim.finished) sim.step();
    const r = sim.finish('completed');
    expect(r.deliveries).toEqual([0, 0]);
    expect(r.winner).toBe('draw');
    void Buttons;
  });
});

describe('bots no Correio do Ara (mesmas regras dos humanos)', () => {
  it('numa rodada só de bots, alguém pega a cápsula e uma equipe entrega pelo menos uma vez', async () => {
    const { MAPS } = await import('@borrifo/game-content');
    const { NavGraph, BotBrain } = await import('../src/index');
    const map = MAPS['toca-do-ara.compacto'];
    const lay = PaintLayout.build(map);
    const physics = new PhysicsWorld(map);
    const nav = NavGraph.build(map, lay, physics);
    const sim = new MatchSimulation({ map, layout: lay, physics, matchId: 'm', roundId: 1, contextTag: 1, seed: 3, durationSeconds: 150, countdownSeconds: 0, mode: 'correio' });
    for (let i = 1; i <= 4; i++) {
      const p = sim.addPlayer(i, `b${i}`, (i % 2) as TeamId, i <= 2 ? 'esguicho' : 'rodo', true);
      p.bot = new BotBrain(nav, i);
    }
    let picked = false;
    while (!sim.finished) {
      sim.step();
      sim.drainEvents();
      if (sim.correio!.carrier !== null) picked = true;
    }
    const r = sim.finish('completed');
    expect(picked).toBe(true);
    expect(r.deliveries[0] + r.deliveries[1]).toBeGreaterThanOrEqual(1);
    physics.dispose();
  }, 120000);
});
