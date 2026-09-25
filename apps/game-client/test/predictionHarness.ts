import { Buttons, decodeInput, encodeInput, type ActionKind, type SelfSnapshot } from '@borrifo/game-contracts';
import { TICK_RATE } from '@borrifo/game-contracts';
import { MatchSimulation, PaintLayout, PhysicsWorld, toSelfSnapshot, type SimPlayer } from '@borrifo/game-simulation';
import type { MapSpec } from '@borrifo/game-content';
import { LocalPredictor } from '../src/game/prediction/LocalPredictor';

/**
 * Bancada de previsão sem navegador: servidor (MatchSimulation) e cliente (LocalPredictor)
 * no mesmo processo, com uma fila de latência simétrica em ticks. O cliente envia uma
 * entrada por tick; o servidor manda o próprio estado a cada 2 ticks, como a sala. O
 * cliente consulta a tinta do servidor (isola as fontes de erro de movimento).
 */
export interface Script {
  (tick: number, s: { pos: readonly number[]; grounded: boolean }): { move: [number, number]; yaw: number; buttons?: number; actions?: ActionKind[] };
}

export function runPrediction(map: MapSpec, layout: PaintLayout, rttMs: number, ticks: number, script: Script, setup?: (sim: MatchSimulation, p: SimPlayer) => void, burst = 1) {
  const physics = new PhysicsWorld(map);
  const sim = new MatchSimulation({ map, layout, physics, matchId: 'm', roundId: 1, contextTag: 1, seed: 3, durationSeconds: 600, countdownSeconds: 0, mode: 'territorio' });
  const p = sim.addPlayer(1, 'ana', 0, 'esguicho', false);
  p.state.spawnProtect = 0;
  // o primeiro tick é a contagem (0 s): consome entrada sem mover; sai dela antes de medir
  sim.step();
  sim.drainEvents();
  setup?.(sim, p);
  const clientPhysics = new PhysicsWorld(map);
  const pred = new LocalPredictor(clientPhysics, sim.paint, 0, 'esguicho', [...p.state.pos] as never, p.state.yaw);
  pred.state.pos = [...p.state.pos] as never;
  pred.setMapPickups(map.objectives.pickups);
  const oneWay = Math.round(rttMs / 2 / (1000 / TICK_RATE));
  const up: Array<{ at: number; input: Parameters<MatchSimulation['enqueueInput']>[1] }> = [];
  const down: Array<{ at: number; me: SelfSnapshot; ack: number; pk: ReturnType<MatchSimulation['pickupSnapshot']> }> = [];
  const corr: Array<{ tick: number; mag: number; air: boolean; embalo: boolean }> = [];
  for (let t = 0; t < ticks; t++) {
    // cliente: recebe o que chegou, reconcilia, prevê o próximo tick e envia
    while (down.length && down[0].at <= t) {
      const d = down.shift()!;
      const before = pred.correctionLog.length;
      pred.reconcile(d.me, d.ack, { buff: d.me.bf, buffTicks: d.me.bk, pickups: d.pk ?? undefined });
      const mag = pred.correctionLog[before] ?? pred.correctionLog.at(-1) ?? 0;
      corr.push({ tick: t, mag, air: !d.me.g || !pred.state.grounded, embalo: (d.me.sm ?? 1) > 1 || pred.state.speedMul > 1 });
    }
    const cmd = script(t, pred.state);
    const st = pred.step(cmd.move, cmd.yaw, 0, cmd.buttons ?? 0, cmd.actions ?? []);
    // `burst` > 1 emula o cliente a poucos quadros por segundo: as entradas saem juntas a cada
    // `burst` ticks, com variação de ±1 tick no momento do quadro
    const sendAt = burst > 1 ? Math.ceil((t + 1) / burst) * burst + (Math.floor(t / burst) % 3 === 1 ? 1 : 0) : t;
    // como na rede: o servidor recebe o que o fio carrega (codificado e decodificado)
    up.push({ at: sendAt + oneWay, input: decodeInput(encodeInput(st.input)) });
    up.sort((a, b) => a.at - b.at || a.input.sequence - b.input.sequence);
    // servidor
    while (up.length && up[0].at <= t) sim.enqueueInput(1, up.shift()!.input);
    sim.step();
    sim.drainEvents();
    if (sim.tick % 2 === 0) {
      const me: SelfSnapshot = { ...toSelfSnapshot(p.state), bf: p.mode.buff, bt: Math.round((p.mode.buffTicks / TICK_RATE) * 10) / 10, ...(OPTS.exactBuff ? { bk: p.mode.buffTicks } : {}) };
      down.push({ at: t + oneWay, me, ack: p.lastProcessedSeq, pk: OPTS.exactBuff ? sim.pickupSnapshot() : null });
    }
  }
  pred.dispose();
  return { corr, sim, p };
}

export function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (k: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : 0);
  return { n: s.length, over5cm: s.filter((x) => x > 0.05).length, over25cm: s.filter((x) => x > 0.25).length, p95: q(0.95), max: s.length ? s[s.length - 1] : 0, sum: Math.round(s.reduce((a, b) => a + b, 0) * 1000) / 1000 };
}

