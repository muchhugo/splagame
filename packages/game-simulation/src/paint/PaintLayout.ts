import type { Vec3 } from '@borrifo/game-contracts';
import type { MapSpec } from '@borrifo/game-content';
import { buildFaces, blockSolid, faceAabb, facePoint, insideTri, pointInSolid, type MapFace, type Solid } from '../map/geometry';
import { dot } from '../math';

/** Lado do chunk em células. Índice local cabe em um byte (16×16 = 256). */
export const CHUNK_SIDE = 16;
/** Subamostras por célula (4×4). Peso de área = subamostras válidas (0..16). */
export const SUBSAMPLES_PER_AXIS = 4;
export const FULL_CELL_UNITS = SUBSAMPLES_PER_AXIS * SUBSAMPLES_PER_AXIS;

export type Traversal = 'floor' | 'wall' | 'none';

export interface PaintSurface {
  index: number;
  id: string;
  blockId: string;
  origin: Vec3;
  axisU: Vec3;
  axisV: Vec3;
  normal: Vec3;
  planeD: number;
  width: number;
  height: number;
  cellSize: number;
  cols: number;
  rows: number;
  scoring: boolean;
  traversal: Traversal;
  cellOffset: number;
  chunkOffset: number;
  chunkCols: number;
  chunkRows: number;
  aabbMin: Vec3;
  aabbMax: Vec3;
  /** Unidades de área válidas nesta superfície. */
  units: number;
}

export interface CellHit {
  surface: PaintSurface;
  cell: number;
  /** Distância assinada do ponto ao plano (ao longo da normal). */
  d: number;
  u: number;
  v: number;
}

/**
 * Layout imutável das superfícies pintáveis, derivado do MapSpec. Servidor e
 * cliente constroem o mesmo layout a partir do mesmo mapa (verificado por hash).
 */
export class PaintLayout {
  readonly surfaces: PaintSurface[] = [];
  readonly cellSize: number;
  totalCells = 0;
  totalChunks = 0;
  /** Peso de área por célula (0 = inválida). */
  weight!: Uint8Array;
  cellSurface!: Uint16Array;
  chunkSurface!: Uint16Array;
  chunkCi!: Uint16Array;
  chunkCj!: Uint16Array;
  /** Unidades totais pontuáveis (inteiro exato). */
  totalScoringUnits = 0;
  readonly areaPerUnit: number;

  // índice espacial uniforme
  private gridMin: Vec3;
  private gridCell = 4;
  private gridDims: [number, number, number];
  private grid: number[][];
  private stamp: Uint32Array;
  private stampId = 1;

  private constructor(map: MapSpec) {
    this.cellSize = map.cellSize;
    this.areaPerUnit = (map.cellSize * map.cellSize) / FULL_CELL_UNITS;
    const b = map.bounds;
    this.gridMin = [b.min[0] - 2, b.min[1] - 2, b.min[2] - 2];
    this.gridDims = [
      Math.ceil((b.max[0] - b.min[0] + 4) / this.gridCell),
      Math.ceil((b.max[1] - b.min[1] + 4) / this.gridCell),
      Math.ceil((b.max[2] - b.min[2] + 4) / this.gridCell),
    ];
    this.grid = Array.from({ length: this.gridDims[0] * this.gridDims[1] * this.gridDims[2] }, () => []);
    this.stamp = new Uint32Array(0);
  }

