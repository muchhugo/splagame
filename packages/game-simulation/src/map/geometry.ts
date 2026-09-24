import type { Vec3 } from '@borrifo/game-contracts';
import type { BlockSpec, MapSpec, MaterialId } from '@borrifo/game-content';
import { normalize } from '../math';

/**
 * Geometria derivada do MapSpec. A mesma função alimenta colisores (servidor e
 * cliente), superfícies de tinta e a malha visual — uma única fonte de verdade.
 */

export type FacePaint = 'score' | 'paint' | 'none';

export interface MapFace {
  id: string;
  blockId: string;
  blockIndex: number;
  kind: 'quad' | 'tri';
  /** Canto de origem; o retângulo é origin + U*[0,width] + V*[0,height]. */
  origin: Vec3;
  axisU: Vec3;
  axisV: Vec3;
  normal: Vec3;
  width: number;
  height: number;
  /** Para 'tri': a metade válida é v/height <= u/width (definida na construção). */
  triFlip?: boolean;
  paint: FacePaint;
  material: MaterialId;
  style?: string;
  /** Cor-base visual do bloco (opcional). */
  tint?: Vec3;
}

export interface Solid {
  blockIndex: number;
  block: BlockSpec;
  min: Vec3;
  max: Vec3;
}

const EPS = 1e-6;

export function blockSolid(block: BlockSpec, blockIndex: number): Solid {
  return { blockIndex, block, min: block.min, max: block.max };
}

/** Teste de ponto dentro de sólido (caixa ou rampa convexa). */
export function pointInSolid(s: Solid, p: Vec3, margin = 0): boolean {
  const { min, max } = s;
  if (
    p[0] < min[0] + margin ||
    p[0] > max[0] - margin ||
    p[1] < min[1] + margin ||
    p[1] > max[1] - margin ||
    p[2] < min[2] + margin ||
    p[2] > max[2] - margin
  )
    return false;
  if (s.block.shape === 'box') return true;
  const h = rampHeightAt(s.block, p[0], p[2]);
  return p[1] <= h - margin;
}

/** Altura da superfície da rampa num ponto (x, z) dentro de seus limites. */
export function rampHeightAt(b: BlockSpec, x: number, z: number): number {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  let t = 0;
  switch (b.rise) {
    case 'x+':
      t = (x - x0) / (x1 - x0);
      break;
    case 'x-':
      t = (x1 - x) / (x1 - x0);
      break;
    case 'z+':
      t = (z - z0) / (z1 - z0);
      break;
    case 'z-':
      t = (z1 - z) / (z1 - z0);
      break;
  }
  t = Math.min(1, Math.max(0, t));
  return y0 + (y1 - y0) * t;
}

/** Vértices convexos de uma rampa (para collider convex hull). */
export function rampVertices(b: BlockSpec): Vec3[] {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const pts: Vec3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x0, y0, z1],
    [x1, y0, z1],
  ];
  switch (b.rise) {
    case 'x+':
      pts.push([x1, y1, z0], [x1, y1, z1]);
      break;
    case 'x-':
      pts.push([x0, y1, z0], [x0, y1, z1]);
      break;
    case 'z+':
      pts.push([x0, y1, z1], [x1, y1, z1]);
      break;
    case 'z-':
      pts.push([x0, y1, z0], [x1, y1, z0]);
      break;
  }
  return pts;
}

export function buildFaces(map: MapSpec): MapFace[] {
  const faces: MapFace[] = [];
  map.blocks.forEach((b, bi) => {
    if (b.hidden) return;
    if (b.shape === 'box') boxFaces(b, bi, faces);
    else rampFaces(b, bi, faces);
  });
  return faces;
}

function boxFaces(b: BlockSpec, bi: number, out: MapFace[]) {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const side = b.sides === 'paint' ? 'paint' : 'none';
  const base = { blockId: b.id, blockIndex: bi, kind: 'quad' as const, material: b.material, ...(b.style ? { style: b.style } : {}), ...(b.tint ? { tint: b.tint } : {}) };
  out.push({ ...base, id: `${b.id}:top`, origin: [x0, y1, z0], axisU: [1, 0, 0], axisV: [0, 0, 1], normal: [0, 1, 0], width: dx, height: dz, paint: b.top });
  out.push({ ...base, id: `${b.id}:-x`, origin: [x0, y0, z0], axisU: [0, 0, 1], axisV: [0, 1, 0], normal: [-1, 0, 0], width: dz, height: dy, paint: side });
  out.push({ ...base, id: `${b.id}:+x`, origin: [x1, y0, z0], axisU: [0, 0, 1], axisV: [0, 1, 0], normal: [1, 0, 0], width: dz, height: dy, paint: side });
  out.push({ ...base, id: `${b.id}:-z`, origin: [x0, y0, z0], axisU: [1, 0, 0], axisV: [0, 1, 0], normal: [0, 0, -1], width: dx, height: dy, paint: side });
  out.push({ ...base, id: `${b.id}:+z`, origin: [x0, y0, z1], axisU: [1, 0, 0], axisV: [0, 1, 0], normal: [0, 0, 1], width: dx, height: dy, paint: side });
  if (y0 > 0.01) {
    out.push({ ...base, id: `${b.id}:bottom`, origin: [x0, y0, z0], axisU: [1, 0, 0], axisV: [0, 0, 1], normal: [0, -1, 0], width: dx, height: dz, paint: 'none' });
  }
}

