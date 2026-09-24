import type { PaintOwner, TeamId, Vec3, PaintDeltaWire, PaintSnapshotWire, PaintChunkDelta } from '@borrifo/game-contracts';
import { PAINT_DELTA_MAX_CELLS, ownerToWire, wireToOwner } from '@borrifo/game-contracts';
import { dot, Rng } from '../math';
import { facePoint } from '../map/geometry';
import { CHUNK_SIDE, type PaintLayout, type PaintSurface } from './PaintLayout';

export interface SplatOptions {
  center: Vec3;
  radius: number;
  team: TeamId;
  seed: number;
  /** Retorna true se a linha de `from` a `to` está obstruída pelo cenário. */
  occluded?: (from: Vec3, to: Vec3) => boolean;
  /** Modo onda: distância horizontal em [innerRadius, radius] e faixa vertical. */
  innerRadius?: number;
  verticalBand?: number;
  /** Restringe a pisos (usado pela onda da Roda de Oleiro). */
  floorsOnly?: boolean;
  /** Amplitude do contorno orgânico (0 = círculo). */
  wobble?: number;
}

export interface PaintChangeSink {
  (cell: number, prev: PaintOwner, next: TeamId, units: number, scoring: boolean): void;
}

/**
 * Propriedade lógica da tinta (autoridade no servidor; réplica no cliente).
 * Mantém contadores incrementais de área por equipe — nunca recalcula a arena
 * inteira por frame.
 */
export class PaintState {
  readonly owner: Int8Array;
  readonly teamUnits: [number, number] = [0, 0];
  readonly chunkVersion: Uint32Array;
  paintSeq = 0;
  roundId = 0;
  contextTag = 0;

  private tracking = false;
  private pending = new Map<number, Map<number, number>>();
  private pendingCount = 0;
  private readonly tmpSurfaces: PaintSurface[] = [];

  constructor(readonly layout: PaintLayout) {
    this.owner = new Int8Array(layout.totalCells).fill(-1);
    this.chunkVersion = new Uint32Array(layout.totalChunks);
  }

  /** Zera a tinta para uma nova rodada; deltas antigos ficam inválidos pelo roundId. */
  reset(roundId: number, contextTag: number) {
    this.owner.fill(-1);
    this.teamUnits[0] = 0;
    this.teamUnits[1] = 0;
    this.chunkVersion.fill(0);
    this.paintSeq = 0;
    this.roundId = roundId;
    this.contextTag = contextTag;
    this.pending.clear();
    this.pendingCount = 0;
  }

  setTracking(on: boolean) {
    this.tracking = on;
  }

  get neutralUnits(): number {
    return this.layout.totalScoringUnits - this.teamUnits[0] - this.teamUnits[1];
  }

  /** Muda o dono de uma célula; atualiza contadores. Retorna o dono anterior. */
  setOwner(cell: number, next: TeamId, sink?: PaintChangeSink): PaintOwner {
    const prev = this.owner[cell] as PaintOwner;
    if (prev === next) return prev;
    const w = this.layout.weight[cell];
    if (w === 0) return prev;
    this.owner[cell] = next;
    const s = this.layout.surfaces[this.layout.cellSurface[cell]];
    if (s.scoring) {
      if (prev !== -1) this.teamUnits[prev] -= w;
      this.teamUnits[next] += w;
    }
    if (this.tracking) {
      const { chunk, local } = this.layout.chunkOfCell(cell);
      let m = this.pending.get(chunk);
      if (!m) {
        m = new Map();
        this.pending.set(chunk, m);
      }
      if (!m.has(local)) this.pendingCount++;
      m.set(local, ownerToWire(next));
    }
    sink?.(cell, prev, next, w, s.scoring);
    return prev;
  }

