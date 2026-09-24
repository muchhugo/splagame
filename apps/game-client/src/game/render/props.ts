import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { ToonMaterial } from './ToonMaterial';

/**
 * Props de cenário reutilizáveis (brasileiros, desenhados por código, sem assets de
 * terceiros). Nenhum tem colisão: ficam fora das rotas, sobre sólidos do MapSpec ou
 * acima da altura de jogo. Não cobrem faces pintáveis (a tinta é a informação principal).
 */
export type TM = (name: string, rgb: [number, number, number], gloss?: number) => ToonMaterial;

export interface PropCtx {
  scene: Scene;
  tm: TM;
  std: StandardMaterial[];
  textures: DynamicTexture[];
}

/** Arara estilizada (própria): corpo vermelho, asas azul e amarelo, bico curvo claro. */
export function buildMacaw(ctx: PropCtx, parent: TransformNode, scale = 1): { root: TransformNode; wingL: TransformNode; wingR: TransformNode; head: TransformNode } {
  const s = ctx.scene;
  const root = new TransformNode('arara', s);
  root.parent = parent;
  root.scaling.setAll(scale);
  const red = ctx.tm('araraVermelho', [0.9, 0.2, 0.18], 0.5);
  const blue = ctx.tm('araraAzul', [0.16, 0.42, 0.86], 0.5);
  const yellow = ctx.tm('araraAmarelo', [0.99, 0.78, 0.2], 0.5);
  const beak = ctx.tm('araraBico', [0.94, 0.9, 0.82], 0.4);
  const dark = ctx.tm('araraOlho', [0.1, 0.08, 0.1], 0.8);
  const body = MeshBuilder.CreateSphere('arara-corpo', { diameter: 0.5, segments: 10 }, s);
  body.scaling.set(0.8, 0.8, 1.35);
  body.material = red;
  body.parent = root;
  const head = new TransformNode('arara-cabeca', s);
  head.parent = root;
  head.position.set(0, 0.16, 0.34);
  const skull = MeshBuilder.CreateSphere('arara-cranio', { diameter: 0.3, segments: 10 }, s);
  skull.material = red;
  skull.parent = head;
  const face = MeshBuilder.CreateSphere('arara-face', { diameter: 0.2, segments: 8 }, s);
  face.scaling.set(1.1, 0.8, 0.5);
  face.position.set(0, 0, 0.1);
  face.material = beak;
  face.parent = head;
  const bk = MeshBuilder.CreateCylinder('arara-bico', { height: 0.2, diameterTop: 0, diameterBottom: 0.13, tessellation: 8 }, s);
  bk.rotation.x = Math.PI / 2 + 0.6;
  bk.position.set(0, -0.04, 0.2);
  bk.material = dark;
  bk.parent = head;
  for (const side of [-1, 1]) {
    const eye = MeshBuilder.CreateSphere('arara-olho', { diameter: 0.05, segments: 6 }, s);
    eye.position.set(0.09 * side, 0.03, 0.1);
    eye.material = dark;
    eye.parent = head;
  }
  const mk = (side: number) => {
    const w = new TransformNode(`arara-asa-${side}`, s);
    w.parent = root;
    w.position.set(0.18 * side, 0.06, 0);
    const a = MeshBuilder.CreateSphere('asa', { diameter: 0.6, segments: 8 }, s);
    a.scaling.set(1.1, 0.12, 0.55);
    a.position.x = 0.28 * side;
    a.material = blue;
    a.parent = w;
    const b = MeshBuilder.CreateSphere('asa-faixa', { diameter: 0.4, segments: 8 }, s);
    b.scaling.set(0.9, 0.13, 0.45);
    b.position.set(0.12 * side, 0.02, 0.06);
    b.material = yellow;
    b.parent = w;
    return w;
  };
  const wingL = mk(-1);
  const wingR = mk(1);
  const tail = MeshBuilder.CreateBox('arara-cauda', { width: 0.12, height: 0.03, depth: 0.7 }, s);
  tail.position.set(0, -0.02, -0.55);
  tail.rotation.x = -0.25;
  tail.material = blue;
  tail.parent = root;
  const tail2 = MeshBuilder.CreateBox('arara-cauda2', { width: 0.08, height: 0.03, depth: 0.55 }, s);
  tail2.position.set(0, -0.01, -0.5);
  tail2.rotation.x = -0.2;
  tail2.material = red;
  tail2.parent = root;
  return { root, wingL, wingR, head };
}

