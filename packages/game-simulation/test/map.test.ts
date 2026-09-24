import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '@borrifo/game-contracts';
import { ESTILINGUE, MAPS, MOVEMENT, CATALOG_HASH, mapFor, variantFor, type MapSpec } from '@borrifo/game-content';
import { NavGraph, PaintLayout, PhysicsWorld, initPhysics } from '../src/index';

/**
 * Testes de DESENHO executados em TODAS as variantes do catálogo (Toca do Ara e
 * Clube da Maré × compacta/padrão/ampliada): saídas dos spawns, alcance de áreas
 * elevadas e dos objetivos, linhas de tiro até o spawn, equilíbrio de área e
 * ausência de armadilhas (poço sem saída).
 */
interface World {
  map: MapSpec;
  layout: PaintLayout;
  physics: PhysicsWorld;
  nav: NavGraph;
}
const worlds = new Map<string, World>();
beforeAll(async () => {
  await initPhysics();
  for (const map of Object.values(MAPS)) {
    const layout = PaintLayout.build(map);
    const physics = new PhysicsWorld(map);
    worlds.set(map.id, { map, layout, physics, nav: NavGraph.build(map, layout, physics) });
  }
});
afterAll(() => {
  for (const w of worlds.values()) w.physics.dispose();
});

const ids = Object.keys(MAPS);
const nodeAt = (w: World, p: Vec3, r = 1.4) => w.nav.neighbors(p, r).filter((n) => Math.abs(n.pos[1] - p[1]) < 0.5)[0] ?? null;

describe('catálogo de mapas', () => {
  it('duas famílias, três variantes cada, ids e faixas de jogadores coerentes', () => {
    expect(ids.sort()).toEqual(['clube-da-mare.ampliado', 'clube-da-mare.compacto', 'clube-da-mare.padrao', 'toca-do-ara.ampliado', 'toca-do-ara.compacto', 'toca-do-ara.padrao']);
    for (const m of Object.values(MAPS)) {
      expect(m.id).toBe(`${m.family}.${m.variant}`);
      expect(variantFor(m.players[0])).toBe(m.variant);
      expect(variantFor(m.players[1])).toBe(m.variant);
    }
    expect(mapFor('clube-da-mare', 2).id).toBe('clube-da-mare.compacto');
    expect(mapFor('clube-da-mare', 16).id).toBe('clube-da-mare.ampliado');
    expect(mapFor('toca-do-ara', 8).id).toBe('toca-do-ara.padrao');
    expect(CATALOG_HASH).toMatch(/^[0-9a-f]{14}$/);
  });

  it('ids de bloco são únicos em cada variante', () => {
    for (const m of Object.values(MAPS)) {
      const seen = new Set<string>();
      for (const b of m.blocks) {
        expect(seen.has(b.id), `${m.id}: ${b.id} repetido`).toBe(false);
        seen.add(b.id);
      }
    }
  });
});

