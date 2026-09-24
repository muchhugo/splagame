import type { Vec3 } from '@borrifo/game-contracts';
import type { MapFace, PaintLayout, PaintSurface, PhysicsWorld } from '@borrifo/game-simulation';
import { facePoint } from '@borrifo/game-simulation';

export interface AtlasRect {
  face: MapFace;
  surface: PaintSurface | null;
  x: number;
  y: number;
  w: number;
  h: number;
  texel: number;
}

/**
 * Atlas de render do cenário (cliente). Cada face recebe um retângulo:
 * - faces pintáveis: 1 texel = 1 célula lógica (a tinta visual deriva da lógica);
 * - faces não pintáveis: texels mais grossos, só para iluminação pré-calculada.
 * Canais: R = cobertura da equipe 0, G = equipe 1, B = sol visível, A = oclusão ambiente.
 * A resolução lógica não depende da resolução final do render: o shader suaviza.
 */
export class RenderAtlas {
  readonly rects: AtlasRect[] = [];
  readonly rectBySurface: AtlasRect[] = [];
  width = 1024;
  height = 0;
  data!: Uint8Array;
  dirtyMinRow = Infinity;
  dirtyMaxRow = -1;

  constructor(
    faces: MapFace[],
    private readonly layout: PaintLayout,
  ) {
    const surfaceByFace = new Map<string, PaintSurface>();
    for (const s of layout.surfaces) surfaceByFace.set(s.id, s);
    const items: AtlasRect[] = [];
    for (const f of faces) {
      const s = surfaceByFace.get(f.id) ?? null;
      const texel = s ? s.cellSize : f.material === 'muro' ? 0.5 : 0.35;
      const w = s ? s.cols : Math.max(1, Math.ceil(f.width / texel));
      const h = s ? s.rows : Math.max(1, Math.ceil(f.height / texel));
      items.push({ face: f, surface: s, x: 0, y: 0, w, h, texel });
    }
    // empacotamento em prateleiras (maiores primeiro), com 2 texels de folga
    const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
    const pad = 2;
    let x = 0,
      y = 0,
      shelfH = 0;
    const W = 2048;
    for (const r of order) {
      if (r.w + pad > W) throw new Error('face grande demais para o atlas');
      if (x + r.w + pad > W) {
        x = 0;
        y += shelfH + pad;
        shelfH = 0;
      }
      r.x = x;
      r.y = y;
      x += r.w + pad;
      shelfH = Math.max(shelfH, r.h);
    }
    this.width = W;
    let H = 1;
    while (H < y + shelfH + pad) H *= 2;
    this.height = H;
    this.data = new Uint8Array(W * H * 4);
    // iluminação padrão (sol visível, sem oclusão) até o bake terminar
    for (let i = 0; i < W * H; i++) {
      this.data[i * 4 + 2] = 255;
      this.data[i * 4 + 3] = 255;
    }
    this.rects = items;
    for (const r of items) if (r.surface) this.rectBySurface[r.surface.index] = r;
  }

  /** Coordenadas UV do atlas para (u, v) em metros no plano da face. */
  uvFor(r: AtlasRect, u: number, v: number): [number, number] {
    return [(r.x + u / r.texel) / this.width, (r.y + v / r.texel) / this.height];
  }

  rectUv(r: AtlasRect): [number, number, number, number] {
    return [(r.x + 0.5) / this.width, (r.y + 0.5) / this.height, (r.x + r.w - 0.5) / this.width, (r.y + r.h - 0.5) / this.height];
  }

  /** Atualiza a cor de uma célula lógica (dono -1/0/1). */
  setCell(cell: number, owner: number) {
    const s = this.layout.surfaces[this.layout.cellSurface[cell]];
    const r = this.rectBySurface[s.index];
    if (!r) return;
    const k = cell - s.cellOffset;
    const i = k % s.cols;
    const j = (k - i) / s.cols;
    const row = r.y + j;
    const o = (row * this.width + r.x + i) * 4;
    this.data[o] = owner === 0 ? 255 : 0;
    this.data[o + 1] = owner === 1 ? 255 : 0;
    if (row < this.dirtyMinRow) this.dirtyMinRow = row;
    if (row > this.dirtyMaxRow) this.dirtyMaxRow = row;
  }

