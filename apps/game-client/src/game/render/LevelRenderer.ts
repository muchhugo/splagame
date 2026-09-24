import { Color3, Constants, Mesh, RawTexture, Scene, ShaderMaterial, Texture, Vector2, Vector3, VertexData } from '@babylonjs/core';
import type { MapSpec, MaterialId } from '@borrifo/game-content';
import type { MapFace, PaintLayout } from '@borrifo/game-simulation';
import { facePoint } from '@borrifo/game-simulation';
import { RenderAtlas } from './RenderAtlas';
import './shaders';

export const MATERIAL_CODE: Record<MaterialId, number> = { terracota: 0, tijolo: 1, madeira: 2, azulejo: 3, pedra: 4, barro: 5, latao: 6, muro: 7 };
export const MATERIAL_BASE: Record<MaterialId, [number, number, number]> = {
  terracota: [0.86, 0.72, 0.58],
  tijolo: [0.64, 0.36, 0.27],
  madeira: [0.6, 0.45, 0.31],
  azulejo: [0.9, 0.9, 0.88],
  pedra: [0.66, 0.64, 0.6],
  barro: [0.7, 0.34, 0.2],
  latao: [0.8, 0.64, 0.3],
  muro: [0.93, 0.9, 0.83],
};

/**
 * Malha do cenário gerada do MapSpec (mesma fonte dos colisores e da tinta).
 * Uma única malha e um único material: poucas draw calls, atlas atualizado por faixas.
 */
export class LevelRenderer {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly atlas: RenderAtlas;
  readonly texture: RawTexture;
  private scene: Scene;

  constructor(scene: Scene, map: MapSpec, faces: MapFace[], layout: PaintLayout) {
    this.scene = scene;
    this.atlas = new RenderAtlas(faces, layout);
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const uvs2: number[] = [];
    const colors: number[] = [];
    const rects: number[] = [];
    const tangs: number[] = [];
    const bitangs: number[] = [];
    const indices: number[] = [];

    for (const r of this.atlas.rects) {
      const f = r.face;
      const corners: Array<[number, number]> = f.kind === 'quad' ? [[0, 0], [f.width, 0], [f.width, f.height], [0, f.height]] : [[0, 0], [f.width, 0], [f.width, f.height]];
      const base = positions.length / 3;
      const offU = f.origin[0] * f.axisU[0] + f.origin[1] * f.axisU[1] + f.origin[2] * f.axisU[2];
      const offV = f.origin[0] * f.axisV[0] + f.origin[1] * f.axisV[1] + f.origin[2] * f.axisV[2];
      const code = MATERIAL_CODE[f.material];
      const baseColor = MATERIAL_BASE[f.material];
      const rect = r.surface ? this.atlas.rectUv(r) : this.atlas.rectUv(r).map((v, i) => (i === 0 ? -1 : v));
      for (const [u, v] of corners) {
        const p = facePoint(f, u, v);
        positions.push(p[0], p[1], p[2]);
        normals.push(f.normal[0], f.normal[1], f.normal[2]);
        uvs.push(u + offU, v + offV);
        const a = this.atlas.uvFor(r, u, v);
        uvs2.push(a[0], a[1]);
        colors.push(baseColor[0], baseColor[1], baseColor[2], code / 8);
        rects.push(rect[0], rect[1], rect[2], rect[3]);
        tangs.push(f.axisU[0], f.axisU[1], f.axisU[2]);
        bitangs.push(f.axisV[0], f.axisV[1], f.axisV[2]);
      }
      // orientação: a normal geométrica deve coincidir com a normal da face
      const c = cross(f.axisU, f.axisV);
      const flip = c[0] * f.normal[0] + c[1] * f.normal[1] + c[2] * f.normal[2] > 0;
      const tri = (a: number, b: number, d: number) => (flip ? indices.push(base + a, base + d, base + b) : indices.push(base + a, base + b, base + d));
      tri(0, 1, 2);
      if (f.kind === 'quad') tri(0, 2, 3);
    }

    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.uvs2 = uvs2;
    vd.colors = colors;
    vd.indices = indices;
    this.mesh = new Mesh('cenario', scene);
    vd.applyToMesh(this.mesh, false);
    this.mesh.setVerticesData('rect', rects, false, 4);
    this.mesh.setVerticesData('tang', tangs, false, 3);
    this.mesh.setVerticesData('bitang', bitangs, false, 3);
    this.mesh.isPickable = false;
    this.mesh.freezeWorldMatrix();

    this.texture = RawTexture.CreateRGBATexture(this.atlas.data, this.atlas.width, this.atlas.height, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;

    this.material = new ShaderMaterial(
      'mat-cenario',
      scene,
      { vertex: 'borrifoLevel', fragment: 'borrifoLevel' },
      {
        attributes: ['position', 'normal', 'uv', 'uv2', 'color', 'rect', 'tang', 'bitang'],
        uniforms: ['world', 'viewProjection', 'cameraPosition', 'sunDir', 'sunColor', 'skyColor', 'groundColor', 'fogColor', 'fogDensity', 'team0', 'team1', 'atlasTexel', 'patterns', 'time'],
        samplers: ['atlas'],
      },
    );
    const L = map.lighting;
    this.material.setTexture('atlas', this.texture);
    this.material.setVector2('atlasTexel', new Vector2(1 / this.atlas.width, 1 / this.atlas.height));
    this.material.setVector3('sunDir', new Vector3(...L.sunDirection).normalize());
    this.material.setColor3('sunColor', new Color3(...L.sunColor));
    // ambiente: céu clareado e chão quente (evita sombras azuladas demais no barro)
    this.material.setColor3('skyColor', Color3.Lerp(new Color3(...L.skyTop), new Color3(1, 0.95, 0.9), 0.55).scale(0.85));
    this.material.setColor3('groundColor', new Color3(0.56, 0.44, 0.36));
    this.material.setColor3('fogColor', new Color3(...L.fogColor));
    this.material.setFloat('fogDensity', L.fogDensity);
    this.material.setFloat('patterns', 0);
    this.material.setFloat('time', 0);
    this.material.backFaceCulling = true;
    this.mesh.material = this.material;
    this.material.onBindObservable.add(() => {
      const cam = scene.activeCamera;
      if (cam) this.material.getEffect()?.setVector3('cameraPosition', cam.globalPosition);
    });
  }

  setTeamColors(c0: Color3, c1: Color3) {
    this.material.setColor3('team0', c0);
    this.material.setColor3('team1', c1);
  }

  setPatterns(on: boolean) {
    this.material.setFloat('patterns', on ? 1 : 0);
  }

  /** Envia à GPU apenas a faixa de linhas alterada desde o último frame. */
  flushTexture() {
    const rows = this.atlas.takeDirtyRows();
    if (!rows) return;
    const internal = this.texture.getInternalTexture();
    if (!internal) return;
    const W = this.atlas.width;
    const [y0, y1] = rows;
    const sub = this.atlas.data.subarray(y0 * W * 4, (y1 + 1) * W * 4);
    const engine = this.scene.getEngine() as unknown as { updateTextureData(t: unknown, d: ArrayBufferView, x: number, y: number, w: number, h: number): void };
    engine.updateTextureData(internal, sub, 0, y0, W, y1 - y0 + 1);
  }

  dispose() {
    this.mesh.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
