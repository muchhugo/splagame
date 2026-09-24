import type { Vec3 } from '@borrifo/game-contracts';
import type { MapSpec } from '@borrifo/game-content';
import type { PhysicsWorld } from '@borrifo/game-simulation';

/**
 * Onde o grupo se reúne no lobby: um trecho plano e livre do mapa, com espaço para
 * as duas turmas lado a lado, pé-direito livre e uma câmera com visão desimpedida
 * para o grupo e, atrás dele, para a arena. Achado por raycast contra o MESMO
 * cenário da física, então vale para qualquer mapa ou variante, sem marcação manual.
 * Só apresentação: não entra no hash nem muda a jogabilidade.
 */
export interface LobbySpot {
  /** Centro do palco, no chão. */
  c: Vec3;
  /** Direção horizontal (unitária) do palco para a câmera. */
  d: [number, number];
  /** Direita da tela (unitária), vista da câmera. */
  r: [number, number];
  /** Falso quando nenhum trecho livre foi achado e o palco caiu no spawn. */
  found: boolean;
  /** Meia largura do palco e distância da câmera geral efetivas (mapas apertados usam menos). */
  halfW: number;
  camDist: number;
  /** Faixa validada para o enquadramento: deslocamento lateral e afastamento máximo. */
  latMin: number;
  latMax: number;
  maxDist: number;
  camH: number;
}

interface Tier {
  halfW: number;
  camDist: number;
  lateral: readonly number[];
  zoom: number;
  camH: number;
}
/** Do palco mais folgado ao mais apertado (mapas compactos e cheios de obstáculos). */
const TIERS: readonly Tier[] = [
  {
    halfW: 3.8,
    camDist: 8.6,
    lateral: [-3.2, -1.6, 0, 1.6],
    zoom: 1.25,
    camH: 2.5,
  },
  {
    halfW: 3.2,
    camDist: 7.4,
    lateral: [-2.7, -1.35, 0, 1.35],
    zoom: 1.25,
    camH: 2.5,
  },
  {
    halfW: 2.7,
    camDist: 6.4,
    lateral: [-2.3, -1.15, 0, 1.15],
    zoom: 1.2,
    camH: 2.6,
  },
  { halfW: 2.3, camDist: 5.6, lateral: [-1.2, 0, 0.8], zoom: 1.1, camH: 2.8 },
  { halfW: 2.0, camDist: 5.0, lateral: [-0.6, 0], zoom: 1.0, camH: 3.2 },
];

/** Largura e profundidade do palco (m), e distância da câmera geral. */
export const STAGE = {
  depth: 2.0,
  closeDist: 3.3,
  /** Deslocamento lateral máximo da vitrine (personagem à direita da tela). */
  closeLat: -0.8,
} as const;

const DIRS = 12;

export function findLobbySpot(physics: PhysicsWorld, map: MapSpec): LobbySpot {
  const grid = topGrid(physics, map);
  for (const t of TIERS) {
    const s = search(physics, map, t, grid);
    if (s) return s;
  }
  return fallback(map);
}

/**
 * Altura da superfície mais alta em cada ponto (grade de 0,5 m), com NaN onde não há
 * chão plano. Um ponto só serve de palco se o topo for o próprio chão: nada acima dele.
 */
