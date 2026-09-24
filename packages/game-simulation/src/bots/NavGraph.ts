import type { Vec3 } from '@borrifo/game-contracts';
import type { MapSpec } from '@borrifo/game-content';
import { MOVEMENT } from '@borrifo/game-content';
import type { PaintLayout } from '../paint/PaintLayout';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { facePoint } from '../map/geometry';

export interface NavNode {
  id: number;
  pos: Vec3;
  /** Índice da célula de tinta sob o nó (para avaliar território). */
  cell: number;
  edges: number[];
}

/**
 * Grafo de navegação derivado do mesmo MapSpec: nós amostrados nos pisos
 * pintáveis a cada ~1 m, com espaço livre para a cápsula; arestas entre vizinhos
 * alcançáveis caminhando (degrau/rampa) ou descendo (queda curta). Mantém só a
 * componente alcançável a partir dos spawns.
 */
export class NavGraph {
  nodes: NavNode[] = [];
  private grid = new Map<string, number[]>();
  static readonly SPACING = 1.0;

  static build(map: MapSpec, layout: PaintLayout, physics: PhysicsWorld): NavGraph {
    const g = new NavGraph();
    const body = physics.createCharacter(MOVEMENT);
    const S = NavGraph.SPACING;
    try {
      for (const s of layout.surfaces) {
        if (s.traversal !== 'floor') continue;
        const nu = Math.max(1, Math.floor(s.width / S));
        const nv = Math.max(1, Math.floor(s.height / S));
        for (let j = 0; j < nv; j++)
          for (let i = 0; i < nu; i++) {
            const u = (i + 0.5) * (s.width / nu);
            const v = (j + 0.5) * (s.height / nv);
            const cell = layout.cellAtUV(s, u, v);
            if (cell < 0) continue;
            const p = facePoint(s, u, v, 0.02, s.normal);
            // em rampa, a esfera inferior da cápsula encosta no plano inclinado: sobe o nó o
            // quanto a inclinação exige (r/cosθ − r), como o controlador faz ao subir
            if (s.normal[1] < 0.999) p[1] += MOVEMENT.capsuleRadius * (1 / Math.max(0.5, s.normal[1]) - 1);
            if (!body.fits(p)) continue;
            // mantém distância mínima de paredes para evitar nós "colados"
            g.addNode([p[0], p[1], p[2]], cell);
          }
      }
      // arestas
      for (const n of g.nodes) {
        for (const m of g.neighbors(n.pos, 1.6)) {
          if (m.id === n.id) continue;
          const dy = m.pos[1] - n.pos[1];
          const hd = Math.hypot(m.pos[0] - n.pos[0], m.pos[2] - n.pos[2]);
          if (hd < 0.3 || hd > 1.6) continue;
          // degrau curto ou rampa dentro do limite de inclinação do controlador (~40°)
          const walk = Math.abs(dy) <= 0.45 || Math.abs(dy) <= hd * 0.84;
          const drop = dy < -0.45 && dy > -3.2 && hd <= 1.6;
          if (!walk && !drop) continue;
          const hi = Math.max(n.pos[1], m.pos[1]);
          const a: Vec3 = [n.pos[0], hi + 0.5, n.pos[2]];
          const b: Vec3 = [m.pos[0], hi + 0.5, m.pos[2]];
          if (physics.segmentBlocked(a, b, 0) || physics.segmentBlocked([a[0], a[1] + 0.8, a[2]], [b[0], b[1] + 0.8, b[2]], 0)) continue;
          if (walk && physics.segmentBlocked([n.pos[0], n.pos[1] + 0.25, n.pos[2]], [m.pos[0], m.pos[1] + 0.25, m.pos[2]], 0)) continue;
          n.edges.push(m.id);
        }
      }
      // componente alcançável a partir dos spawns de ambas as equipes
      const reach = new Uint8Array(g.nodes.length);
      const queue: number[] = [];
      for (const t of [0, 1] as const)
        for (const sp of map.spawns[t]) {
          const n = g.nearest(sp.pos);
          if (n && !reach[n.id]) {
            reach[n.id] = 1;
            queue.push(n.id);
          }
        }
      while (queue.length) {
        const id = queue.pop()!;
        for (const e of g.nodes[id].edges)
          if (!reach[e]) {
            reach[e] = 1;
            queue.push(e);
          }
      }
      g.compact(reach);
    } finally {
      body.dispose();
    }
    return g;
  }

  private key(x: number, z: number) {
    return `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
  }

  private addNode(pos: Vec3, cell: number) {
    const id = this.nodes.length;
    this.nodes.push({ id, pos, cell, edges: [] });
    const k = this.key(pos[0], pos[2]);
    let l = this.grid.get(k);
    if (!l) this.grid.set(k, (l = []));
    l.push(id);
  }

  private compact(keep: Uint8Array) {
    const remap = new Int32Array(this.nodes.length).fill(-1);
    const out: NavNode[] = [];
    for (const n of this.nodes)
      if (keep[n.id]) {
        remap[n.id] = out.length;
        out.push(n);
      }
    for (const n of out) {
      n.id = remap[n.id];
      n.edges = n.edges.map((e) => remap[e]).filter((e) => e >= 0);
    }
    this.nodes = out;
    this.grid.clear();
    for (const n of out) {
      const k = this.key(n.pos[0], n.pos[2]);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(n.id);
    }
  }

  neighbors(p: Vec3, r: number): NavNode[] {
    const out: NavNode[] = [];
    const x0 = Math.floor((p[0] - r) / 2),
      x1 = Math.floor((p[0] + r) / 2);
    const z0 = Math.floor((p[2] - r) / 2),
      z1 = Math.floor((p[2] + r) / 2);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const l = this.grid.get(`${x},${z}`);
        if (!l) continue;
        for (const id of l) {
          const n = this.nodes[id];
          if (Math.hypot(n.pos[0] - p[0], n.pos[2] - p[2]) <= r) out.push(n);
        }
      }
    return out;
  }

  nearest(p: Vec3, maxR = 4): NavNode | null {
    let best: NavNode | null = null;
    let bd = Infinity;
    for (const n of this.neighbors(p, maxR)) {
      const d = Math.hypot(n.pos[0] - p[0], (n.pos[1] - p[1]) * 2, n.pos[2] - p[2]);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** A* com heurística euclidiana. Retorna ids de nós ou null. */
  findPath(from: number, to: number, maxExpand = 6000): number[] | null {
    if (from === to) return [from];
    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open: Array<[number, number]> = [];
    const h = (a: number) => {
      const p = this.nodes[a].pos,
        q = this.nodes[to].pos;
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    };
    g[from] = 0;
    open.push([h(from), from]);
    let expanded = 0;
    while (open.length) {
      // heap simples por inserção ordenada (grafos pequenos)
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (closed[cur]) continue;
      if (cur === to) break;
      closed[cur] = 1;
      if (++expanded > maxExpand) return null;
      const cp = this.nodes[cur].pos;
      for (const e of this.nodes[cur].edges) {
        if (closed[e]) continue;
        const ep = this.nodes[e].pos;
        const ng = g[cur] + Math.hypot(ep[0] - cp[0], ep[1] - cp[1], ep[2] - cp[2]);
        if (ng < g[e]) {
          g[e] = ng;
          came[e] = cur;
          open.push([ng + h(e), e]);
        }
      }
    }
    if (came[to] < 0) return null;
    const path: number[] = [to];
    let c = to;
    while (c !== from) {
      c = came[c];
      if (c < 0) return null;
      path.push(c);
    }
    return path.reverse();
  }
}
