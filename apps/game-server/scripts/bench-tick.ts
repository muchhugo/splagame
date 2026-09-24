/**
 * Custo do tick autoritativo com 16 participantes ativos (bots), por mapa e modo:
 * p50/p95/p99 do passo da simulação (ms) e tamanho do snapshot (JSON) por cliente.
 * Mede o processo local; não substitui um teste de carga em produção.
 *   pnpm --filter @borrifo/game-server exec tsx scripts/bench-tick.ts
 */
import { TICK_RATE } from '@borrifo/game-contracts';
import { MAPS } from '@borrifo/game-content';
import { BotBrain, MatchSimulation, NavGraph, PaintLayout, PhysicsWorld, initPhysics, toSelfSnapshot } from '@borrifo/game-simulation';
import { remoteTuple } from '../src/rooms/ArenaRoom';

await initPhysics();
const SECONDS = Number(process.env.SEGUNDOS ?? 30);
const out: unknown[] = [];
for (const [mapId, mode, n] of [
  ['toca-do-ara.compacto', 'territorio', 4],
  ['toca-do-ara.padrao', 'territorio', 8],
  ['toca-do-ara.ampliado', 'territorio', 16],
  ['clube-da-mare.ampliado', 'territorio', 16],
  ['toca-do-ara.ampliado', 'correio', 16],
  ['clube-da-mare.ampliado', 'correio', 16],
] as const) {
  const map = MAPS[mapId];
  const layout = PaintLayout.build(map);
  const physics = new PhysicsWorld(map);
  const nav = NavGraph.build(map, layout, physics);
  const sim = new MatchSimulation({ map, layout, physics, matchId: 'bench', roundId: 1, contextTag: 1, seed: 42, durationSeconds: SECONDS + 5, countdownSeconds: 0, mode });
  const weapons = ['esguicho', 'rodo', 'estilingue', 'esguicho'] as const;
  for (let i = 1; i <= n; i++) {
    const p = sim.addPlayer(i, `bot${i}`, (i % 2) as 0 | 1, weapons[i % 4], true);
    p.bot = new BotBrain(nav, i);
  }
  const times: number[] = [];
  let snapBytes = 0;
  let snaps = 0;
  for (let t = 0; t < SECONDS * TICK_RATE; t++) {
    const t0 = performance.now();
    sim.step();
    sim.drainEvents();
    times.push(performance.now() - t0);
    if (t % 2 === 0) {
      // snapshot típico de um cliente (15 Hz): próprio + todos os remotos + objetivo/pickups
      const me = sim.players.get(1)!;
      const msg = { t: sim.tick, ack: 0, ph: 'running', tl: 0, me: toSelfSnapshot(me.state), pl: [...sim.players.values()].map((p) => remoteTuple(p, sim.isCarrier(p.id))), ob: [], ev: [], sc: [0, 0, 0], obj: sim.objectiveSnapshot(), pk: sim.pickupSnapshot() };
      snapBytes += JSON.stringify(msg).length;
      snaps++;
    }
  }
  const s = [...times].sort((a, b) => a - b);
  const q = (x: number) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * x))] * 100) / 100;
  const r = { mapa: mapId, modo: mode, jogadores: n, ticks: times.length, tickMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(s[s.length - 1] * 100) / 100 }, orcamentoMs: Math.round((1000 / TICK_RATE) * 100) / 100, snapshotBytesMedio: Math.round(snapBytes / snaps), entregas: sim.correio?.deliveries ?? null };
  out.push(r);
  console.log(JSON.stringify(r));
  sim.dispose();
  physics.dispose();
}
if (process.env.SAIDA) (await import('node:fs')).writeFileSync(process.env.SAIDA, JSON.stringify(out, null, 2));
