import { beforeAll, describe, expect, it } from 'vitest';
import { decodePaintDelta, decodePaintSnapshot, encodePaintDelta, encodePaintSnapshot } from '@borrifo/game-contracts';
import { MAPS, computeMapHash } from '@borrifo/game-content';
import { FULL_CELL_UNITS, PaintLayout, PaintReplica, PaintState, PhysicsWorld, initPhysics } from '../src/index';
import { TEST_MAP } from './fixtures';

let layout: PaintLayout;
let physics: PhysicsWorld;
beforeAll(async () => {
  await initPhysics();
  layout = PaintLayout.build(TEST_MAP);
  physics = new PhysicsWorld(TEST_MAP);
});

const occ = () => (a: [number, number, number], b: [number, number, number]) => physics.segmentBlocked(a, b, 0.08);
const surf = (id: string) => layout.surfaces.find((s) => s.id === id)!;
function recount(p: PaintState): [number, number] {
  const u: [number, number] = [0, 0];
  for (let c = 0; c < layout.totalCells; c++) {
    const o = p.owner[c];
    if (o === -1) continue;
    if (layout.surfaces[layout.cellSurface[c]].scoring) u[o] += layout.weight[c];
  }
  return u;
}

describe('layout lógico de tinta', () => {
  it('área pontuável usa área real, descontando pegadas de objetos', () => {
    const area = layout.totalScoringUnits * layout.areaPerUnit;
    // piso 400 − parede 5 − plataforma 16 − azulejo 1 − caixa fina 0,15 + topo plataforma 16 + topo caixa fina ≈ 0,15
    expect(area).toBeGreaterThan(393.5);
    expect(area).toBeLessThan(394.6);
  });

  it('células parcialmente válidas têm peso proporcional (borda da caixa fina)', () => {
    const top = surf('fina:top');
    expect(top.cols).toBe(2);
    const weights = Array.from({ length: top.cols * top.rows }, (_, k) => layout.weight[top.cellOffset + k]);
    expect(weights.some((w) => w === FULL_CELL_UNITS)).toBe(true);
    expect(weights.some((w) => w > 0 && w < FULL_CELL_UNITS)).toBe(true);
  });

  it('paredes são pintáveis e escaláveis, mas não pontuam; azulejo não é pintável', () => {
    const wall = surf('parede:+x');
    expect(wall.traversal).toBe('wall');
    expect(wall.scoring).toBe(false);
    expect(layout.surfaces.some((s) => s.blockId === 'azulejo')).toBe(false);
    expect(surf('parede:top').scoring).toBe(false); // topo declarado 'paint'
    expect(surf('plataforma:top').scoring).toBe(true);
  });

  it('impacto → célula: ponto dentro/fora dos limites da superfície', () => {
    const floor = surf('piso:top');
    const hit = layout.floorAt([3, 0, 3]);
    expect(hit?.surface.id).toBe('piso:top');
    const i = Math.floor((3 - floor.origin[0]) / 0.25);
    const j = Math.floor((3 - floor.origin[2]) / 0.25);
    expect(hit!.cell).toBe(floor.cellOffset + j * floor.cols + i);
    expect(layout.floorAt([0, 0, 0])).toBeNull(); // sob a parede: célula inválida
    expect(layout.floorAt([7, 2, 0])?.surface.id).toBe('plataforma:top'); // piso alto separado do chão
    expect(layout.floorAt([7, 0, 0])).toBeNull(); // sob a plataforma não há piso válido
  });

  it.each(Object.keys(MAPS))('%s gera layout estável e hash determinístico', (id) => {
    const m = MAPS[id];
    const a = PaintLayout.build(m);
    const b = PaintLayout.build(m);
    expect(a.totalCells).toBe(b.totalCells);
    expect(a.totalScoringUnits).toBe(b.totalScoringUnits);
    expect(computeMapHash(m)).toBe(computeMapHash(structuredClone(m)));
  });

  it('a área pontuável cresce com a variante (compacta < padrão < ampliada)', () => {
    for (const fam of ['toca-do-ara', 'clube-da-mare']) {
      const area = (v: string) => {
        const l = PaintLayout.build(MAPS[`${fam}.${v}`]);
        return l.totalScoringUnits * l.areaPerUnit;
      };
      const [c, p, a] = [area('compacto'), area('padrao'), area('ampliado')];
      expect(c).toBeLessThan(p);
      expect(p).toBeLessThan(a);
      expect(c).toBeGreaterThan(500);
    }
  });
});