interface TopGrid {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  h: Float32Array;
}
const CELL = 0.5;
function topGrid(physics: PhysicsWorld, map: MapSpec): TopGrid {
  const { min, max } = map.bounds;
  const nx = Math.ceil((max[0] - min[0]) / CELL) + 1;
  const nz = Math.ceil((max[2] - min[2]) / CELL) + 1;
  const h = new Float32Array(nx * nz);
  const top = max[1] + 6;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const hit = physics.raycast([min[0] + i * CELL, top, min[2] + j * CELL], [0, -1, 0], top - min[1] + 2);
      h[i * nz + j] = hit && hit.normal[1] >= 0.95 ? hit.point[1] : NaN;
    }
  // decoração (sem colisor) também ocupa o chão: marca as células em volta
  for (const d of map.decor) {
    if (d.kind === 'varal' || d.kind === 'luz') continue;
    const rad = 1.1 + 0.6 * (d.scale ?? 1);
    const i0 = Math.max(0, Math.floor((d.pos[0] - rad - min[0]) / CELL));
    const i1 = Math.min(nx - 1, Math.ceil((d.pos[0] + rad - min[0]) / CELL));
    const j0 = Math.max(0, Math.floor((d.pos[2] - rad - min[2]) / CELL));
    const j1 = Math.min(nz - 1, Math.ceil((d.pos[2] + rad - min[2]) / CELL));
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = i * nz + j;
        if (Math.hypot(min[0] + i * CELL - d.pos[0], min[2] + j * CELL - d.pos[2]) < rad && Math.abs(h[k] - d.pos[1]) < 4) h[k] = NaN;
      }
  }
  return { x0: min[0], z0: min[2], nx, nz, h };
}
function topAt(g: TopGrid, x: number, z: number): number {
  const i = Math.round((x - g.x0) / CELL);
  const j = Math.round((z - g.z0) / CELL);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return NaN;
  return g.h[i * g.nz + j];
}