  static build(map: MapSpec, faces: MapFace[] = buildFaces(map)): PaintLayout {
    const L = new PaintLayout(map);
    const cs = map.cellSize;
    const solids: Solid[] = map.blocks.map((b, i) => blockSolid(b, i));
    const pending: { s: PaintSurface; masks: Uint16Array }[] = [];
    let cellOffset = 0;
    let chunkOffset = 0;

    for (const f of faces) {
      if (f.paint === 'none') continue;
      const cols = Math.max(1, Math.ceil(f.width / cs - 1e-6));
      const rows = Math.max(1, Math.ceil(f.height / cs - 1e-6));
      const masks = computeMasks(f, cols, rows, cs, solids);
      let units = 0;
      for (let i = 0; i < masks.length; i++) units += popcount16(masks[i]);
      if (units === 0) continue; // face totalmente coberta: descartada
      const ny = f.normal[1];
      const traversal: Traversal = ny > 0.6 ? 'floor' : Math.abs(ny) < 0.35 ? 'wall' : 'none';
      const aabb = faceAabb(f);
      const chunkCols = Math.ceil(cols / CHUNK_SIDE);
      const chunkRows = Math.ceil(rows / CHUNK_SIDE);
      const s: PaintSurface = {
        index: L.surfaces.length,
        id: f.id,
        blockId: f.blockId,
        origin: f.origin,
        axisU: f.axisU,
        axisV: f.axisV,
        normal: f.normal,
        planeD: dot(f.normal, f.origin),
        width: f.width,
        height: f.height,
        cellSize: cs,
        cols,
        rows,
        // Somente pisos declarados como 'score' pontuam; paredes nunca.
        scoring: f.paint === 'score' && traversal === 'floor',
        traversal,
        cellOffset,
        chunkOffset,
        chunkCols,
        chunkRows,
        aabbMin: aabb.min,
        aabbMax: aabb.max,
        units,
      };
      L.surfaces.push(s);
      pending.push({ s, masks });
      cellOffset += cols * rows;
      chunkOffset += chunkCols * chunkRows;
    }

    L.totalCells = cellOffset;
    L.totalChunks = chunkOffset;
    L.weight = new Uint8Array(cellOffset);
    L.cellSurface = new Uint16Array(cellOffset);
    L.chunkSurface = new Uint16Array(chunkOffset);
    L.chunkCi = new Uint16Array(chunkOffset);
    L.chunkCj = new Uint16Array(chunkOffset);
    for (const { s, masks } of pending) {
      for (let k = 0; k < masks.length; k++) {
        const w = popcount16(masks[k]);
        L.weight[s.cellOffset + k] = w;
        L.cellSurface[s.cellOffset + k] = s.index;
        if (s.scoring) L.totalScoringUnits += w;
      }
      for (let cj = 0; cj < s.chunkRows; cj++)
        for (let ci = 0; ci < s.chunkCols; ci++) {
          const c = s.chunkOffset + cj * s.chunkCols + ci;
          L.chunkSurface[c] = s.index;
          L.chunkCi[c] = ci;
          L.chunkCj[c] = cj;
        }
      L.indexSurface(s);
    }
    L.stamp = new Uint32Array(L.surfaces.length);
    return L;
  }

  /* -------------------------- chunks -------------------------- */

  chunkOfCell(cell: number): { chunk: number; local: number } {
    const s = this.surfaces[this.cellSurface[cell]];
    const k = cell - s.cellOffset;
    const i = k % s.cols;
    const j = (k - i) / s.cols;
    const chunk = s.chunkOffset + Math.floor(j / CHUNK_SIDE) * s.chunkCols + Math.floor(i / CHUNK_SIDE);
    const local = (j % CHUNK_SIDE) * CHUNK_SIDE + (i % CHUNK_SIDE);
    return { chunk, local };
  }

  /** Índice global da célula a partir de chunk + índice local; -1 se fora da superfície. */
  cellOfChunkLocal(chunk: number, local: number): number {
    if (chunk < 0 || chunk >= this.totalChunks) return -1;
    const s = this.surfaces[this.chunkSurface[chunk]];
    const i = this.chunkCi[chunk] * CHUNK_SIDE + (local % CHUNK_SIDE);
    const j = this.chunkCj[chunk] * CHUNK_SIDE + Math.floor(local / CHUNK_SIDE);
    if (i >= s.cols || j >= s.rows) return -1;
    return s.cellOffset + j * s.cols + i;
  }

  cellCenter(cell: number, lift = 0): Vec3 {
    const s = this.surfaces[this.cellSurface[cell]];
    const k = cell - s.cellOffset;
    const i = k % s.cols;
    const j = (k - i) / s.cols;
    return facePoint(s, (i + 0.5) * s.cellSize, (j + 0.5) * s.cellSize, lift, s.normal);
  }