describe('aplicação de tinta', () => {
  it('pinta células próprias, neutras e inimigas com contadores incrementais exatos', () => {
    const p = new PaintState(layout);
    p.reset(1, 7);
    p.paintSplat({ center: [3, 0.1, 3], radius: 1, team: 0, seed: 1, occluded: occ() });
    expect(p.teamUnits[0]).toBeGreaterThan(0);
    expect(recount(p)).toEqual(p.teamUnits);
    const before = p.teamUnits[0];
    p.paintSplat({ center: [3.4, 0.1, 3], radius: 1, team: 1, seed: 2, occluded: occ() });
    expect(p.teamUnits[0]).toBeLessThan(before);
    expect(p.teamUnits[1]).toBeGreaterThan(0);
    expect(recount(p)).toEqual(p.teamUnits);
    expect(p.neutralUnits + p.teamUnits[0] + p.teamUnits[1]).toBe(layout.totalScoringUnits);
    // repintar a própria área não altera nada
    const snap = [...p.teamUnits];
    const changed = p.paintSplat({ center: [3.4, 0.1, 3], radius: 1, team: 1, seed: 2, occluded: occ() });
    expect(changed).toBe(0);
    expect(p.teamUnits).toEqual(snap);
  });

  it('respingo não atravessa parede nem pinta a face de trás', () => {
    const p = new PaintState(layout);
    p.reset(1, 7);
    p.paintSplat({ center: [0.5, 0.1, 0], radius: 1.2, team: 0, seed: 3, occluded: occ() });
    const floor = surf('piso:top');
    let behind = 0,
      front = 0;
    for (let k = 0; k < floor.cols * floor.rows; k++) {
      const c = floor.cellOffset + k;
      if (p.owner[c] !== 0) continue;
      const x = floor.origin[0] + ((k % floor.cols) + 0.5) * 0.25;
      if (x < -0.25) behind++;
      else front++;
    }
    expect(front).toBeGreaterThan(10);
    expect(behind).toBe(0);
    // base da face +x da parede recebe respingo (regra geométrica explícita), a face −x não
    const wp = surf('parede:+x');
    const wm = surf('parede:-x');
    const painted = (s: typeof wp) => Array.from({ length: s.cols * s.rows }, (_, k) => p.owner[s.cellOffset + k]).filter((o) => o === 0).length;
    expect(painted(wp)).toBeGreaterThan(0);
    expect(painted(wm)).toBe(0);
  });

  it('pisos em alturas diferentes não se misturam', () => {
    const p = new PaintState(layout);
    p.reset(1, 7);
    p.paintSplat({ center: [5.3, 2.1, 0], radius: 1, team: 1, seed: 4, occluded: occ() });
    const top = surf('plataforma:top');
    const floor = surf('piso:top');
    const count = (s: typeof top) => Array.from({ length: s.cols * s.rows }, (_, k) => p.owner[s.cellOffset + k]).filter((o) => o === 1).length;
    expect(count(top)).toBeGreaterThan(5);
    expect(count(floor)).toBe(0);
    expect(count(surf('plataforma:-x'))).toBe(0); // centro atrás da face lateral
  });
});

describe('sincronização de tinta', () => {
  it('snapshot + deltas reconstroem o mesmo estado; lacunas e versões pedem ressincronização', () => {
    const server = new PaintState(layout);
    server.reset(3, 99);
    server.setTracking(true);
    const resyncs: string[] = [];
    const replica = new PaintReplica(layout, { requestResync: (_r, reason) => resyncs.push(reason) });
    replica.expectRound(3, 99);
    // delta chega antes do snapshot → buffer
    server.paintSplat({ center: [-4, 0.1, -4], radius: 1.5, team: 0, seed: 5, occluded: occ() });
    const d1 = server.flushDeltas().map((d) => decodePaintDelta(encodePaintDelta(d)));
    expect(replica.receiveDelta(d1[0])).toBe('buffered');
    const snap = decodePaintSnapshot(encodePaintSnapshot(server.toSnapshot()));
    expect(replica.receiveSnapshot(snap)).toBe('applied');
    server.paintSplat({ center: [4, 0.1, 4], radius: 1.5, team: 1, seed: 6, occluded: occ() });
    const d2 = server.flushDeltas().map((d) => decodePaintDelta(encodePaintDelta(d)));
    for (const d of d2) expect(replica.receiveDelta(d)).toBe('applied');
    expect(Array.from(replica.state.owner)).toEqual(Array.from(server.owner));
    expect(replica.state.teamUnits).toEqual(server.teamUnits);
    // lacuna: pula um delta
    server.paintSplat({ center: [-6, 0.1, 6], radius: 1, team: 1, seed: 7, occluded: occ() });
    server.flushDeltas();
    server.paintSplat({ center: [6, 0.1, -6], radius: 1, team: 0, seed: 8, occluded: occ() });
    const d4 = server.flushDeltas();
    expect(replica.receiveDelta(d4[0])).toBe('resync');
    expect(resyncs).toContain('gap');
    replica.receiveSnapshot(server.toSnapshot());
    expect(Array.from(replica.state.owner)).toEqual(Array.from(server.owner));
    // versão de chunk divergente
    const bad = server.toSnapshot();
    server.paintSplat({ center: [2, 0.1, -3], radius: 1, team: 0, seed: 9, occluded: occ() });
    const d5 = server.flushDeltas()[0];
    replica.state.chunkVersion[d5.chunks[0].chunkId] += 5;
    expect(replica.receiveDelta(d5)).toBe('resync');
    expect(resyncs).toContain('version');
    void bad;
    // nova rodada invalida deltas antigos
    replica.expectRound(4, 99);
    expect(replica.receiveDelta(d5)).toBe('ignored');
  });

  it('snapshot RLE é compacto e rejeita dados corrompidos', () => {
    const s = new PaintState(layout);
    s.reset(1, 1);
    const bytes = encodePaintSnapshot(s.toSnapshot());
    expect(bytes.length).toBeLessThan(2000);
    const broken = bytes.slice(0, bytes.length - 3);
    expect(() => decodePaintSnapshot(broken)).toThrow();
  });
});
