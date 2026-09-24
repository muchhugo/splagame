import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, ShaderMaterial, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { DecorSpec, MapSpec } from '@borrifo/game-content';
import { Rng } from '@borrifo/game-simulation';

/**
 * Céu, entorno fora da arena e decoração. Decoração nunca tem colisão: fica
 * fora da área jogável ou apoiada sobre sólidos, sem prejudicar leitura.
 */
export class Environment {
  private root: TransformNode;
  private sky: Mesh;
  private skyMat: ShaderMaterial;
  private smoke: Mesh | null = null;
  private smokeData: Array<{ m: Matrix; age: number; seed: number }> = [];
  private time = 0;
  private lamps: StandardMaterial[] = [];
  private mats = new Map<string, StandardMaterial>();

  constructor(
    private readonly scene: Scene,
    private readonly map: MapSpec,
  ) {
    this.root = new TransformNode('entorno', scene);
    const L = map.lighting;
    // Céu
    this.sky = MeshBuilder.CreateSphere('ceu', { diameter: 800, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.skyMat = new ShaderMaterial('mat-ceu', scene, { vertex: 'borrifoSky', fragment: 'borrifoSky' }, { attributes: ['position'], uniforms: ['worldViewProjection', 'skyTop', 'skyHorizon', 'sunDir', 'sunColor', 'time'] });
    this.skyMat.setColor3('skyTop', new Color3(...L.skyTop));
    this.skyMat.setColor3('skyHorizon', new Color3(...L.skyHorizon));
    this.skyMat.setVector3('sunDir', new Vector3(...L.sunDirection).normalize());
    this.skyMat.setColor3('sunColor', new Color3(...L.sunColor));
    this.skyMat.setFloat('time', 0);
    this.skyMat.backFaceCulling = false;
    this.skyMat.disableDepthWrite = true;
    this.sky.material = this.skyMat;
    this.sky.infiniteDistance = true;
    this.sky.renderingGroupId = 0;
    this.sky.isPickable = false;
    this.sky.parent = this.root;

    // Terreno externo: chão de terra, grama e morros baixos.
    const ground = MeshBuilder.CreateGround('terreno', { width: 400, height: 400, subdivisions: 4 }, scene);
    ground.position.y = -0.02;
    ground.material = this.mat('terra', [0.55, 0.42, 0.3], 0.05);
    ground.parent = this.root;
    ground.isPickable = false;
    const rng = new Rng(7);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng.range(-0.1, 0.1);
      const r = rng.range(70, 120);
      const hill = MeshBuilder.CreateSphere(`morro${i}`, { diameter: rng.range(40, 70), segments: 10 }, scene);
      hill.scaling.y = rng.range(0.18, 0.32);
      hill.position.set(Math.cos(a) * r, -2, Math.sin(a) * r * 0.8);
      hill.material = this.mat(i % 3 === 0 ? 'morroSeco' : 'morro', i % 3 === 0 ? [0.72, 0.58, 0.36] : [0.42, 0.55, 0.3], 0.02);
      hill.parent = this.root;
      hill.isPickable = false;
    }
    for (const d of map.decor) this.addDecor(d);
    this.root.getChildMeshes().forEach((m) => {
      m.isPickable = false;
      m.freezeWorldMatrix();
    });
    this.sky.unfreezeWorldMatrix();
  }

  private mat(name: string, rgb: [number, number, number], spec = 0.1, emissive?: [number, number, number]): StandardMaterial {
    const key = name;
    let m = this.mats.get(key);
    if (m) return m;
    m = new StandardMaterial(`mat-${name}`, this.scene);
    m.diffuseColor = new Color3(...rgb);
    m.specularColor = new Color3(spec, spec, spec);
    if (emissive) m.emissiveColor = new Color3(...emissive);
    this.mats.set(key, m);
    return m;
  }

  private addDecor(d: DecorSpec) {
    const s = this.scene;
    const node = new TransformNode(`decor-${d.kind}`, s);
    node.parent = this.root;
    node.position.set(d.pos[0], d.pos[1], d.pos[2]);
    node.rotation.y = d.yaw ?? 0;
    const sc = d.scale ?? 1;
    node.scaling.setAll(sc);
    switch (d.kind) {
      case 'arvore': {
        // ipê estilizado: tronco torto e copa de bolhas floridas
        const trunk = MeshBuilder.CreateCylinder('tronco', { height: 5, diameterTop: 0.35, diameterBottom: 0.7, tessellation: 7 }, s);
        trunk.position.y = 2.5;
        trunk.rotation.z = 0.08;
        trunk.material = this.mat('tronco', [0.36, 0.25, 0.18], 0.02);
        trunk.parent = node;
        const bloom = d.variant === 1 ? [0.93, 0.44, 0.66] : [0.98, 0.78, 0.18];
        for (let i = 0; i < 6; i++) {
          const b = MeshBuilder.CreateSphere('copa', { diameter: 2.6 + (i % 3) * 0.6, segments: 6 }, s);
          b.position.set(Math.cos(i * 1.7) * 1.4, 5.4 + (i % 2) * 0.9, Math.sin(i * 1.7) * 1.4);
          b.material = this.mat(`flor${d.variant}`, bloom as [number, number, number], 0.05);
          b.parent = node;
        }
        break;
      }
      case 'casa': {
        const body = MeshBuilder.CreateBox('casa', { width: 8, height: 4.5, depth: 6 }, s);
        body.position.y = 2.25;
        body.material = this.mat(`casa${d.variant}`, d.variant === 1 ? [0.95, 0.83, 0.55] : [0.86, 0.9, 0.88], 0.02);
        body.parent = node;
        const roof = MeshBuilder.CreateCylinder('telhado', { height: 8.6, diameter: 5.2, tessellation: 3 }, s);
        roof.rotation.z = Math.PI / 2;
        roof.rotation.x = Math.PI / 6;
        roof.scaling.set(1, 1, 1.3);
        roof.position.y = 5.3;
        roof.material = this.mat('telha', [0.66, 0.3, 0.18], 0.1);
        roof.parent = node;
        const door = MeshBuilder.CreatePlane('porta', { width: 1.3, height: 2.3 }, s);
        door.position.set(0, 1.15, -3.01);
        door.material = this.mat('porta', [0.2, 0.42, 0.52], 0.05);
        door.parent = node;
        break;
      }
      case 'bandeirinhas': {
        if (!d.to) break;
        node.position.setAll(0);
        node.rotation.y = 0;
        node.scaling.setAll(1);
        const a = new Vector3(...d.pos);
        const b = new Vector3(...d.to);
        const n = Math.max(6, Math.floor(Vector3.Distance(a, b) / 0.7));
        const flag = MeshBuilder.CreateDisc('bandeira', { radius: 0.24, tessellation: 3 }, s);
        flag.material = this.mat('bandeira', [1, 1, 1], 0.0);
        flag.material.backFaceCulling = false;
        flag.parent = node;
        const palette: Color3[] = [new Color3(0.95, 0.3, 0.2), new Color3(0.98, 0.8, 0.2), new Color3(0.2, 0.6, 0.85), new Color3(0.3, 0.75, 0.4), new Color3(0.9, 0.45, 0.75)];
        const matrices = new Float32Array(n * 16);
        const cols = new Float32Array(n * 4);
        const dir = b.subtract(a);
        const yaw = Math.atan2(dir.x, dir.z);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const p = Vector3.Lerp(a, b, t);
          p.y -= Math.sin(Math.PI * t) * 0.9; // catenária
          const q = Quaternion.RotationYawPitchRoll(yaw + Math.PI / 2, 0, -Math.PI / 2);
          Matrix.Compose(new Vector3(1, 1, 1), q, p).copyToArray(matrices, i * 16);
          const c = palette[i % palette.length];
          cols.set([c.r, c.g, c.b, 1], i * 4);
        }
        flag.thinInstanceSetBuffer('matrix', matrices, 16, true);
        flag.thinInstanceSetBuffer('color', cols, 4, true);
        const line = MeshBuilder.CreateLines('corda', { points: Array.from({ length: 16 }, (_, i) => { const t = i / 15; const p = Vector3.Lerp(a, b, t); p.y -= Math.sin(Math.PI * t) * 0.9 - 0.2; return p; }) }, s);
        line.color = new Color3(0.3, 0.25, 0.2);
        line.parent = node;
        break;
      }
      case 'potes': {
        for (let i = 0; i < 4; i++) {
          const pot = MeshBuilder.CreateLathe('pote', { shape: potProfile(), tessellation: 12 }, s);
          pot.position.set((i - 1.5) * 1.3 + ((d.variant ?? 0) % 2) * 0.4, 0, 0);
          pot.scaling.setAll(0.7 + (i % 2) * 0.25);
          pot.material = this.mat(`pote${i % 3}`, i % 3 === 0 ? [0.72, 0.38, 0.22] : i % 3 === 1 ? [0.55, 0.3, 0.18] : [0.82, 0.62, 0.4], 0.2);
          pot.parent = node;
        }
        break;
      }
      case 'lampiao': {
        const pole = MeshBuilder.CreateCylinder('haste', { height: 1.1, diameter: 0.08 }, s);
        pole.position.y = 0.55;
        pole.material = this.mat('ferro', [0.2, 0.18, 0.16], 0.3);
        pole.parent = node;
        const glass = MeshBuilder.CreateSphere('lampiao', { diameter: 0.34, segments: 8 }, s);
        glass.position.y = 1.2;
        const lm = this.mat('lampiaoLuz', [1, 0.8, 0.45], 0.2, [1, 0.72, 0.35]);
        this.lamps.push(lm);
        glass.material = lm;
        glass.parent = node;
        break;
      }
      case 'fornoBoca': {
        // boca do forno com brasa (emissiva), na face do forno
        const arch = MeshBuilder.CreateDisc('boca', { radius: 0.75, tessellation: 20, arc: 0.5 }, s);
        arch.position.set(0.02, 0.25, 0);
        arch.rotation.y = Math.PI / 2;
        arch.material = this.mat('brasa', [0.2, 0.05, 0.02], 0, [0.95, 0.38, 0.1]);
        arch.parent = node;
        break;
      }
      case 'fumaca': {
        this.smoke = MeshBuilder.CreateSphere('fumaca', { diameter: 1, segments: 6 }, s);
        const m = this.mat('fumacaMat', [0.85, 0.82, 0.8], 0);
        m.alpha = 0.35;
        this.smoke.material = m;
        this.smoke.parent = node;
        for (let i = 0; i < 14; i++) this.smokeData.push({ m: Matrix.Identity(), age: i * 0.45, seed: i * 13.7 });
        const buf = new Float32Array(this.smokeData.length * 16);
        this.smoke.thinInstanceSetBuffer('matrix', buf, 16, false);
        this.smoke.alwaysSelectAsActiveMesh = true;
        break;
      }
      default:
        break;
    }
  }

