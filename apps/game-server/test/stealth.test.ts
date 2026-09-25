import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Buttons, C2S, PFLAG_HIDDEN, PFLAG_SUBMERGED, type RemotePlayerTuple, type SnapshotMessage } from '@borrifo/game-contracts';
import { STEALTH } from '@borrifo/game-content';
import { HeadlessClient, issueDevCredential, TEST_DEV_SECRET } from '@borrifo/test-utils';
import type { MatchSimulation } from '@borrifo/game-simulation';
import { MAP_HASH, startTestServer } from './helpers';
import type { StartedServer } from '../src/server';
import type { MemoryResultSink } from '../src/results';
import { ArenaRoom } from '../src/rooms/ArenaRoom';

// Teste ADVERSARIAL de filtragem por interesse: verifica o que chega no socket de cada
// cliente (o snapshot decodificado), não o que a interface desenharia.

const rooms: ArenaRoom[] = [];
const origCreate = ArenaRoom.prototype.onCreate;
let srv: { s: StartedServer; url: string; sink: MemoryResultSink };
beforeAll(async () => {
  ArenaRoom.prototype.onCreate = function (this: ArenaRoom, ...args: Parameters<ArenaRoom['onCreate']>) {
    rooms.push(this);
    return origCreate.apply(this, args);
  };
  srv = await startTestServer({ ROUND_DURATION_SECONDS: '60', JOIN_RATE_BURST: '500', JOIN_RATE_PER_SECOND: '100' });
});
afterAll(async () => {
  ArenaRoom.prototype.onCreate = origCreate;
  await srv.s.shutdown();
});