function rampFaces(b: BlockSpec, bi: number, out: MapFace[]) {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const dy = y1 - y0;
  const base = { blockId: b.id, blockIndex: bi, material: b.material, ...(b.style ? { style: b.style } : {}), ...(b.tint ? { tint: b.tint } : {}) };
  const along = b.rise === 'x+' || b.rise === 'x-' ? 0 : 2;
  const s = b.rise === 'x+' || b.rise === 'z+' ? 1 : -1;
  const L = along === 0 ? x1 - x0 : z1 - z0;
  const W = along === 0 ? z1 - z0 : x1 - x0;
  const wAxis: Vec3 = along === 0 ? [0, 0, 1] : [1, 0, 0];
  const hAxis: Vec3 = along === 0 ? [s, 0, 0] : [0, 0, s];
  const lowCoord = s > 0 ? (along === 0 ? x0 : z0) : along === 0 ? x1 : z1;
  const highCoord = s > 0 ? (along === 0 ? x1 : z1) : along === 0 ? x0 : z0;
  const wMin = along === 0 ? z0 : x0;
  const mk = (h: number, y: number, w: number): Vec3 => (along === 0 ? [h, y, w] : [w, y, h]);
  const slopeLen = Math.hypot(L, dy);
  const V = normalize([hAxis[0] * L, dy, hAxis[2] * L]);
  const N = normalize([-hAxis[0] * dy, L, -hAxis[2] * dy]);
  out.push({ ...base, id: `${b.id}:slope`, kind: 'quad', origin: mk(lowCoord, y0, wMin), axisU: wAxis, axisV: V, normal: N, width: W, height: slopeLen, paint: b.top });
  out.push({ ...base, id: `${b.id}:back`, kind: 'quad', origin: mk(highCoord, y0, wMin), axisU: wAxis, axisV: [0, 1, 0], normal: hAxis, width: W, height: dy, paint: 'none' });
  // Laterais triangulares: plano (h, y) em w = wMin e w = wMax.
  const wMax = wMin + W;
  const hLen = L;
  const triU: Vec3 = hAxis;
  for (const [w, nSign] of [
    [wMin, -1],
    [wMax, 1],
  ] as const) {
    const n: Vec3 = [wAxis[0] * nSign, 0, wAxis[2] * nSign];
    out.push({
      ...base,
      id: `${b.id}:tri${nSign > 0 ? '+' : '-'}`,
      kind: 'tri',
      origin: mk(lowCoord, y0, w),
      axisU: triU,
      axisV: [0, 1, 0],
      normal: n,
      width: hLen,
      height: dy,
      paint: 'none',
    });
  }
}

/** Ponto 3D de coordenadas locais (u, v) de uma face. */
export function facePoint(f: { origin: Vec3; axisU: Vec3; axisV: Vec3 }, u: number, v: number, lift = 0, normal?: Vec3): Vec3 {
  const n = normal ?? [0, 0, 0];
  return [
    f.origin[0] + f.axisU[0] * u + f.axisV[0] * v + n[0] * lift,
    f.origin[1] + f.axisU[1] * u + f.axisV[1] * v + n[1] * lift,
    f.origin[2] + f.axisU[2] * u + f.axisV[2] * v + n[2] * lift,
  ];
}

/** Para faces triangulares: (u, v) dentro do triângulo (0,0)-(W,0)-(W,H). */
export function insideTri(f: MapFace, u: number, v: number): boolean {
  if (f.kind !== 'tri') return true;
  return v / f.height <= u / f.width + EPS;
}

export function faceAabb(f: MapFace): { min: Vec3; max: Vec3 } {
  const pts = [facePoint(f, 0, 0), facePoint(f, f.width, 0), facePoint(f, 0, f.height), facePoint(f, f.width, f.height)];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  return { min, max };
}