  /* ---------------------- índice espacial ---------------------- */

  private indexSurface(s: PaintSurface) {
    const [ax0, ay0, az0] = this.cellCoords([s.aabbMin[0] - 0.3, s.aabbMin[1] - 0.3, s.aabbMin[2] - 0.3]);
    const [ax1, ay1, az1] = this.cellCoords([s.aabbMax[0] + 0.3, s.aabbMax[1] + 0.3, s.aabbMax[2] + 0.3]);
    for (let x = ax0; x <= ax1; x++) for (let y = ay0; y <= ay1; y++) for (let z = az0; z <= az1; z++) this.grid[this.gridIndex(x, y, z)].push(s.index);
  }

  private cellCoords(p: Vec3): [number, number, number] {
    const c = (k: number) => Math.min(this.gridDims[k] - 1, Math.max(0, Math.floor((p[k] - this.gridMin[k]) / this.gridCell)));
    return [c(0), c(1), c(2)];
  }

  private gridIndex(x: number, y: number, z: number) {
    return (x * this.gridDims[1] + y) * this.gridDims[2] + z;
  }

  /** Superfícies cujo AABB pode tocar a caixa [min, max]. */
  querySurfaces(min: Vec3, max: Vec3, out: PaintSurface[] = []): PaintSurface[] {
    out.length = 0;
    this.stampId++;
    if (this.stampId === 0xffffffff) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    const [ax0, ay0, az0] = this.cellCoords(min);
    const [ax1, ay1, az1] = this.cellCoords(max);
    for (let x = ax0; x <= ax1; x++)
      for (let y = ay0; y <= ay1; y++)
        for (let z = az0; z <= az1; z++) {
          const list = this.grid[this.gridIndex(x, y, z)];
          for (let k = 0; k < list.length; k++) {
            const si = list[k];
            if (this.stamp[si] === this.stampId) continue;
            this.stamp[si] = this.stampId;
            const s = this.surfaces[si];
            if (s.aabbMax[0] < min[0] || s.aabbMin[0] > max[0] || s.aabbMax[1] < min[1] || s.aabbMin[1] > max[1] || s.aabbMax[2] < min[2] || s.aabbMin[2] > max[2]) continue;
            out.push(s);
          }
        }
    return out;
  }

  /** Converte (u, v) de uma superfície em célula válida, ou -1. */
  cellAtUV(s: PaintSurface, u: number, v: number): number {
    if (u < 0 || v < 0 || u >= s.width || v >= s.height) return -1;
    const i = Math.min(s.cols - 1, Math.floor(u / s.cellSize));
    const j = Math.min(s.rows - 1, Math.floor(v / s.cellSize));
    const cell = s.cellOffset + j * s.cols + i;
    return this.weight[cell] > 0 ? cell : -1;
  }

  private tmpList: PaintSurface[] = [];

  /**
   * Piso pintável sob um ponto (pés do personagem). Considera superfícies de
   * piso cujo plano está entre `maxAbove` acima e `maxBelow` abaixo do ponto.
   */
  floorAt(p: Vec3, maxBelow = 0.3, maxAbove = 0.12): CellHit | null {
    const list = this.querySurfaces([p[0] - 0.05, p[1] - maxBelow - 0.5, p[2] - 0.05], [p[0] + 0.05, p[1] + maxAbove + 0.2, p[2] + 0.05], this.tmpList);
    let best: CellHit | null = null;
    for (const s of list) {
      if (s.traversal !== 'floor') continue;
      const d = dot(s.normal, p) - s.planeD;
      if (d < -maxAbove || d > maxBelow) continue;
      const rel: Vec3 = [p[0] - s.origin[0], p[1] - s.origin[1], p[2] - s.origin[2]];
      const u = dot(rel, s.axisU);
      const v = dot(rel, s.axisV);
      const cell = this.cellAtUV(s, u, v);
      if (cell < 0) continue;
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { surface: s, cell, d, u, v };
    }
    return best;
  }