function search(physics: PhysicsWorld, map: MapSpec, tier: Tier, grid: TopGrid): LobbySpot | null {
  const { halfW, camDist } = tier;
  const { min, max } = map.bounds;
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const half = Math.max(max[0] - min[0], max[2] - min[2]) / 2;
  const decor = map.decor.filter((d) => d.kind !== 'varal' && d.kind !== 'luz');
  const decorOnSegment = (a: Vec3, b: Vec3) =>
    decor.some((dc) => {
      if (Math.abs(dc.pos[1] - a[1]) > 7) return false;
      const vx = b[0] - a[0],
        vz = b[2] - a[2];
      const L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((dc.pos[0] - a[0]) * vx + (dc.pos[2] - a[2]) * vz) / L2));
      return Math.hypot(a[0] + vx * t - dc.pos[0], a[2] + vz * t - dc.pos[2]) < 1.2 + 0.8 * (dc.scale ?? 1);
    });
  const cands: Array<{
    c: Vec3;
    d: [number, number];
    r: [number, number];
    score: number;
  }> = [];
  const step = 1.5;
  for (let x = min[0] + 2.5; x <= max[0] - 2.5; x += step) {
    for (let z = min[2] + 2.5; z <= max[2] - 2.5; z += step) {
      const y = topAt(grid, x, z);
      if (Number.isNaN(y) || y > min[1] + 3.5) continue;
      const c: Vec3 = [x, y, z];
      for (let k = 0; k < DIRS; k++) {
        const a = (k / DIRS) * Math.PI * 2;
        const d: [number, number] = [Math.sin(a), Math.cos(a)];
        // câmera olha para -d; direita da tela = (f.z, -f.x) com f = -d
        const r: [number, number] = [-d[1], d[0]];
        const at = (u: number, w: number): [number, number] => [x + r[0] * u - d[0] * w, z + r[1] * u - d[1] * w];
        let ok = true;
        // amostragem densa (a cada ~0,5 m): nenhum caixote cabe entre dois pontos
        const nu = Math.ceil((halfW * 2) / CELL);
        for (let iu = 0; iu <= nu; iu++) {
          const u = -halfW + (iu / nu) * halfW * 2;
          for (let w = -0.7; w <= STAGE.depth + 1e-6; w += CELL) {
            const [px, pz] = at(u, w);
            const fy = topAt(grid, px, pz);
            if (Number.isNaN(fy) || Math.abs(fy - y) > 0.06) {
              ok = false;
              break;
            }
          }
          if (!ok) break;
        }
        if (!ok) continue;
        const eye = (u: number, w: number, h: number): Vec3 => {
          const [px, pz] = at(u, w);
          return [px, y + h, pz];
        };
        // pontuação: arena ao fundo (olhar para o centro), fundo profundo, chão baixo, longe da borda
        const toC = [cx - x, cz - z];
        const lc = Math.hypot(toC[0], toC[1]) || 1;
        const facing = (-d[0] * toC[0] - d[1] * toC[1]) / lc;
        const back = physics.raycast(eye(0, 0, 1.4), [-d[0], 0, -d[1]], 40);
        const depth = back ? back.toi : 40;
        const off = lc / half;
        const score = facing * 3 + Math.min(depth, 30) / 8 - (y - min[1]) * 0.8 - Math.abs(off - 0.45) * 2;
        cands.push({ c, d, r, score });
      }
    }
  }
  // as câmeras (a parte cara) só são conferidas nos melhores, em ordem de pontuação
  cands.sort((a, b) => b.score - a.score);
  for (const { c, d, r } of cands) {
    const [x, y, z] = c;
    const at = (u: number, w: number): [number, number] => [x + r[0] * u - d[0] * w, z + r[1] * u - d[1] * w];
    const eye = (u: number, w: number, h: number): Vec3 => {
      const [px, pz] = at(u, w);
      return [px, y + h, pz];
    };
    // todas as posições que a câmera geral usa (distância e deslocamento lateral do
    // enquadramento) precisam ficar dentro da arena, fora do sólido e sem decoração no caminho
    const camOk = (cam: Vec3, look: Vec3[]) =>
      cam[0] > min[0] + 1.5 &&
      cam[0] < max[0] - 1.5 &&
      cam[2] > min[2] + 1.5 &&
      cam[2] < max[2] - 1.5 &&
      !physics.pointInsideWorld(cam) &&
      look.every((l) => !physics.segmentBlocked(cam, l) && !decorOnSegment(cam, l));
    // grade de pontos do grupo (pés, tronco e cabeça, frente e fundo): nada pode tapar
    const targets: Vec3[] = [];
    for (let iu = 0; iu <= 4; iu++) for (const w of [0, 1.2]) for (const hh of [0.25, 1.1, 2.0]) targets.push(eye(-halfW + (iu / 4) * halfW * 2, w, hh));
    let camsOk = true;
    for (const dist of tier.zoom > 1 ? [camDist, camDist * tier.zoom] : [camDist]) {
      for (const lat of tier.lateral) {
        const cam: Vec3 = [x + d[0] * dist + r[0] * lat, y + tier.camH, z + d[1] * dist + r[1] * lat];
        if (!camOk(cam, targets)) {
          camsOk = false;
          break;
        }
      }
      if (!camsOk) break;
    }
    if (!camsOk) continue;
    // câmera de perto (vitrine) na vaga de quem joga (primeira vaga à esquerda do centro)
    const me = eye(-0.24 * halfW, 0, 1.2);
    let closeOk = true;
    for (const k of [1, 1.45])
      for (const lat of [STAGE.closeLat, 0]) {
        const close: Vec3 = [me[0] + d[0] * STAGE.closeDist * k + r[0] * lat, me[1] + 0.2, me[2] + d[1] * STAGE.closeDist * k + r[1] * lat];
        if (!camOk(close, [me])) closeOk = false;
      }
    if (!closeOk) continue;
    return {
      c,
      d,
      r,
      found: true,
      halfW,
      camDist,
      latMin: tier.lateral[0],
      latMax: tier.lateral[tier.lateral.length - 1],
      maxDist: camDist * tier.zoom,
      camH: tier.camH,
    };
  }
  return null;
}

function fallback(map: MapSpec): LobbySpot {
  const { min, max } = map.bounds;
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  // sem trecho livre (mapa novo muito fechado): primeiro spawn da turma 0, virado ao centro
  const sp = map.spawns[0][0];
  const dx = sp.pos[0] - cx,
    dz = sp.pos[2] - cz;
  const l = Math.hypot(dx, dz) || 1;
  const d: [number, number] = [dx / l, dz / l];
  return {
    c: sp.pos,
    d,
    r: [-d[1], d[0]],
    found: false,
    halfW: 2.0,
    camDist: 5.0,
    latMin: 0,
    latMax: 0,
    maxDist: 5.0,
    camH: 3.2,
  };
}
