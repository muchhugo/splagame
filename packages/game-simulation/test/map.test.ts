import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '@borrifo/game-contracts';
import { ESTILINGUE, MOVEMENT, PATIO_DA_OLARIA } from '@borrifo/game-content';
import { NavGraph, PaintLayout, PhysicsWorld, initPhysics } from '../src/index';

let layout: PaintLayout;
let physics: PhysicsWorld;
let nav: NavGraph;
beforeAll(async () => {
  await initPhysics();
  layout = PaintLayout.build(PATIO_DA_OLARIA);
  physics = new PhysicsWorld(PATIO_DA_OLARIA);
  nav = NavGraph.build(PATIO_DA_OLARIA, layout, physics);
});

const near = (p: Vec3, r = 1.2) => nav.neighbors(p, r).filter((n) => Math.abs(n.pos[1] - p[1]) < 0.5);

describe('Pátio da Olaria v2: jogabilidade do desenho', () => {
  it('spawns têm espaço livre e ficam de frente para uma saída', () => {
    const body = physics.createCharacter(MOVEMENT);
    for (const t of [0, 1] as const)
      for (const sp of PATIO_DA_OLARIA.spawns[t]) {
        expect(body.fits(sp.pos)).toBe(true);
        // 3 m à frente do spawn o caminho está livre (não nasce encarando o escudo)
        const f: Vec3 = [Math.sin(sp.yaw), 0, Math.cos(sp.yaw)];
        const from: Vec3 = [sp.pos[0], sp.pos[1] + 0.8, sp.pos[2]];
        expect(physics.segmentBlocked(from, [from[0] + f[0] * 3, from[1], from[2] + f[2] * 3], 0)).toBe(false);
      }
    body.dispose();
  });

  it('praça elevada, varanda, tablado e passagem inferior são alcançáveis caminhando', () => {
    expect(near([2, 2.4, 3]).length).toBeGreaterThan(0); // topo da praça
    expect(near([0, 2.4, -3]).length).toBeGreaterThan(0);
    expect(near([-10, 2.5, 18]).length).toBeGreaterThan(0); // varanda Urucum
    expect(near([10, 2.5, -18]).length).toBeGreaterThan(0); // varanda Anil
    expect(near([-11, 1.0, -14]).length).toBeGreaterThan(0); // tablado
    expect(near([0, 0, 0]).length).toBeGreaterThan(0); // sob a ponte
    // do spawn Urucum até o topo da praça e até o spawn Anil por caminhos válidos
    const s0 = nav.nearest(PATIO_DA_OLARIA.spawns[0][0].pos)!;
    const s1 = nav.nearest(PATIO_DA_OLARIA.spawns[1][0].pos)!;
    const top = near([2, 2.4, 3])[0];
    expect(nav.findPath(s0.id, top.id)).not.toBeNull();
    expect(nav.findPath(s0.id, s1.id)).not.toBeNull();
  });

  it('galpões têm mais de uma saída (rampas frontais e laterais)', () => {
    const exits = PATIO_DA_OLARIA.blocks.filter((b) => b.shape === 'ramp' && b.id.startsWith('galpao'));
    expect(exits.length).toBe(8); // 4 por turma
  });

  it('da praça central não há linha de tiro dentro do alcance máximo até os pontos de spawn', () => {
    const range = ESTILINGUE.maxRange;
    const eyes: Vec3[] = [];
    for (let x = -4; x <= 4; x += 1) for (let z = -4; z <= 4; z += 1) eyes.push([x, 2.4 + 1.1, z]);
    for (const t of [0, 1] as const)
      for (const sp of PATIO_DA_OLARIA.spawns[t]) {
        const target: Vec3 = [sp.pos[0], sp.pos[1] + 0.8, sp.pos[2]];
        for (const e of eyes) {
          const d = Math.hypot(target[0] - e[0], target[1] - e[1], target[2] - e[2]);
          const visible = !physics.segmentBlocked(e, target, 0.05);
          expect(visible && d <= range).toBe(false);
        }
      }
  });

  it('área pontuável é igual para as duas metades (simetria de ponto)', () => {
    let west = 0,
      east = 0;
    for (const s of layout.surfaces) {
      if (!s.scoring) continue;
      for (let k = 0; k < s.cols * s.rows; k++) {
        const c = s.cellOffset + k;
        const p = layout.cellCenter(c);
        if (p[0] < -1e-6) west += layout.weight[c];
        else if (p[0] > 1e-6) east += layout.weight[c];
      }
    }
    expect(Math.abs(west - east) / (west + east)).toBeLessThan(0.002);
  });
});