async function join(userId: string, sid: string) {
  const c = new HeadlessClient(srv.url);
  await c.join({ activitySessionId: sid, credential: await issueDevCredential(TEST_DEV_SECRET, { userId, name: userId.toUpperCase(), activitySessionId: sid }), mapHash: MAP_HASH });
  await c.waitFor(() => c.welcome && c.lobby, 5000, `welcome ${userId}`);
  return c;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tupleOf = (s: SnapshotMessage | null | undefined, id: number) => s?.pl.find((t) => t[0] === id);
/** Grava cada snapshot novo (por tick) que o cliente recebe, com a tupla de `id`. */
function record(c: HeadlessClient, id: number) {
  const got: RemotePlayerTuple[] = [];
  let last = c.lastSnapshot?.t ?? -1;
  const iv = setInterval(() => {
    for (const s of c.snapshots) {
      if (s.t <= last) continue;
      last = s.t;
      const t = tupleOf(s, id);
      if (t) got.push(t);
    }
  }, 10);
  return { got, stop: () => clearInterval(iv) };
}

describe('imerso oculto: posição filtrada no servidor', () => {
  it('adversários e banco recebem só a última posição vista; aliado recebe a real; revelar, reconectar e voltar a ver funcionam', async () => {
    const sid = `sessao-furtiva-${Date.now().toString(36)}`;
    const cs = [await join('f1', sid), await join('f2', sid), await join('f3', sid), await join('f4', sid)];
    const host = cs.find((c) => c.welcome!.playerId === c.lobby!.hostPlayerId)!;
    host.send(C2S.SET_BOTS, { enabled: false });
    host.send(C2S.SET_OPTIONS, { formation: 2 });
    await host.waitFor(() => host.lobby!.plan.teamSize === 2 && host.lobby!.formation === 2, 3000, 'plano 2×2');
    for (const c of cs) if (c !== host) c.send(C2S.SET_READY, { ready: true });
    await host.waitFor(() => host.lobby!.players.filter((p) => p.ready).length >= 3, 3000, 'prontos');
    host.send(C2S.START, {});
    await host.waitFor(() => host.lobby!.phase === 'running', 25000, 'running');
    const room = rooms.find((r) => r.activitySessionId === sid)!;
    const sim = (room as unknown as { sim: MatchSimulation }).sim;
    const teamOf = (c: HeadlessClient) => host.lobby!.players.find((p) => p.playerId === c.welcome!.playerId)!.team;
    const B = cs[0];
    const bid = B.welcome!.playerId;
    const ally = cs.find((c) => c !== B && teamOf(c) === teamOf(B))!;
    const foes = cs.filter((c) => teamOf(c) !== teamOf(B));
    expect(foes.length).toBe(2);
    const bench = await join('f5', sid);
    await bench.waitFor(() => bench.snapshots.length > 3, 5000, 'banco recebendo');

    // B fica imerso na própria tinta, parado, longe dos adversários
    const sp = sim.players.get(bid)!;
    sp.state.spawnProtect = 0;
    sim.paint.paintSplat({ center: [sp.state.pos[0], sp.state.pos[1], sp.state.pos[2]], radius: 3, team: sp.team, seed: 7 });
    let moveY = 0;
    const timer = setInterval(() => B.sendInput({ heldButtons: Buttons.FLOW, moveY, yaw: sp.state.yaw }), 33);
    try {
      await host.waitFor(() => sp.state.submerged, 5000, 'B imerso');
      for (const f of foes) {
        const d = Math.min(...[...sim.players.values()].filter((p) => p.team !== sp.team).map((p) => Math.hypot(p.state.pos[0] - sp.state.pos[0], p.state.pos[2] - sp.state.pos[2])));
        expect(d, 'adversário longe o bastante').toBeGreaterThan(STEALTH.revealRadius);
        void f;
      }
      await foes[0].waitFor(() => (tupleOf(foes[0].lastSnapshot, bid)?.[7] ?? 0) & PFLAG_HIDDEN, 3000, 'oculto para o adversário');
      const ghost = tupleOf(foes[0].lastSnapshot, bid)!;

      // anda devagar (abaixo da ondulação) por 1,5 s: a posição real muda, a enviada não
      moveY = 0.1;
      const recs = [foes[0], foes[1], ally, bench].map((c) => record(c, bid));
      const start = [sp.state.pos[0], sp.state.pos[2]];
      await sleep(1500);
      const real = sp.state.pos;
      for (const r of recs) r.stop();
      expect(Math.hypot(real[0] - start[0], real[2] - start[1]), 'B andou de verdade').toBeGreaterThan(0.4);
      expect(sp.state.submerged && Math.hypot(sp.state.vel[0], sp.state.vel[1], sp.state.vel[2]) <= STEALTH.revealSpeed).toBe(true);
      for (const rec of [recs[0], recs[1], recs[3]]) {
        const seen = rec.got;
        expect(seen.length, 'recebeu snapshots').toBeGreaterThan(10);
        for (const t of seen) {
          expect(t[7] & PFLAG_HIDDEN).toBeTruthy();
          expect(t[7] & PFLAG_SUBMERGED).toBeTruthy();
          // nada da posição atual: coordenadas congeladas, sem velocidade, mira nem carga
          expect([t[1], t[2], t[3]]).toEqual([ghost[1], ghost[2], ghost[3]]);
          expect([t[5], t[9], t[10], t[11]]).toEqual([0, 0, 0, 0]);
        }
      }
      // o aliado recebe a posição real (atualizada), sem a marca de oculto
      const allySeen = recs[2].got;
      expect(allySeen.every((t) => (t[7] & PFLAG_HIDDEN) === 0)).toBe(true);
      const allyLast = allySeen.at(-1)!;
      expect(Math.hypot(allyLast[1] / 100 - real[0], allyLast[3] / 100 - real[2])).toBeLessThan(0.3);
      expect(Math.hypot(allyLast[1] - ghost[1], allyLast[3] - ghost[3])).toBeGreaterThan(30);
      // o próprio B tem o estado completo
      expect(B.lastSnapshot!.me!.p[0]).toBeCloseTo(real[0], 0);

      // um adversário cai e volta com nova credencial: o primeiro snapshot já vem filtrado
      const back = await join(foes[1] === cs[1] ? 'f2' : foes[1] === cs[2] ? 'f3' : 'f4', sid);
      expect(back.welcome!.resumed).toBe(true);
      await back.waitFor(() => back.snapshots.length > 0, 3000, 'snapshot após retomar');
      for (const t of back.snapshots.map((x) => tupleOf(x, bid)).filter((t): t is RemotePlayerTuple => !!t)) expect([t[1], t[3], t[7] & PFLAG_HIDDEN]).toEqual([ghost[1], ghost[3], PFLAG_HIDDEN]);

      // anda rápido: a ondulação revela e todos voltam a receber a posição real
      moveY = 1;
      await foes[0].waitFor(() => {
        const t = tupleOf(foes[0].lastSnapshot, bid);
        return t && (t[7] & PFLAG_HIDDEN) === 0;
      }, 3000, 'revelado ao andar rápido');
      const rev = tupleOf(foes[0].lastSnapshot, bid)!;
      expect(Math.hypot(rev[1] - ghost[1], rev[3] - ghost[3])).toBeGreaterThan(30);
      await bench.waitFor(() => (tupleOf(bench.lastSnapshot, bid)?.[7] ?? PFLAG_HIDDEN) & PFLAG_HIDDEN ? null : true, 3000, 'banco vê de novo');

      // para de novo: esconde de novo depois do atraso, com a nova posição congelada
      moveY = 0;
      await foes[0].waitFor(() => (tupleOf(foes[0].lastSnapshot, bid)?.[7] ?? 0) & PFLAG_HIDDEN, 3000, 'oculto de novo');
      const ghost2 = tupleOf(foes[0].lastSnapshot, bid)!;
      expect(Math.hypot(ghost2[1] - ghost[1], ghost2[3] - ghost[3])).toBeGreaterThan(30);

      // levar dano revela (evento público): simula o acerto pela porta única de dano
      const foeSp = sim.players.get(foes[0].welcome!.playerId)!;
      sim.damage(sp, 5, foeSp, 'esguicho');
      await foes[0].waitFor(() => {
        const t = tupleOf(foes[0].lastSnapshot, bid);
        return t && (t[7] & PFLAG_HIDDEN) === 0;
      }, 2000, 'revelado ao levar dano');
      await Promise.all([...cs, bench, back].map((c) => c.leave()));
    } finally {
      clearInterval(timer);
    }
  }, 90000);
});
