import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, PaintLayout, type MatchSimulation, type SimPlayer } from '@borrifo/game-simulation';
import { BUFFS } from '@borrifo/game-content';
import { TEST_MAP } from '../../../packages/game-simulation/test/fixtures';
import { FLOW, FRAME_PROFILES, OPTS, runPrediction, runTimed, stats, type Script } from './predictionHarness';

let layout: PaintLayout;
beforeAll(async () => {
  await initPhysics();
  layout = PaintLayout.build(TEST_MAP);
});

/** Segue pontos em loop; `jumpEvery` pula a cada N ticks. */
function route(points: Array<[number, number]>, opts: { flow?: boolean; jumpEvery?: number; startAt?: number } = {}): Script {
  let i = 0;
  return (t, s) => {
    if (t < (opts.startAt ?? 0)) return { move: [0, 0], yaw: 0 };
    let [tx, tz] = points[i];
    if (Math.hypot(tx - s.pos[0], tz - s.pos[2]) < 0.6) {
      i = (i + 1) % points.length;
      [tx, tz] = points[i];
    }
    const yaw = Math.atan2(tx - s.pos[0], tz - s.pos[2]);
    const jump = opts.jumpEvery && t % opts.jumpEvery === 0 && s.grounded;
    return { move: [0, 1], yaw, buttons: opts.flow ? FLOW : 0, actions: jump ? ['jump'] : [] };
  };
}

const paintStrip = (sim: MatchSimulation, p: SimPlayer, x0: number, x1: number, z: number) => {
  for (let x = x0; x <= x1; x += 0.8) sim.paint.paintSplat({ center: [x, 0.05, z], radius: 1.2, team: p.team, seed: 1, floorsOnly: true });
};

const RTTS = [0, 80, 150];

describe('previsão local: teto de velocidade no ar e Embalo', () => {
  it('pulos saindo da tinta própria para o chão neutro (teto no ar)', () => {
    const rows = RTTS.map((rtt) => {
      const { corr } = runPrediction(TEST_MAP, layout, rtt, 30 * 20, route([[7, -7], [-8, -7]], { flow: true, jumpEvery: 17 }), (sim, p) => {
        p.state.pos = [-8, 0, -7];
        paintStrip(sim, p, -9, -1, -7);
      });
      const air = stats(corr.filter((c) => c.air).map((c) => c.mag));
      const all = stats(corr.map((c) => c.mag));
      return { rtt, air, all };
    });
    console.log('AR', JSON.stringify(rows));
    for (const r of rows) {
      expect(r.air.n, 'passou tempo no ar').toBeGreaterThan(100);
      expect(r.all.over25cm, `RTT ${r.rtt}: nenhuma correção perceptível`).toBe(0);
    }
  });

  it('Embalo: coleta e fim no meio da corrida', () => {
    const run = (exactBuff: boolean) =>
      RTTS.map((rtt) => {
        OPTS.exactBuff = exactBuff;
        const { corr } = runPrediction(TEST_MAP, layout, rtt, 30 * (BUFFS.firstSpawnSeconds + 12), route([[-3, -3], [-3, -7], [8, -7], [-8, -7]], { startAt: 30 * BUFFS.firstSpawnSeconds - 20 }), (_sim, p) => {
          p.state.pos = [-6, 0, -3];
        });
        return { rtt, embalo: stats(corr.filter((c) => c.embalo).map((c) => c.mag)), all: stats(corr.map((c) => c.mag)) };
      });
    const sem = run(false);
    const com = run(true);
    OPTS.exactBuff = true;
    console.log('EMBALO sem previsão do buff', JSON.stringify(sem));
    console.log('EMBALO com previsão do buff', JSON.stringify(com));
    for (const [i, r] of com.entries()) {
      expect(r.all.over25cm, `RTT ${r.rtt}: nenhuma correção perceptível`).toBe(0);
      expect(r.all.sum).toBeLessThanOrEqual(sem[i].all.sum + 1e-9);
    }
    // o Embalo de fato aconteceu na corrida
    expect(com.every((r) => r.embalo.n > 20)).toBe(true);
  });

  it('cliente a poucos quadros (entradas em rajada de 3): o servidor segue o mesmo caminho', () => {
    const zig: Script = (t) => ({ move: [0, 1], yaw: Math.floor(t / 21) % 2 ? Math.PI / 2 : -Math.PI / 2 + (Math.floor(t / 42) % 2) * 0.8 });
    const rows = RTTS.map((rtt) => {
      const { corr } = runPrediction(TEST_MAP, layout, rtt, 600, zig, (_s, p) => {
        p.state.pos = [-5, 0, -7];
      }, 3);
      return { rtt, all: stats(corr.map((c) => c.mag)) };
    });
    console.log('RAJADA', JSON.stringify(rows));
    // antes: p95 0,37-0,45 m e ~100 correções > 25 cm por 20 s; agora só a da largada
    for (const r of rows) {
      expect(r.all.p95).toBeLessThan(0.05);
      expect(r.all.over25cm).toBeLessThanOrEqual(1);
    }
  });

  it('no tempo: quadros de 30, 10 e ~5 fps (medido no laboratório) com 80 e 150 ms e jitter', () => {
    const zig: Script = (t) => ({ move: [0, 1], yaw: Math.floor(t / 21) % 2 ? Math.PI / 2 : -Math.PI / 2 + (Math.floor(t / 42) % 2) * 0.8 });
    // política antiga (repetir e descartar; cliente perdia tempo em quadro lento) × atual
    const antigo = { clampDt: 0.1, maxSteps: 4, serverInput: { holdTicks: 0, holdDebtMax: 0, queueMax: 6 } };
    const atual = { clampDt: 0.5, maxSteps: 15 };
    const rows: string[] = [];
    for (const prof of ['30fps', '10fps', 'lab']) {
      for (const rtt of [80, 150]) {
        const base = { rttMs: rtt, jitterMs: rtt * 0.25, frame: FRAME_PROFILES[prof], seconds: 20 };
        const setup = (_s: unknown, p: { state: { pos: number[] } }) => {
          p.state.pos = [-5, 0, -7];
        };
        const a = stats(runTimed(TEST_MAP, layout, { ...base, ...antigo }, zig, setup as never).corr);
        const n = stats(runTimed(TEST_MAP, layout, { ...base, ...atual }, zig, setup as never).corr);
        rows.push(`${prof} ${rtt} ms: antes p95 ${a.p95.toFixed(2)} (>25 cm: ${a.over25cm}) · agora p95 ${n.p95.toFixed(2)} (>25 cm: ${n.over25cm})`);
        expect(n.p95, `${prof} ${rtt}`).toBeLessThan(0.05);
        expect(n.over25cm, `${prof} ${rtt}`).toBeLessThanOrEqual(3);
        expect(n.sum).toBeLessThan(a.sum);
      }
    }
    console.log('NO TEMPO\n' + rows.join('\n'));
  }, 120000);
});