  /** Parede pintável num ponto de contato, com normal esperada (apontando para fora). */
  wallAt(p: Vec3, outward: Vec3, maxDist = 0.25): CellHit | null {
    const list = this.querySurfaces([p[0] - maxDist, p[1] - 0.05, p[2] - maxDist], [p[0] + maxDist, p[1] + 0.05, p[2] + maxDist], this.tmpList);
    let best: CellHit | null = null;
    for (const s of list) {
      if (s.traversal !== 'wall') continue;
      if (dot(s.normal, outward) < 0.8) continue;
      const d = dot(s.normal, p) - s.planeD;
      if (Math.abs(d) > maxDist) continue;
      const rel: Vec3 = [p[0] - s.origin[0], p[1] - s.origin[1], p[2] - s.origin[2]];
      const u = dot(rel, s.axisU);
      const v = dot(rel, s.axisV);
      const cell = this.cellAtUV(s, u, v);
      if (cell < 0) continue;
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { surface: s, cell, d, u, v };
    }
    return best;
  }
}

export function popcount16(x: number): number {
  x = x - ((x >> 1) & 0x5555);
  x = (x & 0x3333) + ((x >> 2) & 0x3333);
  x = (x + (x >> 4)) & 0x0f0f;
  return (x + (x >> 8)) & 0x1f;
}

/**
 * Máscara de validade por célula: 16 subamostras. Uma subamostra é inválida se
 * cai fora dos limites da face (células parciais na borda), fora do triângulo
 * (faces triangulares) ou dentro de outro sólido (face coberta por objeto).
 */
function computeMasks(f: MapFace, cols: number, rows: number, cs: number, solids: Solid[]): Uint16Array {
  const masks = new Uint16Array(cols * rows);
  const n = SUBSAMPLES_PER_AXIS;
  const step = cs / n;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      let m = 0;
      for (let sj = 0; sj < n; sj++)
        for (let si = 0; si < n; si++) {
          const u = i * cs + (si + 0.5) * step;
          const v = j * cs + (sj + 0.5) * step;
          if (u <= f.width && v <= f.height && insideTri(f, u, v)) m |= 1 << (sj * n + si);
        }
      masks[j * cols + i] = m;
    }
  // Sólidos que cobrem a face: rasteriza apenas a região projetada de cada um.
  const lift = 0.03;
  const aabb = faceAabb(f);
  for (const s of solids) {
    if (s.blockIndex === f.blockIndex) continue;
    const pad = lift + 0.02;
    if (s.max[0] < aabb.min[0] - pad || s.min[0] > aabb.max[0] + pad) continue;
    if (s.max[1] < aabb.min[1] - pad || s.min[1] > aabb.max[1] + pad) continue;
    if (s.max[2] < aabb.min[2] - pad || s.min[2] > aabb.max[2] + pad) continue;
    // intervalo (u, v) coberto pelo AABB do sólido
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (let c = 0; c < 8; c++) {
      const p: Vec3 = [c & 1 ? s.max[0] : s.min[0], c & 2 ? s.max[1] : s.min[1], c & 4 ? s.max[2] : s.min[2]];
      const rel: Vec3 = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
      const u = dot(rel, f.axisU);
      const v = dot(rel, f.axisV);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const i0 = Math.max(0, Math.floor(u0 / cs));
    const i1 = Math.min(cols - 1, Math.floor(u1 / cs));
    const j0 = Math.max(0, Math.floor(v0 / cs));
    const j1 = Math.min(rows - 1, Math.floor(v1 / cs));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        let m = masks[j * cols + i];
        if (m === 0) continue;
        for (let sj = 0; sj < n; sj++)
          for (let si = 0; si < n; si++) {
            const bit = 1 << (sj * n + si);
            if (!(m & bit)) continue;
            const p = facePoint(f, i * cs + (si + 0.5) * step, j * cs + (sj + 0.5) * step, lift, f.normal);
            if (pointInSolid(s, p)) m &= ~bit;
          }
        masks[j * cols + i] = m;
      }
  }
  return masks;
}