/**
 * Arara ambiental: voa alto, em volta da arena, e de tempos em tempos pousa num ponto
 * decorativo do muro. Nunca desce abaixo de 9 m no voo (não cruza a mira de perto nem
 * bloqueia caminho). Em qualidade baixa fica pousada, sem animação de voo.
 */
export class AmbientMacaw {
  private bird: ReturnType<typeof buildMacaw>;
  private t = 0;
  private phase: 'voo' | 'descida' | 'pouso' | 'subida' = 'voo';
  private phaseT = 0;
  private readonly center: Vector3;
  private readonly perch: Vector3;
  simplified = false;

  constructor(ctx: PropCtx, parent: TransformNode, center: Vector3, private readonly radius: number, perch: Vector3) {
    this.center = center;
    this.perch = perch;
    this.bird = buildMacaw(ctx, parent, 1.25);
  }

  private flightPos(t: number): Vector3 {
    const a = t * 0.16;
    return new Vector3(this.center.x + Math.cos(a) * this.radius, Math.max(9, this.center.y + Math.sin(t * 0.5) * 1.2), this.center.z + Math.sin(a) * this.radius * 0.8);
  }

  update(dt: number) {
    const b = this.bird;
    if (this.simplified) {
      b.root.position.copyFrom(this.perch);
      b.wingL.rotation.z = b.wingR.rotation.z = 0;
      return;
    }
    this.t += dt;
    this.phaseT += dt;
    let pos: Vector3;
    let flap = 0;
    if (this.phase === 'voo') {
      pos = this.flightPos(this.t);
      flap = Math.sin(this.t * 9) * 0.7;
      if (this.phaseT > 38) this.next('descida');
    } else if (this.phase === 'descida' || this.phase === 'subida') {
      const k = Math.min(1, this.phaseT / 4);
      const e = k * k * (3 - 2 * k);
      const air = this.flightPos(this.t);
      pos = this.phase === 'descida' ? Vector3.Lerp(air, this.perch, e) : Vector3.Lerp(this.perch, air, e);
      flap = Math.sin(this.t * 11) * (this.phase === 'descida' ? 0.9 * (1 - e) : 0.9);
      if (k >= 1) this.next(this.phase === 'descida' ? 'pouso' : 'voo');
    } else {
      pos = this.perch.clone();
      b.head.rotation.y = Math.sin(this.t * 0.7) * 0.6;
      if (this.phaseT > 18) this.next('subida');
    }
    const prev = b.root.position.clone();
    b.root.position.copyFrom(pos);
    const d = pos.subtract(prev);
    if (d.lengthSquared() > 1e-6) b.root.rotation.y = Math.atan2(d.x, d.z);
    b.wingL.rotation.z = flap;
    b.wingR.rotation.z = -flap;
  }

  private next(p: AmbientMacaw['phase']) {
    this.phase = p;
    this.phaseT = 0;
  }
}