  /** Reescreve toda a tinta a partir do array de donos. */
  setAll(owner: Int8Array) {
    for (const r of this.rects) {
      if (!r.surface) continue;
      const s = r.surface;
      for (let j = 0; j < s.rows; j++)
        for (let i = 0; i < s.cols; i++) {
          const o = ((r.y + j) * this.width + r.x + i) * 4;
          const ow = owner[s.cellOffset + j * s.cols + i];
          this.data[o] = ow === 0 ? 255 : 0;
          this.data[o + 1] = ow === 1 ? 255 : 0;
        }
    }
    this.dirtyMinRow = 0;
    this.dirtyMaxRow = this.height - 1;
  }

  takeDirtyRows(): [number, number] | null {
    if (this.dirtyMaxRow < 0) return null;
    const r: [number, number] = [this.dirtyMinRow, this.dirtyMaxRow];
    this.dirtyMinRow = Infinity;
    this.dirtyMaxRow = -1;
    return r;
  }

  /**
   * Pré-calcula sol visível e oclusão ambiente por texel com raycasts no mesmo
   * mundo de colisão. Executado em fatias para não travar a interface.
   */
  async bakeLighting(physics: PhysicsWorld, sunDir: Vec3, onProgress?: (p: number) => void): Promise<void> {
    const toSun: Vec3 = [-sunDir[0], -sunDir[1], -sunDir[2]];
    const L = Math.hypot(...toSun);
    toSun[0] /= L;
    toSun[1] /= L;
    toSun[2] /= L;
    const total = this.rects.reduce((a, r) => a + r.w * r.h, 0);
    let done = 0;
    let sliceStart = performance.now();
    for (const r of this.rects) {
      const f = r.face;
      const n = f.normal;
      // base tangente para raios de oclusão
      const t = f.axisU;
      const b = f.axisV;
      const dirs: Vec3[] = [
        n,
        norm([n[0] + t[0] * 1.1, n[1] + t[1] * 1.1, n[2] + t[2] * 1.1]),
        norm([n[0] - t[0] * 1.1, n[1] - t[1] * 1.1, n[2] - t[2] * 1.1]),
        norm([n[0] + b[0] * 1.1, n[1] + b[1] * 1.1, n[2] + b[2] * 1.1]),
        norm([n[0] - b[0] * 1.1, n[1] - b[1] * 1.1, n[2] - b[2] * 1.1]),
      ];
      const facesSun = n[0] * toSun[0] + n[1] * toSun[1] + n[2] * toSun[2] > 0.01;
      for (let j = 0; j < r.h; j++) {
        for (let i = 0; i < r.w; i++) {
          const u = Math.min(f.width - 0.01, (i + 0.5) * r.texel);
          const v = Math.min(f.height - 0.01, (j + 0.5) * r.texel);
          const p = facePoint(f, u, v, 0.04, n);
          let sun = 0;
          if (facesSun) sun = physics.raycast(p, toSun, 90) ? 0 : 1;
          let occl = 0;
          for (const d of dirs) {
            const hit = physics.raycast(p, d, 1.8);
            if (hit) occl += 1 - hit.toi / 1.8;
          }
          const ao = 1 - Math.min(0.75, (occl / dirs.length) * 1.25);
          const o = ((r.y + j) * this.width + r.x + i) * 4;
          this.data[o + 2] = Math.round(sun * 255);
          this.data[o + 3] = Math.round(ao * 255);
        }
        done += r.w;
        if (performance.now() - sliceStart > 24) {
          onProgress?.(done / total);
          await new Promise((res) => setTimeout(res, 0));
          sliceStart = performance.now();
        }
      }
    }
    // desfoque leve das sombras dentro de cada retângulo (bordas mais suaves)
    this.blurLight();
    this.dirtyMinRow = 0;
    this.dirtyMaxRow = this.height - 1;
    onProgress?.(1);
  }

  private blurLight() {
    const W = this.width;
    for (const r of this.rects) {
      if (r.w < 3 || r.h < 3) continue;
      const tmpB = new Uint8Array(r.w * r.h);
      const tmpA = new Uint8Array(r.w * r.h);
      for (let j = 0; j < r.h; j++)
        for (let i = 0; i < r.w; i++) {
          let sb = 0,
            sa = 0,
            c = 0;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const ii = i + di,
                jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.h) continue;
              const o = ((r.y + jj) * W + r.x + ii) * 4;
              sb += this.data[o + 2];
              sa += this.data[o + 3];
              c++;
            }
          tmpB[j * r.w + i] = sb / c;
          tmpA[j * r.w + i] = sa / c;
        }
      for (let j = 0; j < r.h; j++)
        for (let i = 0; i < r.w; i++) {
          const o = ((r.y + j) * W + r.x + i) * 4;
          this.data[o + 2] = tmpB[j * r.w + i];
          this.data[o + 3] = tmpA[j * r.w + i];
        }
    }
  }
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
