import { Color3, DynamicTexture, Matrix, Mesh, MeshBuilder, Quaternion, Scene, ShaderMaterial, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { DecorSpec, MapSpec } from '@borrifo/game-content';
import { GAME_NAME } from '@borrifo/game-contracts';
import { Rng } from '@borrifo/game-simulation';
import { ToonMaterial } from './ToonMaterial';

/**
 * Céu, entorno e decoração em estilo cartoon (cel shading suave). Decoração
 * não tem colisão própria: fica fora da área jogável ou sobre sólidos do
 * MapSpec (pedestal da estátua, muros), sem bloquear a leitura do combate.
 */
export class Environment {
  private root: TransformNode;
  private sky: Mesh;
  private skyMat: ShaderMaterial;
  /** Uma coluna de fumaça por chaminé; buffers pré-alocados (sem alocação por quadro). */
  private smokes: Array<{ mesh: Mesh; buf: Float32Array; puffs: Array<{ age: number; seed: number }> }> = [];
  private smokeMat: StandardMaterial | null = null;
  private tmpScale = new Vector3();
  private tmpPos = new Vector3();
  private tmpMat = new Matrix();
  private tmpQuat = Quaternion.Identity();
  private time = 0;
  private lamps: StandardMaterial[] = [];
  private toon = new Map<string, ToonMaterial>();
  private std: StandardMaterial[] = [];
  private textures: DynamicTexture[] = [];
  private spinners: TransformNode[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly map: MapSpec,
  ) {
    this.root = new TransformNode('entorno', scene);
    const L = map.lighting;
    this.sky = MeshBuilder.CreateSphere('ceu', { diameter: 900, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
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
    this.sky.isPickable = false;
    this.sky.parent = this.root;

    // gramado e caminho de terra fora do pátio
    const ground = MeshBuilder.CreateGround('gramado', { width: 500, height: 500, subdivisions: 2 }, scene);
    ground.position.y = -0.03;
    ground.material = this.tm('grama', [0.46, 0.72, 0.36], 0.05);
    ground.parent = this.root;
    const path = MeshBuilder.CreateGround('caminho', { width: 7, height: 160 }, scene);
    path.position.set(0, -0.02, 60);
    path.material = this.tm('terra', [0.86, 0.7, 0.46], 0.02);
    path.parent = this.root;
    const rng = new Rng(7);
    // morros próximos (verdes) e montanhas distantes (azuladas pela névoa)
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rng.range(-0.1, 0.1);
      const r = rng.range(62, 95);
      const hill = MeshBuilder.CreateSphere(`morro${i}`, { diameter: rng.range(34, 60), segments: 10 }, scene);
      hill.scaling.y = rng.range(0.16, 0.3);
      hill.position.set(Math.cos(a) * r, -1.5, Math.sin(a) * r * 0.85);
      hill.material = this.tm(i % 4 === 0 ? 'morroSeco' : i % 2 ? 'morro' : 'morroClaro', i % 4 === 0 ? [0.78, 0.72, 0.42] : i % 2 ? [0.4, 0.66, 0.34] : [0.5, 0.74, 0.38], 0.02);
      hill.parent = this.root;
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.2;
      const r = rng.range(170, 230);
      const mt = MeshBuilder.CreateCylinder(`serra${i}`, { diameterTop: rng.range(4, 14), diameterBottom: rng.range(70, 110), height: rng.range(26, 48), tessellation: 7 }, scene);
      mt.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
      mt.rotation.y = rng.range(0, 3);
      mt.material = this.tm('serra', [0.56, 0.64, 0.78], 0.0);
      mt.parent = this.root;
    }
    for (const d of map.decor) this.addDecor(d);
    this.mergeStatic();
    this.root.getChildMeshes().forEach((m) => {
      m.isPickable = false;
      if (m !== this.sky && !this.smokes.some((f) => f.mesh === m)) m.freezeWorldMatrix();
    });
    for (const s of this.spinners) s.getChildMeshes().forEach((m) => m.unfreezeWorldMatrix());
  }

  /**
   * Funde a decoração estática que compartilha material numa única malha
   * (menos chamadas de desenho). Ficam de fora: céu, fumaça, peças que giram,
   * malhas com instâncias finas e o que tem contorno próprio.
   */
  private mergeStatic() {
    const spinning = new Set<Mesh>();
    for (const sp of this.spinners) for (const m of sp.getChildMeshes()) spinning.add(m as Mesh);
    const groups = new Map<number, Mesh[]>();
    for (const m of this.root.getChildMeshes()) {
      if (!(m instanceof Mesh) || !m.material || m === this.sky || spinning.has(m) || m.hasThinInstances || m.renderOutline) continue;
      if (this.smokes.some((f) => f.mesh === m)) continue;
      const k = m.material.uniqueId;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(m);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      let merged: Mesh | null = null;
      try {
        merged = Mesh.MergeMeshes(g, true, true);
      } catch {
        merged = null; // atributos de vértice incompatíveis: mantém as malhas separadas
      }
      if (merged) {
        merged.name = `entorno-${g[0].material!.name}`;
        merged.parent = this.root;
      }
    }
  }

  private tm(name: string, rgb: [number, number, number], gloss = 0.1): ToonMaterial {
    let m = this.toon.get(name);
    if (m) return m;
    m = new ToonMaterial(`env-${name}`, this.scene, new Color3(...rgb), gloss);
    this.toon.set(name, m);
    return m;
  }

  private addDecor(d: DecorSpec) {
    const s = this.scene;
    const node = new TransformNode(`decor-${d.kind}`, s);
    node.parent = this.root;
    node.position.set(d.pos[0], d.pos[1], d.pos[2]);
    node.rotation.y = d.yaw ?? 0;
    node.scaling.setAll(d.scale ?? 1);
    switch (d.kind) {
      case 'arvore': {
        // tronco simples levemente torto + copa em poucos volumes
        const trunk = MeshBuilder.CreateCylinder('tronco', { height: 4.6, diameterTop: 0.45, diameterBottom: 0.85, tessellation: 7 }, s);
        trunk.position.y = 2.3;
        trunk.rotation.z = 0.1;
        trunk.material = this.tm('tronco', [0.52, 0.38, 0.28], 0.02);
        trunk.parent = node;
        const bloom: [number, number, number] = d.variant === 1 ? [0.98, 0.56, 0.72] : d.variant === 2 ? [0.99, 0.82, 0.26] : [0.36, 0.7, 0.34];
        const blobs: Array<[number, number, number, number]> = [
          [0, 5.4, 0, 3.6],
          [1.3, 4.9, 0.4, 2.6],
          [-1.2, 5.0, -0.5, 2.7],
          [0.3, 6.4, -0.3, 2.4],
        ];
        for (const [x, y, z, r] of blobs) {
          const b = MeshBuilder.CreateIcoSphere('copa', { radius: r / 2, subdivisions: 2 }, s);
          b.position.set(x, y, z);
          b.material = this.tm(`copa${d.variant ?? 0}`, bloom, 0.05);
          b.parent = node;
        }
        break;
      }
      case 'casa': {
        const wallCol: [number, number, number] = d.variant === 1 ? [0.98, 0.86, 0.6] : [0.86, 0.94, 0.93];
        const body = MeshBuilder.CreateBox('casa', { width: 8, height: 4.5, depth: 6 }, s);
        body.position.y = 2.25;
        body.material = this.tm(`casa${d.variant}`, wallCol, 0.02);
        body.parent = node;
        const roof = MeshBuilder.CreateCylinder('telhado', { height: 8.8, diameter: 5.4, tessellation: 3 }, s);
        roof.rotation.z = Math.PI / 2;
        roof.rotation.x = Math.PI / 6;
        roof.scaling.set(1, 1, 1.3);
        roof.position.y = 5.3;
        roof.material = this.tm('telhaCasa', [0.86, 0.42, 0.28], 0.1);
        roof.parent = node;
        const door = MeshBuilder.CreatePlane('porta', { width: 1.3, height: 2.3 }, s);
        door.position.set(0, 1.15, -3.01);
        door.material = this.tm('porta', [0.2, 0.46, 0.62], 0.1);
        door.parent = node;
        for (const x of [-2.6, 2.6]) {
          const win = MeshBuilder.CreatePlane('janela', { width: 1.2, height: 1.1 }, s);
          win.position.set(x, 2.7, -3.01);
          win.material = this.tm('janela', [0.98, 0.84, 0.4], 0.1);
          win.parent = node;
        }
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
        const flag = MeshBuilder.CreateDisc('bandeira', { radius: 0.26, tessellation: 3 }, s);
        const fm = new StandardMaterial('mat-bandeira', s);
        fm.diffuseColor = new Color3(1, 1, 1);
        fm.emissiveColor = new Color3(0.35, 0.35, 0.35);
        fm.specularColor = new Color3(0, 0, 0);
        fm.backFaceCulling = false;
        this.std.push(fm);
        flag.material = fm;
        flag.parent = node;
        const palette: Color3[] = [new Color3(0.98, 0.36, 0.3), new Color3(1, 0.84, 0.25), new Color3(0.26, 0.64, 0.96), new Color3(0.36, 0.82, 0.46), new Color3(0.96, 0.5, 0.82)];
        const matrices = new Float32Array(n * 16);
        const cols = new Float32Array(n * 4);
        const dir = b.subtract(a);
        const yaw = Math.atan2(dir.x, dir.z);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const p = Vector3.Lerp(a, b, t);
          p.y -= Math.sin(Math.PI * t) * 0.9;
          const q = Quaternion.RotationYawPitchRoll(yaw + Math.PI / 2, 0, -Math.PI / 2);
          Matrix.Compose(new Vector3(1, 1, 1), q, p).copyToArray(matrices, i * 16);
          const c = palette[i % palette.length];
          cols.set([c.r, c.g, c.b, 1], i * 4);
        }
        flag.thinInstanceSetBuffer('matrix', matrices, 16, true);
        flag.thinInstanceSetBuffer('color', cols, 4, true);
        const line = MeshBuilder.CreateLines('corda', { points: Array.from({ length: 16 }, (_, i) => { const t = i / 15; const p = Vector3.Lerp(a, b, t); p.y -= Math.sin(Math.PI * t) * 0.9 - 0.22; return p; }) }, s);
        line.color = new Color3(0.35, 0.28, 0.24);
        line.parent = node;
        break;
      }
      case 'potes': {
        for (let i = 0; i < 4; i++) {
          const pot = MeshBuilder.CreateLathe('pote', { shape: potProfile(), tessellation: 10 }, s);
          pot.position.set((i - 1.5) * 1.3 + ((d.variant ?? 0) % 2) * 0.4, 0, 0);
          pot.scaling.setAll(0.75 + (i % 2) * 0.3);
          pot.material = this.tm(`pote${i % 3}`, i % 3 === 0 ? [0.86, 0.5, 0.32] : i % 3 === 1 ? [0.36, 0.62, 0.76] : [0.96, 0.8, 0.52], 0.4);
          pot.parent = node;
        }
        break;
      }
      case 'lampiao': {
        const pole = MeshBuilder.CreateCylinder('haste', { height: 1.1, diameter: 0.09, tessellation: 6 }, s);
        pole.position.y = 0.55;
        pole.material = this.tm('ferro', [0.25, 0.23, 0.3], 0.3);
        pole.parent = node;
        const glass = MeshBuilder.CreateSphere('lampiao', { diameter: 0.36, segments: 8 }, s);
        glass.position.y = 1.2;
        const lm = new StandardMaterial('mat-lampiao', s);
        lm.diffuseColor = new Color3(1, 0.86, 0.5);
        lm.emissiveColor = new Color3(1, 0.78, 0.4);
        lm.disableLighting = true;
        this.lamps.push(lm);
        glass.material = lm;
        glass.parent = node;
        break;
      }
      case 'fornoBoca': {
        const arch = MeshBuilder.CreateDisc('boca', { radius: 0.8, tessellation: 18, arc: 0.5 }, s);
        arch.position.set(0.02, 0.25, 0);
        arch.rotation.y = Math.PI / 2;
        const bm = new StandardMaterial('mat-brasa', s);
        bm.emissiveColor = new Color3(1, 0.48, 0.16);
        bm.disableLighting = true;
        this.std.push(bm);
        arch.material = bm;
        arch.parent = node;
        break;
      }
      case 'fumaca': {
        if (!this.smokeMat) {
          const m = new StandardMaterial('mat-fumaca', s);
          m.diffuseColor = new Color3(0.98, 0.97, 1.0);
          m.emissiveColor = new Color3(0.6, 0.6, 0.66);
          m.specularColor = new Color3(0, 0, 0);
          m.alpha = 0.6;
          this.std.push(m);
          this.smokeMat = m;
        }
        const mesh = MeshBuilder.CreateSphere('fumaca', { diameter: 0.9, segments: 8 }, s);
        mesh.material = this.smokeMat;
        mesh.parent = node;
        const puffs = Array.from({ length: 12 }, (_, i) => ({ age: i * 0.5, seed: i * 13.7 + this.smokes.length * 5.1 }));
        const buf = new Float32Array(puffs.length * 16);
        mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
        mesh.alwaysSelectAsActiveMesh = true;
        this.smokes.push({ mesh, buf, puffs });
        break;
      }
      case 'estatua': {
        // gira devagar sobre o pedestal (roda de oleiro): as duas turmas veem o rosto
        const spin = new TransformNode('estatua-giro', s);
        spin.parent = node;
        this.buildStatue(spin);
        this.spinners.push(spin);
        break;
      }
      case 'letreiro':
        this.buildSign(node, d);
        break;
      case 'rodaGigante': {
        // roda de oleiro decorativa girando sobre o telhado
        const spin = new TransformNode('roda', s);
        spin.parent = node;
        const disc = MeshBuilder.CreateCylinder('disco', { height: 0.25, diameter: 2.6, tessellation: 20 }, s);
        disc.material = this.tm('discoRoda', [0.82, 0.54, 0.36], 0.2);
        disc.parent = spin;
        const lump = MeshBuilder.CreateSphere('barro', { diameter: 1.1, segments: 8 }, s);
        lump.scaling.y = 1.3;
        lump.position.y = 0.6;
        lump.material = this.tm('barroCru', [0.78, 0.48, 0.34], 0.1);
        lump.parent = spin;
        this.spinners.push(spin);
        break;
      }
      default:
        break;
    }
  }

  /** Bibelô Gigante: escultura-marco da praça (sobre o pedestal sólido do mapa). */
  private buildStatue(node: TransformNode) {
    const s = this.scene;
    const glaze = this.tm('estatuaEsmalte', [0.98, 0.94, 0.84], 0.9);
    const blue = this.tm('estatuaAzul', [0.18, 0.36, 0.8], 0.8);
    const gold = this.tm('estatuaOuro', [0.98, 0.78, 0.3], 0.9);
    const body = MeshBuilder.CreateLathe('corpo', { shape: [new Vector3(0, 0, 0), new Vector3(0.55, 0, 0), new Vector3(0.85, 0.35, 0), new Vector3(0.9, 0.9, 0), new Vector3(0.62, 1.45, 0), new Vector3(0.38, 1.62, 0), new Vector3(0, 1.62, 0)], tessellation: 16 }, s);
    body.material = glaze;
    body.parent = node;
    const band = MeshBuilder.CreateTorus('faixa', { diameter: 1.78, thickness: 0.16, tessellation: 24 }, s);
    band.position.y = 0.72;
    band.material = blue;
    band.parent = node;
    const head = MeshBuilder.CreateLathe('cabeca', { shape: [new Vector3(0, 0, 0), new Vector3(0.36, 0, 0), new Vector3(0.62, 0.2, 0), new Vector3(0.66, 0.46, 0), new Vector3(0.52, 0.78, 0), new Vector3(0, 0.8, 0)], tessellation: 16 }, s);
    head.position.y = 1.62;
    head.material = glaze;
    head.parent = node;
    const hat = MeshBuilder.CreateCylinder('tampa', { height: 0.22, diameterTop: 0.35, diameterBottom: 1.0, tessellation: 16 }, s);
    hat.position.y = 2.52;
    hat.material = blue;
    hat.parent = node;
    for (const side of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere('olho', { diameter: 0.2, segments: 6 }, s);
      eye.scaling.set(0.8, 1.2, 0.5);
      eye.position.set(0.2 * side, 2.0, 0.58);
      eye.material = this.tm('estatuaOlho', [0.1, 0.08, 0.12], 0.9);
      eye.parent = node;
      // braço erguido segurando um Esguicho dourado (pose cômica de vitória)
      const arm = MeshBuilder.CreateCapsule('braco', { radius: 0.14, height: 1.1, tessellation: 8 }, s);
      arm.position.set(0.95 * side, 1.55, 0);
      arm.rotation.z = side * -0.9;
      arm.material = glaze;
      arm.parent = node;
    }
    const trophy = MeshBuilder.CreateSphere('trofeu', { diameter: 0.55, segments: 8 }, s);
    trophy.position.set(1.45, 2.1, 0);
    trophy.material = gold;
    trophy.parent = node;
    for (const m of [body, head]) {
      m.renderOutline = true;
      m.outlineWidth = 0.03;
      m.outlineColor = new Color3(0.12, 0.1, 0.18);
    }
  }

  /** Letreiro grande da olaria (orientação e identidade). */
  private buildSign(node: TransformNode, d: DecorSpec) {
    const s = this.scene;
    const tex = new DynamicTexture('tex-letreiro', { width: 1024, height: 256 }, s, true);
    const label = d.variant === 1 ? 'PÁTIO' : `OLARIA ${GAME_NAME.toUpperCase()}`;
    const draw = () => {
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      ctx.fillStyle = '#f6c14b';
      ctx.fillRect(0, 0, 1024, 256);
      ctx.fillStyle = '#e8552b';
      ctx.fillRect(0, 0, 1024, 26);
      ctx.fillRect(0, 230, 1024, 26);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // ajusta o corpo da fonte para caber na placa com margem
      let size = 150;
      ctx.font = `700 ${size}px Fredoka, Trebuchet MS, sans-serif`;
      const w = ctx.measureText(label).width;
      if (w > 900) size = Math.floor((size * 900) / w);
      ctx.font = `700 ${size}px Fredoka, Trebuchet MS, sans-serif`;
      ctx.lineWidth = 14;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#3a2720';
      ctx.strokeText(label, 512, 136);
      ctx.fillStyle = '#fff4e6';
      ctx.fillText(label, 512, 136);
      tex.update();
    };
    draw();
    // a fonte do jogo pode chegar depois da primeira pintura da textura
    document.fonts?.load('700 150px Fredoka').then(() => tex.getScene() && draw(), () => {});
    this.textures.push(tex);
    const board = MeshBuilder.CreatePlane('placa', { width: 10, height: 2.5 }, s);
    board.position.y = 1.25;
    const bm = new StandardMaterial('mat-letreiro', s);
    bm.diffuseTexture = tex;
    bm.emissiveColor = new Color3(0.45, 0.45, 0.45);
    bm.specularColor = new Color3(0, 0, 0);
    this.std.push(bm);
    board.material = bm;
    board.parent = node;
    const frame = MeshBuilder.CreateBox('moldura', { width: 10.4, height: 2.9, depth: 0.2 }, s);
    frame.position.set(0, 1.25, 0.12);
    frame.material = this.tm('molduraLetreiro', [0.5, 0.32, 0.22], 0.1);
    frame.parent = node;
    for (const x of [-4.2, 4.2]) {
      const post = MeshBuilder.CreateCylinder('poste', { height: 3.2, diameter: 0.25, tessellation: 6 }, s);
      post.position.set(x, -0.9, 0.1);
      post.material = frame.material;
      post.parent = node;
    }
  }

  update(dt: number) {
    this.time += dt;
    this.skyMat.setFloat('time', this.time);
    const flicker = 0.9 + Math.sin(this.time * 9) * 0.05 + Math.sin(this.time * 23.3) * 0.04;
    for (const l of this.lamps) l.emissiveColor.set(1 * flicker, 0.78 * flicker, 0.4 * flicker);
    for (const sp of this.spinners) sp.rotation.y += dt * (sp.name === 'estatua-giro' ? 0.35 : 1.6);
    for (const f of this.smokes) {
      f.puffs.forEach((p, i) => {
        p.age = (p.age + dt) % 6;
        const t = p.age / 6;
        const sc = (0.6 + t * 2.6) * Math.min(1, (1 - t) * 4);
        this.tmpScale.setAll(sc);
        this.tmpPos.set(Math.sin(p.seed + this.time * 0.3) * t * 1.2 + t * 2.5, t * 9, Math.cos(p.seed) * t * 0.8);
        Matrix.ComposeToRef(this.tmpScale, this.tmpQuat, this.tmpPos, this.tmpMat);
        this.tmpMat.copyToArray(f.buf, i * 16);
      });
      f.mesh.thinInstanceBufferUpdated('matrix');
    }
  }

  dispose() {
    this.root.dispose(false, true);
    this.skyMat.dispose();
    for (const m of this.toon.values()) m.dispose();
    for (const m of this.std) m.dispose();
    for (const m of this.lamps) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}

function potProfile(): Vector3[] {
  return [new Vector3(0, 0, 0), new Vector3(0.22, 0.02, 0), new Vector3(0.36, 0.25, 0), new Vector3(0.38, 0.45, 0), new Vector3(0.24, 0.72, 0), new Vector3(0.14, 0.82, 0), new Vector3(0.17, 0.9, 0), new Vector3(0.0, 0.9, 0)];
}