/** Mural do Ara sobre a face interna de um muro NÃO pintável (plano rente, sem sugerir cobertura). */
export function buildMural(ctx: PropCtx, node: TransformNode, width: number, variant: number) {
  const s = ctx.scene;
  const W = 2048;
  const H = 512;
  const tex = new DynamicTexture('tex-mural', { width: W, height: H }, s, true);
  const c = tex.getContext() as CanvasRenderingContext2D;
  // céu e morro
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, variant === 0 ? '#7cc8e8' : '#f2b872');
  g.addColorStop(1, variant === 0 ? '#c8ecd8' : '#f6e0a8');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.fillStyle = variant === 0 ? '#5fae6a' : '#6fb56b';
  c.beginPath();
  c.moveTo(0, H);
  for (let x = 0; x <= W; x += 64) c.lineTo(x, H * 0.72 - Math.sin(x / 260) * 50 - Math.sin(x / 90) * 12);
  c.lineTo(W, H);
  c.fill();
  // folhagem grande nas bordas (costela-de-adão estilizada)
  const leaf = (x: number, y: number, r: number, rot: number, col: string) => {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.fillStyle = col;
    c.beginPath();
    c.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.45)';
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(-r, 0);
    c.lineTo(r, 0);
    c.stroke();
    c.restore();
  };
  for (const [x, y, r, rot] of [[90, 420, 150, -0.6], [210, 470, 120, -0.2], [W - 90, 420, 150, 0.6], [W - 230, 470, 120, 0.2]] as const) leaf(x, y, r, rot, '#2f8a55');
  // arara: voando (variante 0) ou pousada no galho (variante 1)
  const bx = W / 2;
  const by = variant === 0 ? 230 : 250;
  c.save();
  c.translate(bx, by);
  if (variant === 0) {
    c.fillStyle = '#2a6fd6';
    c.beginPath();
    c.moveTo(-40, 0);
    c.quadraticCurveTo(-330, -170, -420, 20);
    c.quadraticCurveTo(-250, 10, -40, 60);
    c.fill();
    c.beginPath();
    c.moveTo(40, 0);
    c.quadraticCurveTo(330, -170, 420, 20);
    c.quadraticCurveTo(250, 10, 40, 60);
    c.fill();
    c.fillStyle = '#ffc93a';
    c.beginPath();
    c.moveTo(-40, 20);
    c.quadraticCurveTo(-220, -60, -300, 20);
    c.quadraticCurveTo(-170, 30, -40, 50);
    c.fill();
    c.beginPath();
    c.moveTo(40, 20);
    c.quadraticCurveTo(220, -60, 300, 20);
    c.quadraticCurveTo(170, 30, 40, 50);
    c.fill();
  } else {
    c.strokeStyle = '#6b4a2f';
    c.lineWidth = 26;
    c.beginPath();
    c.moveTo(-500, 170);
    c.quadraticCurveTo(0, 120, 520, 190);
    c.stroke();
    c.fillStyle = '#2a6fd6';
    c.beginPath();
    c.ellipse(40, 40, 70, 150, 0.35, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#e1352b';
  c.beginPath();
  c.ellipse(0, 30, 70, 120, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(-30, 130);
  c.lineTo(0, 300);
  c.lineTo(30, 130);
  c.fill();
  c.beginPath();
  c.arc(0, -90, 62, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#f4efe6';
  c.beginPath();
  c.ellipse(-8, -86, 36, 30, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#2b2020';
  c.beginPath();
  c.moveTo(-40, -100);
  c.quadraticCurveTo(-110, -90, -70, -30);
  c.quadraticCurveTo(-60, -70, -30, -70);
  c.fill();
  c.beginPath();
  c.arc(-2, -96, 9, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // assinatura do lugar
  c.font = '700 64px Fredoka, Trebuchet MS, sans-serif';
  c.textAlign = 'left';
  c.lineWidth = 10;
  c.strokeStyle = '#3a2720';
  c.fillStyle = '#fff4e6';
  const label = variant === 0 ? 'TOCA DO ARA' : 'MUTIRÃO DE CORES';
  c.strokeText(label, 70, 90);
  c.fillText(label, 70, 90);
  tex.update();
  ctx.textures.push(tex);
  const mat = new StandardMaterial('mat-mural', s);
  mat.diffuseTexture = tex;
  mat.emissiveColor = new Color3(0.42, 0.42, 0.42);
  mat.specularColor = new Color3(0, 0, 0);
  ctx.std.push(mat);
  const h = Math.min(3.0, width / 4);
  const plane = MeshBuilder.CreatePlane('mural', { width, height: h }, s);
  plane.material = mat;
  plane.parent = node;
  plane.position.y = 0.95 + h / 2;
}

/** Totem de madeira pintada com a arara no alto (marco do centro; gira devagar). */
export function buildAraTotem(ctx: PropCtx, node: TransformNode): TransformNode {
  const s = ctx.scene;
  const spin = new TransformNode('totem-giro', s);
  spin.parent = node;
  const woods = [ctx.tm('totemA', [0.86, 0.52, 0.3], 0.2), ctx.tm('totemB', [0.36, 0.66, 0.6], 0.2), ctx.tm('totemC', [0.96, 0.8, 0.4], 0.2)];
  for (let i = 0; i < 3; i++) {
    const seg = MeshBuilder.CreateCylinder('totem-seg', { height: 0.62, diameterTop: 1.0 - i * 0.08, diameterBottom: 1.1 - i * 0.08, tessellation: 10 }, s);
    seg.position.y = 0.31 + i * 0.62;
    seg.material = woods[i];
    seg.parent = spin;
    const ring = MeshBuilder.CreateTorus('totem-anel', { diameter: 1.08 - i * 0.08, thickness: 0.07, tessellation: 18 }, s);
    ring.position.y = 0.62 + i * 0.62;
    ring.material = ctx.tm('totemAnel', [0.3, 0.2, 0.16], 0.2);
    ring.parent = spin;
  }
  const bird = buildMacaw(ctx, spin, 2.2);
  bird.root.position.y = 2.2;
  bird.wingL.rotation.z = 0.9;
  bird.wingR.rotation.z = -0.9;
  return spin;
}

export function buildBananeira(ctx: PropCtx, node: TransformNode) {
  const s = ctx.scene;
  const trunk = MeshBuilder.CreateCylinder('bananeira-tronco', { height: 3.2, diameterTop: 0.35, diameterBottom: 0.55, tessellation: 8 }, s);
  trunk.position.y = 1.6;
  trunk.material = ctx.tm('bananeiraTronco', [0.55, 0.62, 0.34], 0.05);
  trunk.parent = node;
  const leafMat = ctx.tm('bananeiraFolha', [0.3, 0.66, 0.3], 0.1);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = MeshBuilder.CreateSphere('bananeira-folha', { diameter: 1, segments: 6 }, s);
    leaf.scaling.set(0.55, 0.06, 2.6);
    leaf.position.set(Math.sin(a) * 1.1, 3.1 + (i % 2) * 0.25, Math.cos(a) * 1.1);
    leaf.rotation.y = a;
    leaf.rotation.x = 0.55;
    leaf.material = leafMat;
    leaf.parent = node;
  }
  const bunch = MeshBuilder.CreateSphere('cacho', { diameter: 0.5, segments: 6 }, s);
  bunch.scaling.set(0.8, 1.2, 0.8);
  bunch.position.set(0.25, 2.7, 0.2);
  bunch.material = ctx.tm('cacho', [0.9, 0.82, 0.3], 0.2);
  bunch.parent = node;
}

export function buildPalmeira(ctx: PropCtx, node: TransformNode) {
  const s = ctx.scene;
  const trunkMat = ctx.tm('palmeiraTronco', [0.66, 0.5, 0.34], 0.05);
  let y = 0;
  let x = 0;
  for (let i = 0; i < 6; i++) {
    const seg = MeshBuilder.CreateCylinder('palmeira-seg', { height: 1.3, diameterTop: 0.34, diameterBottom: 0.42, tessellation: 7 }, s);
    x += 0.12 * i * 0.25;
    seg.position.set(x, y + 0.65, 0);
    seg.rotation.z = -0.05 * i;
    seg.material = trunkMat;
    seg.parent = node;
    y += 1.26;
  }
  const frond = ctx.tm('palmeiraFolha', [0.34, 0.7, 0.36], 0.1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const f = MeshBuilder.CreateSphere('palmeira-folha', { diameter: 1, segments: 6 }, s);
    f.scaling.set(0.4, 0.05, 3.2);
    f.position.set(x + Math.sin(a) * 1.4, y - 0.1, Math.cos(a) * 1.4);
    f.rotation.y = a;
    f.rotation.x = 0.4;
    f.material = frond;
    f.parent = node;
  }
  for (let i = 0; i < 3; i++) {
    const coco = MeshBuilder.CreateSphere('coco', { diameter: 0.3, segments: 6 }, s);
    coco.position.set(x + Math.cos(i * 2.1) * 0.25, y - 0.35, Math.sin(i * 2.1) * 0.25);
    coco.material = ctx.tm('coco', [0.46, 0.36, 0.2], 0.1);
    coco.parent = node;
  }
}

export function buildVasos(ctx: PropCtx, node: TransformNode, variant: number, potProfile: () => Vector3[]) {
  const s = ctx.scene;
  for (let i = 0; i < 3; i++) {
    const pot = MeshBuilder.CreateLathe('vaso', { shape: potProfile(), tessellation: 10 }, s);
    pot.position.set((i - 1) * 1.4, 0, 0);
    pot.scaling.setAll(0.8 + ((i + variant) % 2) * 0.25);
    pot.material = ctx.tm(`vaso${(i + variant) % 3}`, (i + variant) % 3 === 0 ? [0.86, 0.5, 0.32] : (i + variant) % 3 === 1 ? [0.36, 0.62, 0.76] : [0.96, 0.8, 0.52], 0.4);
    pot.parent = node;
    const plant = MeshBuilder.CreateIcoSphere('planta', { radius: 0.55, subdivisions: 1 }, s);
    plant.position.set((i - 1) * 1.4, 1.35, 0);
    plant.scaling.set(1, 0.8, 1);
    plant.material = ctx.tm(i % 2 ? 'plantaA' : 'plantaB', i % 2 ? [0.32, 0.64, 0.34] : [0.44, 0.72, 0.32], 0.05);
    plant.parent = node;
  }
}

/** Placa pendurada acima do telhado da oficina (não cobre faces pintáveis). */
export function buildHangingSign(ctx: PropCtx, node: TransformNode, text: string, h: number) {
  const s = ctx.scene;
  const tex = new DynamicTexture('tex-placa', { width: 512, height: 160 }, s, true);
  const c = tex.getContext() as CanvasRenderingContext2D;
  c.fillStyle = '#2f7f6f';
  c.fillRect(0, 0, 512, 160);
  c.fillStyle = '#fff4e6';
  c.font = '700 84px Fredoka, Trebuchet MS, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 256, 86);
  tex.update();
  ctx.textures.push(tex);
  const m = new StandardMaterial('mat-placa', s);
  m.diffuseTexture = tex;
  m.emissiveColor = new Color3(0.4, 0.4, 0.4);
  m.specularColor = new Color3(0, 0, 0);
  m.backFaceCulling = false;
  ctx.std.push(m);
  const post = MeshBuilder.CreateCylinder('placa-poste', { height: 1.4, diameter: 0.1, tessellation: 6 }, s);
  post.position.set(0, h + 0.7, 0);
  post.material = ctx.tm('ferro', [0.25, 0.23, 0.3], 0.3);
  post.parent = node;
  const board = MeshBuilder.CreatePlane('placa', { width: 1.8, height: 0.56 }, s);
  board.position.set(0, h + 1.2, 0);
  board.rotation.y = Math.PI / 2;
  board.material = m;
  board.parent = node;
}

/** Mastro com a flâmula do clube no canto da torre (fino; não parece plataforma). */
export function buildClubMast(ctx: PropCtx, node: TransformNode) {
  const s = ctx.scene;
  const pole = MeshBuilder.CreateCylinder('mastro', { height: 3.4, diameter: 0.08, tessellation: 6 }, s);
  pole.position.set(1.25, 1.7, 1.25);
  pole.material = ctx.tm('mastro', [0.92, 0.9, 0.86], 0.5);
  pole.parent = node;
  const flag = MeshBuilder.CreateCylinder('flamula', { height: 0.9, diameterTop: 0, diameterBottom: 0.7, tessellation: 3 }, s);
  flag.rotation.z = Math.PI / 2;
  flag.scaling.set(1, 1, 0.08);
  flag.position.set(1.7, 3.1, 1.25);
  flag.material = ctx.tm('flamula', [0.2, 0.7, 0.78], 0.3);
  flag.parent = node;
}

/** Guarda-sol listrado no topo do poste (colisor do poste vem do MapSpec). */
export function buildUmbrella(ctx: PropCtx, node: TransformNode, variant: number) {
  const s = ctx.scene;
  const canopy = MeshBuilder.CreateCylinder('guarda-sol', { height: 0.55, diameterTop: 0.1, diameterBottom: 2.8, tessellation: 12 }, s);
  canopy.position.y = 0.2;
  canopy.material = ctx.tm(variant ? 'guardaSolB' : 'guardaSolA', variant ? [0.98, 0.62, 0.3] : [0.98, 0.42, 0.44], 0.2);
  canopy.parent = node;
  const trim = MeshBuilder.CreateTorus('guarda-sol-borda', { diameter: 2.75, thickness: 0.08, tessellation: 24 }, s);
  trim.position.y = -0.05;
  trim.material = ctx.tm('guardaSolBorda', [0.98, 0.96, 0.9], 0.2);
  trim.parent = node;
}

export function isMesh(x: unknown): x is Mesh {
  return x instanceof Mesh;
}