  /**
   * Aplica um respingo esférico com regra geométrica explícita:
   * uma célula é pintada se (1) está numa superfície cujo lado frontal contém o
   * centro, (2) está dentro da esfera (ou anel horizontal no modo onda), com
   * contorno orgânico determinístico, e (3) há linha de visão do centro até ela.
   * Isso impede pintar através de paredes ou entre andares.
   */
  paintSplat(opts: SplatOptions, sink?: PaintChangeSink): number {
    const { center, radius, team } = opts;
    const L = this.layout;
    const min: Vec3 = [center[0] - radius, center[1] - (opts.verticalBand ?? radius), center[2] - radius];
    const max: Vec3 = [center[0] + radius, center[1] + (opts.verticalBand ?? radius), center[2] + radius];
    const surfaces = L.querySurfaces(min, max, this.tmpSurfaces).slice();
    const rng = new Rng(opts.seed);
    const wob = opts.wobble ?? 0.18;
    const a1 = wob * 0.5 * rng.next(),
      a2 = wob * 0.33 * rng.next(),
      a3 = wob * 0.2 * rng.next();
    const p1 = rng.range(0, 6.283),
      p2 = rng.range(0, 6.283),
      p3 = rng.range(0, 6.283);
    const shape = (theta: number) => 1 + a1 * Math.sin(3 * theta + p1) + a2 * Math.sin(5 * theta + p2) + a3 * Math.sin(8 * theta + p3) - (a1 + a2 + a3) * 0.35;
    const wave = opts.innerRadius !== undefined;
    let changed = 0;
    const cs = L.cellSize;
    const losCache = new Map<number, boolean>();

    for (const s of surfaces) {
      if (opts.floorsOnly && s.traversal !== 'floor') continue;
      const d = dot(s.normal, center) - s.planeD;
      if (d < -0.02) continue; // centro atrás da face
      if (!wave && d > radius) continue;
      const rel: Vec3 = [center[0] - s.origin[0], center[1] - s.origin[1], center[2] - s.origin[2]];
      const u0 = dot(rel, s.axisU);
      const v0 = dot(rel, s.axisV);
      const rPlane = wave ? radius + 0.5 : Math.sqrt(Math.max(0, radius * radius - d * d));
      if (rPlane <= 0) continue;
      const i0 = Math.max(0, Math.floor((u0 - rPlane) / cs));
      const i1 = Math.min(s.cols - 1, Math.floor((u0 + rPlane) / cs));
      const j0 = Math.max(0, Math.floor((v0 - rPlane) / cs));
      const j1 = Math.min(s.rows - 1, Math.floor((v0 + rPlane) / cs));
      if (i0 > i1 || j0 > j1) continue;
      losCache.clear();
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cell = s.cellOffset + j * s.cols + i;
          if (L.weight[cell] === 0) continue;
          if (this.owner[cell] === team) continue;
          const uc = (i + 0.5) * cs;
          const vc = (j + 0.5) * cs;
          let inside: boolean;
          if (wave) {
            const p = facePoint(s, uc, vc);
            const hd = Math.hypot(p[0] - center[0], p[2] - center[2]);
            const vd = Math.abs(p[1] - center[1]);
            inside = hd >= (opts.innerRadius ?? 0) && hd <= radius && vd <= (opts.verticalBand ?? 1.5);
          } else {
            const du = uc - u0;
            const dv = vc - v0;
            const rr = Math.hypot(du, dv);
            inside = rr <= rPlane * shape(Math.atan2(dv, du)) || rr < cs * 0.5;
          }
          if (!inside) continue;
          if (opts.occluded) {
            const key = (j >> 1) * 65536 + (i >> 1);
            let blocked = losCache.get(key);
            if (blocked === undefined) {
              const bu = Math.min(s.width, ((i & ~1) + 1) * cs);
              const bv = Math.min(s.height, ((j & ~1) + 1) * cs);
              const target = facePoint(s, bu, bv, 0.06, s.normal);
              blocked = opts.occluded(center, target);
              losCache.set(key, blocked);
            }
            if (blocked) continue;
          }
          this.setOwner(cell, team, sink);
          changed++;
        }
      }
    }
    return changed;
  }

  /* ---------------------- sincronização ---------------------- */

  hasPendingChanges(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Gera deltas versionados com as mudanças acumuladas desde o último flush.
   * Divide em várias mensagens se ultrapassar o limite de células.
   */
  flushDeltas(): PaintDeltaWire[] {
    if (this.pending.size === 0) return [];
    const out: PaintDeltaWire[] = [];
    let chunks: PaintChunkDelta[] = [];
    let count = 0;
    const emit = () => {
      if (chunks.length === 0) return;
      out.push({ contextTag: this.contextTag, roundId: this.roundId, fromSeq: this.paintSeq, toSeq: this.paintSeq + 1, chunks });
      this.paintSeq++;
      chunks = [];
      count = 0;
    };
    const ids = [...this.pending.keys()].sort((a, b) => a - b);
    for (const chunk of ids) {
      const m = this.pending.get(chunk)!;
      if (count + m.size > PAINT_DELTA_MAX_CELLS) emit();
      const base = this.chunkVersion[chunk];
      this.chunkVersion[chunk] = base + 1;
      chunks.push({ chunkId: chunk, baseVersion: base, newVersion: base + 1, cells: [...m.entries()] });
      count += m.size;
    }
    emit();
    this.pending.clear();
    this.pendingCount = 0;
    return out;
  }

  toSnapshot(): PaintSnapshotWire {
    const cells = new Uint8Array(this.owner.length);
    for (let i = 0; i < cells.length; i++) cells[i] = ownerToWire(this.owner[i]);
    return { contextTag: this.contextTag, roundId: this.roundId, paintSeq: this.paintSeq, cells, chunkVersions: this.chunkVersion.slice() };
  }

  /** Substitui todo o estado pelo snapshot (lado do cliente). */
  applySnapshot(s: PaintSnapshotWire): void {
    if (s.cells.length !== this.owner.length) throw new Error('snapshot de tinta com tamanho incompatível');
    if (s.chunkVersions.length !== this.chunkVersion.length) throw new Error('snapshot de tinta com chunks incompatíveis');
    this.teamUnits[0] = 0;
    this.teamUnits[1] = 0;
    for (let i = 0; i < s.cells.length; i++) {
      const o = wireToOwner(s.cells[i]);
      this.owner[i] = o;
      if (o !== -1 && this.layout.weight[i] > 0 && this.layout.surfaces[this.layout.cellSurface[i]].scoring) this.teamUnits[o] += this.layout.weight[i];
    }
    this.chunkVersion.set(s.chunkVersions);
    this.paintSeq = s.paintSeq;
    this.roundId = s.roundId;
    this.contextTag = s.contextTag;
  }

  /**
   * Aplica um delta verificando contexto, rodada, sequência e versão base de
   * cada chunk. Retorna as células alteradas, ou um motivo de ressincronização.
   */
  applyDelta(d: PaintDeltaWire, changedOut?: number[]): { ok: true } | { ok: false; reason: string } {
    if (d.contextTag !== this.contextTag) return { ok: false, reason: 'context' };
    if (d.roundId !== this.roundId) return { ok: false, reason: 'round' };
    if (d.fromSeq !== this.paintSeq) return { ok: false, reason: 'gap' };
    for (const c of d.chunks) {
      if (c.chunkId >= this.chunkVersion.length) return { ok: false, reason: 'chunk' };
      if (this.chunkVersion[c.chunkId] !== c.baseVersion) return { ok: false, reason: 'version' };
    }
    for (const c of d.chunks) {
      for (const [local, v] of c.cells) {
        const cell = this.layout.cellOfChunkLocal(c.chunkId, local);
        if (cell < 0) continue;
        const o = wireToOwner(v);
        if (o === -1) continue;
        if (this.setOwner(cell, o) !== o) changedOut?.push(cell);
      }
      this.chunkVersion[c.chunkId] = c.newVersion;
    }
    this.paintSeq = d.toSeq;
    return { ok: true };
  }
}

export { CHUNK_SIDE };