export const FLOW = Buttons.FLOW;
/** Liga/desliga o que o servidor manda para a previsão do buff (comparar antes/depois). */
export const OPTS = { exactBuff: true };

/** Gerador determinístico (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Perfis de intervalo entre quadros do cliente (ms). `lab` = medido no SwiftShader compartilhado. */
export const FRAME_PROFILES: Record<string, (r: () => number) => number> = {
  '60fps': (r) => 16.7 + (r() - 0.5) * 4,
  '30fps': (r) => 33.3 + (r() - 0.5) * 8,
  '10fps': (r) => 100 + (r() - 0.5) * 40,
  // log-normal ajustada a mediana 171 ms e p95 488 ms (medição em e2e/ux-tmp/frames.mjs)
  lab: (r) => Math.min(900, 171 * Math.exp(0.64 * Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r()))),
};

export interface TimedOptions {
  rttMs: number;
  jitterMs: number;
  frame: (r: () => number) => number;
  /** Cliente: teto do tempo de um quadro para a previsão e passos por quadro. */
  clampDt: number;
  maxSteps: number;
  /** Servidor: política de entrada. */
  serverInput?: { holdTicks?: number; holdDebtMax?: number; queueMax?: number };
  seconds: number;
  seed?: number;
}

/**
 * Bancada no tempo: o servidor avança a 30 Hz de relógio; o cliente roda quadros com os
 * intervalos do perfil, faz os passos de previsão do quadro (com o teto de tempo e de
 * passos do GameRuntime) e envia as entradas juntas; a rede atrasa cada mensagem em
 * RTT/2 ± jitter, sem reordenar (TCP).
 */
export function runTimed(map: MapSpec, layout: PaintLayout, o: TimedOptions, script: Script, setup?: (sim: MatchSimulation, p: SimPlayer) => void) {
  const physics = new PhysicsWorld(map);
  const sim = new MatchSimulation({ map, layout, physics, matchId: 'm', roundId: 1, contextTag: 1, seed: 3, durationSeconds: 600, countdownSeconds: 0, mode: 'territorio', input: o.serverInput });
  const p = sim.addPlayer(1, 'ana', 0, 'esguicho', false);
  p.state.spawnProtect = 0;
  sim.step();
  sim.drainEvents();
  setup?.(sim, p);
  const pred = new LocalPredictor(new PhysicsWorld(map), sim.paint, 0, 'esguicho', [...p.state.pos] as never, p.state.yaw);
  pred.state.pos = [...p.state.pos] as never;
  pred.setMapPickups(map.objectives.pickups);
  const r = rng(o.seed ?? 11);
  const TICK_MS = 1000 / TICK_RATE;
  const up: Array<{ at: number; input: Parameters<MatchSimulation['enqueueInput']>[1] }> = [];
  const down: Array<{ at: number; me: SelfSnapshot; ack: number; pk: ReturnType<MatchSimulation['pickupSnapshot']> }> = [];
  let lastUp = 0;
  let lastDown = 0;
  const delay = () => Math.max(0, o.rttMs / 2 + (r() * 2 - 1) * o.jitterMs);
  const corr: number[] = [];
  let nextTick = TICK_MS;
  let nextFrame = 0;
  let acc = 0;
  let lastFrame = 0;
  let clientTick = 0;
  const end = o.seconds * 1000;
  for (let now = 0; now < end; ) {
    now = Math.min(nextTick, nextFrame);
    if (now === nextFrame) {
      // quadro do cliente: recebe, reconcilia, prevê os passos do quadro e envia juntos
      while (down.length && down[0].at <= now) {
        const d = down.shift()!;
        const before = pred.correctionLog.length;
        pred.reconcile(d.me, d.ack, { buff: d.me.bf, buffTicks: d.me.bk, pickups: d.pk ?? undefined });
        corr.push(pred.correctionLog[before] ?? pred.correctionLog.at(-1) ?? 0);
      }
      acc += Math.min(o.clampDt, (now - lastFrame) / 1000);
      lastFrame = now;
      let steps = 0;
      while (acc >= 1 / TICK_RATE && steps < o.maxSteps) {
        acc -= 1 / TICK_RATE;
        steps++;
        const cmd = script(clientTick++, pred.state);
        const st = pred.step(cmd.move, cmd.yaw, 0, cmd.buttons ?? 0, cmd.actions ?? []);
        lastUp = Math.max(lastUp, now + delay());
        up.push({ at: lastUp, input: decodeInput(encodeInput(st.input)) });
      }
      if (steps === o.maxSteps) acc = 0;
      nextFrame = now + o.frame(r);
    } else {
      while (up.length && up[0].at <= now) sim.enqueueInput(1, up.shift()!.input);
      sim.step();
      sim.drainEvents();
      if (sim.tick % 2 === 0) {
        lastDown = Math.max(lastDown, now + delay());
        down.push({ at: lastDown, me: { ...toSelfSnapshot(p.state), bf: p.mode.buff, bk: p.mode.buffTicks }, ack: p.lastProcessedSeq, pk: sim.pickupSnapshot() });
      }
      nextTick += TICK_MS;
    }
  }
  pred.dispose();
  return { corr, inputStats: p.inputStats };
}