  update(dt: number) {
    this.time += dt;
    this.skyMat.setFloat('time', this.time);
    const flicker = 0.85 + Math.sin(this.time * 9) * 0.05 + Math.sin(this.time * 23.3) * 0.04;
    for (const l of this.lamps) l.emissiveColor.set(1 * flicker, 0.72 * flicker, 0.35 * flicker);
    if (this.smoke) {
      const buf = new Float32Array(this.smokeData.length * 16);
      this.smokeData.forEach((p, i) => {
        p.age = (p.age + dt) % 6.3;
        const t = p.age / 6.3;
        const s = 0.6 + t * 2.4;
        const pos = new Vector3(Math.sin(p.seed + this.time * 0.3) * t * 1.2 + t * 2.5, t * 9, Math.cos(p.seed) * t * 0.8);
        Matrix.Compose(new Vector3(s, s, s), Quaternion.Identity(), pos).copyToArray(buf, i * 16);
      });
      this.smoke.thinInstanceSetBuffer('matrix', buf, 16, false);
    }
  }

  dispose() {
    this.root.dispose(false, true);
    this.skyMat.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}

function potProfile(): Vector3[] {
  return [new Vector3(0, 0, 0), new Vector3(0.22, 0.02, 0), new Vector3(0.36, 0.25, 0), new Vector3(0.38, 0.45, 0), new Vector3(0.24, 0.72, 0), new Vector3(0.14, 0.82, 0), new Vector3(0.17, 0.9, 0), new Vector3(0.0, 0.9, 0)];
}