describe.each(ids)('%s', (id) => {
  const w = () => worlds.get(id)!;

  it('oito spawns por turma com espaço livre, voltados para uma saída', () => {
    const { map, physics } = w();
    const body = physics.createCharacter(MOVEMENT);
    for (const t of [0, 1] as const) {
      expect(map.spawns[t].length).toBe(8);
      for (const sp of map.spawns[t]) {
        expect(body.fits(sp.pos), `spawn ${sp.pos}`).toBe(true);
        const f: Vec3 = [Math.sin(sp.yaw), 0, Math.cos(sp.yaw)];
        const from: Vec3 = [sp.pos[0], sp.pos[1] + 0.8, sp.pos[2]];
        expect(physics.segmentBlocked(from, [from[0] + f[0] * 3, from[1], from[2] + f[2] * 3], 0), `frente do spawn ${sp.pos}`).toBe(false);
      }
    }
    body.dispose();
  });

  it('cada base tem pelo menos duas saídas caminháveis', () => {
    const { map } = w();
    const exits = map.blocks.filter((b) => b.shape === 'ramp' && b.min[0] < 0 && b.min[0] <= map.spawnZones[0].max[0] + 0.1 && b.max[0] >= map.spawnZones[0].min[0] && b.max[1] >= map.spawnZones[0].min[1]);
    expect(exits.length).toBeGreaterThanOrEqual(2);
  });

  it('spawns das duas turmas, cápsula, estações e pickups são alcançáveis caminhando, e há volta', () => {
    const { map, nav } = w();
    const s0 = nav.nearest(map.spawns[0][0].pos)!;
    const s1 = nav.nearest(map.spawns[1][0].pos)!;
    expect(s0 && s1).toBeTruthy();
    expect(nav.findPath(s0.id, s1.id)).not.toBeNull();
    const points: Array<[string, Vec3]> = [['cápsula', map.objectives.capsule], ...map.objectives.stations.map((s, i) => [`estação ${i}`, s] as [string, Vec3]), ...map.objectives.pickups.map((p, i) => [`pickup ${i}`, p.pos] as [string, Vec3])];
    for (const [label, p] of points) {
      const n = nodeAt(w(), p);
      expect(n, `${label} ${p} fora do grafo`).not.toBeNull();
      expect(nav.findPath(s0.id, n!.id), `ida até ${label}`).not.toBeNull();
      // sem armadilha: de qualquer objetivo dá para voltar à base (poço tem saída)
      expect(nav.findPath(n!.id, s0.id), `volta de ${label}`).not.toBeNull();
      expect(nav.findPath(n!.id, s1.id), `volta de ${label} (turma 1)`).not.toBeNull();
    }
  });

  it('nenhum objetivo fica dentro de uma zona protegida de spawn', () => {
    const { map } = w();
    const inside = (p: Vec3, z: { min: Vec3; max: Vec3 }) => p[0] >= z.min[0] - 1 && p[0] <= z.max[0] + 1 && p[2] >= z.min[2] - 1 && p[2] <= z.max[2] + 1;
    for (const p of [map.objectives.capsule, ...map.objectives.stations, ...map.objectives.pickups.map((x) => x.pos)])
      for (const t of [0, 1] as const) expect(inside(p, map.spawnZones[t]), `${p} na zona ${t}`).toBe(false);
  });

  it('toda área pontuável elevada é alcançável caminhando ou escalando (paredes pintáveis)', () => {
    const { map, layout, nav } = w();
    for (const s of layout.surfaces) {
      if (!s.scoring || s.traversal !== 'floor' || s.width * s.height < 2) continue;
      const blockId = s.id.split(':')[0];
      const block = map.blocks.find((b) => b.id === blockId);
      if (!block) continue;
      const c = layout.cellCenter(s.cellOffset + Math.floor((s.rows / 2) * s.cols + s.cols / 2));
      const walk = nav.neighbors(c, Math.max(s.width, s.height)).some((n) => Math.abs(n.pos[1] - c[1]) < 0.6);
      expect(walk || block.sides === 'paint', `${s.id} inalcançável`).toBe(true);
    }
  });

  it('do centro não há linha de tiro dentro do alcance máximo até os spawns', () => {
    const { map, physics } = w();
    const range = ESTILINGUE.maxRange;
    // olhos de quem disputa o centro: sobre o ponto da cápsula (chão, torre ou fundo do poço)
    const c = map.objectives.capsule;
    const eyes: Vec3[] = [];
    for (let x = -1.5; x <= 1.5; x += 1.5) for (let z = -1.5; z <= 1.5; z += 1.5) eyes.push([c[0] + x, c[1] + 1.1, c[2] + z]);
    for (const t of [0, 1] as const)
      for (const sp of map.spawns[t]) {
        const target: Vec3 = [sp.pos[0], sp.pos[1] + 0.8, sp.pos[2]];
        for (const e of eyes) {
          const d = Math.hypot(target[0] - e[0], target[1] - e[1], target[2] - e[2]);
          const visible = !physics.segmentBlocked(e, target, 0.05);
          expect(visible && d <= range, `centro ${e} vê spawn ${sp.pos}`).toBe(false);
        }
      }
  });

  it('área pontuável igual para as duas metades (simetria de ponto)', () => {
    const { layout } = w();
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
