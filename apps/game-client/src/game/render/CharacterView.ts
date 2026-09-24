import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, DynamicTexture } from '@babylonjs/core';
import type { TeamId, WeaponId } from '@borrifo/game-contracts';
import { ToonMaterial } from './ToonMaterial';

/** Estado visual por frame (derivado da previsão local ou da interpolação remota). */
export interface CharacterVisual {
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  speed: number;
  vy: number;
  grounded: boolean;
  form: number; // 0 combate, 1 fluxo
  submerged: boolean;
  climbing: boolean;
  climbNormal?: [number, number];
  firing: boolean;
  charging: boolean;
  charge: number;
  dragging: boolean;
  swinging: boolean;
  alive: boolean;
  protected: boolean;
  hp: number;
  ink: number;
  inEnemyInk: boolean;
  travel: number;
}

const GLAZES: Array<[number, number, number]> = [
  [0.98, 0.94, 0.86],
  [0.9, 0.93, 0.97],
  [0.92, 0.96, 0.88],
  [0.99, 0.9, 0.86],
];

let shadowTexture: DynamicTexture | null = null;
function blobShadowTexture(scene: Scene): DynamicTexture {
  if (shadowTexture && shadowTexture.getScene() === scene) return shadowTexture;
  const t = new DynamicTexture('sombra-blob', { width: 64, height: 64 }, scene, false);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 31);
  g.addColorStop(0, 'rgba(40,30,60,0.55)');
  g.addColorStop(0.6, 'rgba(40,30,60,0.35)');
  g.addColorStop(1, 'rgba(40,30,60,0)');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  t.hasAlpha = true;
  t.update();
  shadowTexture = t;
  return t;
}

/**
 * Bibelô: autômato de cerâmica esmaltada e polímero, com cabeça-pote grande,
 * olhos expressivos e reservatório de vidro exagerado. Forma Bibelô (bípede) e
 * Forma Pião (pião mecânico). Modelo procedural low poly, cel shading suave,
 * contorno discreto só nas silhuetas principais. Cosméticos não mudam a hitbox.
 */
export class CharacterView {
  readonly root: TransformNode;
  private combat: TransformNode;
  private flow: TransformNode;
  private upper: TransformNode;
  private head: TransformNode;
  private armL: TransformNode;
  private armR: TransformNode;
  private legL: TransformNode;
  private legR: TransformNode;
  private tool: TransformNode;
  private band: TransformNode | null = null;
  private eyes: TransformNode[] = [];
  private brows: Mesh[] = [];
  private tankLiquid: Mesh;
  private shadow: Mesh;
  private bubble: Mesh;
  private meshes: Mesh[] = [];
  private toon: ToonMaterial[] = [];
  private std: StandardMaterial[] = [];
  private ceramic: ToonMaterial;
  private teamMat: ToonMaterial;
  private coreMat: ToonMaterial;
  private inkMat: ToonMaterial;
  private phase = 0;
  private formBlend = 0;
  private spin = 0;
  private squash = 0;
  private wasGrounded = true;
  private blinkTimer = 2;
  private flashTimer = 0;
  private wobble = 0;
  private lastHp = 100;
  private visibleFactor = 1;
  private recoil = 0;
  private marker: Mesh | null = null;
  private outlined: Mesh[] = [];

  constructor(
    private readonly scene: Scene,
    readonly playerId: number,
    readonly team: TeamId,
    readonly weaponId: WeaponId,
    teamColor: Color3,
    readonly isLocal: boolean,
    readonly isEnemy: boolean,
  ) {
    this.root = new TransformNode(`bibelo-${playerId}`, scene);
    const glaze = GLAZES[playerId % GLAZES.length];
    this.ceramic = this.tm('ceramica', new Color3(...glaze), 0.8);
    const polymer = this.tm('polimero', new Color3(0.2, 0.19, 0.24), 0.25);
    this.teamMat = this.tm('equipe', teamColor, 0.7);
    this.coreMat = this.tm('miolo', teamColor, 0.9);
    this.coreMat.setEmissive(teamColor.scale(0.35));
    this.inkMat = this.tm('tinta', teamColor, 1.0);
    this.inkMat.setEmissive(teamColor.scale(0.15));
    const dark = this.tm('pupila', new Color3(0.08, 0.06, 0.1), 0.9);
    const white = this.tm('esclera', new Color3(1, 1, 1), 0.3);
    const glass = this.tm('vidro', new Color3(0.82, 0.95, 1.0), 1.0);
    glass.alpha = 0.38;
    const brass = this.tm('latao', new Color3(0.95, 0.72, 0.28), 0.9);
    const wood = this.tm('madeira', new Color3(0.72, 0.5, 0.32), 0.2);

    // ---------------- Forma Bibelô ----------------
    this.combat = new TransformNode('combate', scene);
    this.combat.parent = this.root;
    const mkLeg = (side: number) => {
      const hip = new TransformNode('quadril', scene);
      hip.parent = this.combat;
      hip.position.set(0.15 * side, 0.42, 0);
      const leg = MeshBuilder.CreateCapsule('perna', { radius: 0.075, height: 0.36, tessellation: 8, subdivisions: 1 }, scene);
      leg.position.y = -0.17;
      leg.material = polymer;
      leg.parent = hip;
      // botas redondas e grandes (proporção cômica)
      const foot = MeshBuilder.CreateSphere('pe', { diameter: 0.3, segments: 8 }, scene);
      foot.scaling.set(0.9, 0.55, 1.4);
      foot.position.set(0, -0.36, 0.05);
      foot.material = this.teamMat;
      foot.parent = hip;
      this.meshes.push(leg, foot);
      return hip;
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);
    this.upper = new TransformNode('tronco', scene);
    this.upper.parent = this.combat;
    this.upper.position.y = 0.42;
    const body = MeshBuilder.CreateLathe('corpo', { shape: jarProfile(), tessellation: 16 }, scene);
    body.material = this.ceramic;
    body.parent = this.upper;
    const belt = MeshBuilder.CreateTorus('faixa', { diameter: 0.64, thickness: 0.08, tessellation: 20 }, scene);
    belt.position.y = 0.26;
    belt.scaling.y = 0.75;
    belt.material = this.teamMat;
    belt.parent = this.upper;
    const core = MeshBuilder.CreateSphere('miolo', { diameter: 0.16, segments: 8 }, scene);
    core.position.set(0, 0.36, 0.28);
    core.scaling.z = 0.5;
    core.material = this.coreMat;
    core.parent = this.upper;
    // reservatório exagerado nas costas: jarra de vidro com nível visível
    const tankRoot = new TransformNode('mochila', scene);
    tankRoot.parent = this.upper;
    tankRoot.position.set(0, 0.34, -0.36);
    tankRoot.rotation.x = 0.12;
    const tank = MeshBuilder.CreateCapsule('tanque', { radius: 0.17, height: 0.58, tessellation: 12 }, scene);
    tank.material = glass;
    tank.parent = tankRoot;
    this.tankLiquid = MeshBuilder.CreateCapsule('tinta', { radius: 0.145, height: 0.5, tessellation: 12 }, scene);
    this.tankLiquid.setPivotPoint(new Vector3(0, -0.25, 0));
    this.tankLiquid.material = this.inkMat;
    this.tankLiquid.parent = tankRoot;
    const cap = MeshBuilder.CreateCylinder('tampa-tanque', { height: 0.07, diameter: 0.24, tessellation: 12 }, scene);
    cap.position.y = 0.3;
    cap.material = brass;
    cap.parent = tankRoot;
    const strap = MeshBuilder.CreateTorus('alca', { diameter: 0.42, thickness: 0.035, tessellation: 16 }, scene);
    strap.rotation.x = Math.PI / 2;
    strap.position.set(0, 0.04, 0.2);
    strap.material = polymer;
    strap.parent = tankRoot;
    // cabeça-pote grande, com tampa (variação cosmética)
    this.head = new TransformNode('cabeca', scene);
    this.head.parent = this.upper;
    this.head.position.y = 0.62;
    this.head.scaling.setAll(1.25);
    const skull = MeshBuilder.CreateLathe('pote', { shape: headProfile(), tessellation: 16 }, scene);
    skull.material = this.ceramic;
    skull.parent = this.head;
    const lid = this.makeLid(scene, playerId % 4);
    lid.material = this.teamMat;
    lid.parent = this.head;
    for (const side of [-1, 1]) {
      const eye = new TransformNode('olho', scene);
      eye.parent = this.head;
      eye.position.set(0.085 * side, 0.15, 0.2);
      const sclera = MeshBuilder.CreateSphere('esclera', { diameter: 0.11, segments: 8 }, scene);
      sclera.scaling.set(0.85, 1.15, 0.45);
      sclera.material = white;
      sclera.parent = eye;
      const pupil = MeshBuilder.CreateSphere('pupila', { diameter: 0.06, segments: 6 }, scene);
      pupil.scaling.set(0.9, 1.2, 0.4);
      pupil.position.set(0.004 * side, -0.005, 0.03);
      pupil.material = dark;
      pupil.parent = eye;
      this.eyes.push(eye);
      const brow = MeshBuilder.CreateBox('sobrancelha', { width: 0.085, height: 0.018, depth: 0.02 }, scene);
      brow.position.set(0.085 * side, 0.245, 0.215);
      brow.rotation.z = -0.22 * side;
      brow.material = dark;
      brow.parent = this.head;
      this.brows.push(brow);
      this.meshes.push(sclera, pupil, brow);
    }
    const mkArm = (side: number) => {
      const sh = new TransformNode('ombro', scene);
      sh.parent = this.upper;
      sh.position.set(0.31 * side, 0.48, 0.02);
      const arm = MeshBuilder.CreateCapsule('braco', { radius: 0.055, height: 0.34, tessellation: 8 }, scene);
      arm.position.y = -0.15;
      arm.material = polymer;
      arm.parent = sh;
      const hand = MeshBuilder.CreateSphere('mao', { diameter: 0.15, segments: 8 }, scene);
      hand.position.y = -0.33;
      hand.material = this.ceramic;
      hand.parent = sh;
      this.meshes.push(arm, hand);
      return sh;
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    this.tool = this.makeTool(scene, weaponId, brass, glass, polymer, wood);
    this.tool.parent = this.upper;
    this.meshes.push(body, belt, core, tank, this.tankLiquid, cap, strap, skull, lid);

    // ---------------- Forma Pião ----------------
    this.flow = new TransformNode('piao', scene);
    this.flow.parent = this.root;
    const top = MeshBuilder.CreateLathe('piao', { shape: topProfile(), tessellation: 18 }, scene);
    top.material = this.ceramic;
    top.parent = this.flow;
    const stripe = MeshBuilder.CreateTorus('listra', { diameter: 0.8, thickness: 0.09, tessellation: 22 }, scene);
    stripe.position.y = 0.36;
    stripe.material = this.teamMat;
    stripe.parent = this.flow;
    const knob = MeshBuilder.CreateSphere('pino', { diameter: 0.16, segments: 8 }, scene);
    knob.position.y = 0.62;
    knob.material = this.coreMat;
    knob.parent = this.flow;
    const fins: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const fin = MeshBuilder.CreateBox('aleta', { width: 0.06, height: 0.13, depth: 0.24 }, scene);
      fin.position.set(Math.cos((i * Math.PI * 2) / 3) * 0.36, 0.44, Math.sin((i * Math.PI * 2) / 3) * 0.36);
      fin.rotation.y = (-i * Math.PI * 2) / 3;
      fin.material = polymer;
      fin.parent = this.flow;
      fins.push(fin);
    }
    this.meshes.push(top, stripe, knob, ...fins);
    this.flow.scaling.setAll(0.001);

    // contorno discreto: só nas silhuetas principais
    const outlineColor = teamColor.scale(0.25).add(new Color3(0.05, 0.03, 0.08));
    for (const m of [body, skull, tank, top]) {
      m.renderOutline = true;
      m.outlineWidth = 0.014;
      m.outlineColor = outlineColor;
      this.outlined.push(m);
    }

    // sombra de contato suave (gradiente radial)
    this.shadow = MeshBuilder.CreateGround('sombra', { width: 1.0, height: 1.0 }, scene);
    const sm = new StandardMaterial(`sombra-${playerId}`, scene);
    sm.diffuseTexture = blobShadowTexture(scene);
    sm.useAlphaFromDiffuseTexture = true;
    sm.disableLighting = true;
    sm.emissiveColor = new Color3(1, 1, 1);
    sm.zOffset = -2;
    this.std.push(sm);
    this.shadow.material = sm;
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.03;
    this.shadow.isPickable = false;

    // bolha de proteção de reaparecimento
    this.bubble = MeshBuilder.CreateSphere('protecao', { diameter: 2, segments: 12 }, scene);
    const bm = this.tm('bolha', teamColor.scale(0.6).add(new Color3(0.4, 0.4, 0.4)), 1);
    bm.alpha = 0.18;
    bm.setEmissive(teamColor.scale(0.3));
    bm.backFaceCulling = false;
    this.bubble.material = bm;
    this.bubble.parent = this.root;
    this.bubble.position.y = 0.8;
    this.bubble.scaling.set(0.64, 0.92, 0.64);
    this.bubble.setEnabled(false);

    // marcador de aliado (seta sobre a cabeça)
    if (!isLocal && !isEnemy) {
      this.marker = MeshBuilder.CreateCylinder('marcador', { diameterTop: 0.26, diameterBottom: 0, height: 0.24, tessellation: 3 }, scene);
      const mm = new StandardMaterial(`marcador-${playerId}`, scene);
      mm.emissiveColor = teamColor;
      mm.disableLighting = true;
      this.std.push(mm);
      this.marker.material = mm;
      this.marker.parent = this.root;
      this.marker.position.y = 2.25;
      this.meshes.push(this.marker);
    }
    for (const m of this.root.getChildMeshes()) m.isPickable = false;
  }

  private tm(name: string, color: Color3, gloss: number): ToonMaterial {
    const m = new ToonMaterial(`${name}-${this.playerId}`, this.scene, color, gloss);
    this.toon.push(m);
    return m;
  }

  private makeLid(scene: Scene, variant: number): Mesh {
    if (variant === 0) {
      const l = MeshBuilder.CreateCylinder('tampa', { height: 0.06, diameter: 0.38, tessellation: 16 }, scene);
      l.position.y = 0.31;
      const k = MeshBuilder.CreateSphere('pegador', { diameter: 0.1, segments: 6 }, scene);
      k.position.y = 0.06;
      k.parent = l;
      k.material = this.teamMat;
      this.meshes.push(k);
      return l;
    }
    if (variant === 1) {
      const l = MeshBuilder.CreateSphere('tampa', { diameter: 0.38, segments: 8, slice: 0.5 }, scene);
      l.position.y = 0.29;
      l.scaling.y = 0.7;
      return l;
    }
    if (variant === 2) {
      const l = MeshBuilder.CreateCylinder('tampa', { height: 0.2, diameterTop: 0.1, diameterBottom: 0.38, tessellation: 16 }, scene);
      l.position.y = 0.38;
      return l;
    }
    const l = MeshBuilder.CreateTorus('tampa', { diameter: 0.33, thickness: 0.07, tessellation: 16 }, scene);
    l.position.y = 0.31;
    return l;
  }

  private makeTool(scene: Scene, weapon: WeaponId, brass: ToonMaterial, glass: ToonMaterial, polymer: ToonMaterial, wood: ToonMaterial): TransformNode {
    const t = new TransformNode('ferramenta', scene);
    t.position.set(0.24, 0.32, 0.28);
    const outline = (m: Mesh) => {
      m.renderOutline = true;
      m.outlineWidth = 0.012;
      m.outlineColor = new Color3(0.12, 0.08, 0.1);
      this.outlined.push(m);
    };
    if (weapon === 'esguicho') {
      // bomba de jardim: reservatório bojudo exagerado + bico longo curvado
      const tank = MeshBuilder.CreateSphere('reservatorio', { diameter: 0.3, segments: 10 }, scene);
      tank.scaling.set(1, 1, 1.25);
      tank.material = glass;
      tank.parent = t;
      const liquid = MeshBuilder.CreateSphere('liquido', { diameter: 0.25, segments: 8 }, scene);
      liquid.scaling.set(1, 0.8, 1.2);
      liquid.position.y = -0.02;
      liquid.material = this.inkMat;
      liquid.parent = t;
      const nozzle = MeshBuilder.CreateCylinder('bico', { height: 0.46, diameterTop: 0.04, diameterBottom: 0.08, tessellation: 8 }, scene);
      nozzle.rotation.x = Math.PI / 2 - 0.12;
      nozzle.position.set(0, 0.04, 0.36);
      nozzle.material = brass;
      nozzle.parent = t;
      const tip = MeshBuilder.CreateCylinder('ponteira', { height: 0.07, diameterTop: 0.11, diameterBottom: 0.06, tessellation: 10 }, scene);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(0, 0.07, 0.6);
      tip.material = this.teamMat;
      tip.parent = t;
      const pump = MeshBuilder.CreateCylinder('bomba', { height: 0.2, diameter: 0.05, tessellation: 8 }, scene);
      pump.position.set(0, 0.2, -0.05);
      pump.material = brass;
      pump.parent = t;
      const knob = MeshBuilder.CreateSphere('pomo', { diameter: 0.09, segments: 6 }, scene);
      knob.position.set(0, 0.31, -0.05);
      knob.material = this.teamMat;
      knob.parent = t;
      outline(tank);
      this.meshes.push(tank, liquid, nozzle, tip, pump, knob);
    } else if (weapon === 'rodo') {
      // rodo de quintal enorme: cabo de madeira e lâmina de borracha colorida
      t.position.set(0, 0.02, 0.32);
      const handle = MeshBuilder.CreateCylinder('cabo', { height: 1.15, diameter: 0.06, tessellation: 8 }, scene);
      handle.rotation.x = Math.PI / 2 - 0.95;
      handle.position.set(0, -0.14, 0.26);
      handle.material = wood;
      handle.parent = t;
      const blade = MeshBuilder.CreateBox('lamina', { width: 2.1, height: 0.18, depth: 0.12 }, scene);
      blade.position.set(0, -0.5, 0.64);
      blade.material = wood;
      blade.parent = t;
      const rubber = MeshBuilder.CreateBox('borracha', { width: 2.14, height: 0.09, depth: 0.14 }, scene);
      rubber.position.set(0, -0.62, 0.66);
      rubber.material = this.teamMat;
      rubber.parent = t;
      for (const side of [-1, 1]) {
        const cap = MeshBuilder.CreateSphere('ponta', { diameter: 0.2, segments: 6 }, scene);
        cap.position.set(1.07 * side, -0.55, 0.64);
        cap.material = this.teamMat;
        cap.parent = t;
        this.meshes.push(cap);
      }
      outline(blade);
      this.meshes.push(handle, blade, rubber);
    } else {
      // estilingue de forquilha gigante com elástico grosso
      const grip = MeshBuilder.CreateCylinder('empunhadura', { height: 0.24, diameter: 0.07, tessellation: 8 }, scene);
      grip.material = wood;
      grip.parent = t;
      for (const side of [-1, 1]) {
        const prong = MeshBuilder.CreateCylinder('forquilha', { height: 0.28, diameter: 0.06, tessellation: 8 }, scene);
        prong.position.set(0.085 * side, 0.22, 0);
        prong.rotation.z = -0.5 * side;
        prong.material = wood;
        prong.parent = t;
        const tipb = MeshBuilder.CreateSphere('ponta', { diameter: 0.08, segments: 6 }, scene);
        tipb.position.set(0.16 * side, 0.34, 0);
        tipb.material = brass;
        tipb.parent = t;
        outline(prong);
        this.meshes.push(prong, tipb);
      }
      this.band = new TransformNode('elastico', scene);
      this.band.parent = t;
      this.band.position.set(0, 0.34, 0);
      const pouch = MeshBuilder.CreateSphere('pedra', { diameter: 0.12, segments: 8 }, scene);
      pouch.position.z = -0.14;
      pouch.material = this.inkMat;
      pouch.parent = this.band;
      for (const side of [-1, 1]) {
        const strap = MeshBuilder.CreateCylinder('tira', { height: 0.2, diameter: 0.035, tessellation: 6 }, scene);
        strap.rotation.x = Math.PI / 2;
        strap.rotation.y = 0.62 * side;
        strap.position.set(0.075 * side, 0, -0.07);
        strap.material = this.teamMat;
        strap.parent = this.band;
        this.meshes.push(strap);
      }
      this.meshes.push(grip, pouch);
    }
    return t;
  }

  setTeamColor(c: Color3) {
    this.teamMat.color = c;
    this.coreMat.color = c;
    this.coreMat.setEmissive(c.scale(0.35));
    this.inkMat.color = c;
    this.inkMat.setEmissive(c.scale(0.15));
  }

  /** 0–1: esmaece o personagem colado na câmera para não tapar a mira. */
  nearFade = 1;
  /** Eventos de pé do último update (para o som): passo no apoio e aterrissagem (s no ar). */
  readonly foot = { step: false, landed: 0 };
  private stepSign = 0;
  private airTime = 0;

  /** Reação a dano (pequeno tranco e lampejo claro). */
  hitReaction() {
    this.flashTimer = 0.12;
    this.wobble = 1;
  }

  update(dt: number, v: CharacterVisual, groundY: number | null, sunVis = 1) {
    this.root.setEnabled(v.alive);
    if (!v.alive) {
      this.lastHp = 100;
      return;
    }
    this.root.position.set(v.pos[0], v.pos[1], v.pos[2]);
    this.root.rotation.y = v.yaw;
    for (const m of this.toon) m.setSunVisibility(sunVis);
    // forma: mistura com leve exagero (transição legível)
    const target = v.form === 1 ? 1 : 0;
    this.formBlend += (target - this.formBlend) * Math.min(1, dt * 14);
    const b = this.formBlend;
    const cs = Math.max(0.001, 1 - b);
    const fs = Math.max(0.001, b * (1 + Math.sin(b * Math.PI) * 0.28));
    this.combat.scaling.set(cs, cs, cs);
    this.flow.scaling.set(fs, fs, fs);
    this.spin += dt * (6 + v.speed * 3.5);
    this.flow.rotation.y = this.spin;
    const sub = v.submerged ? 1 : 0;
    this.flow.position.y = -0.36 * sub;
    this.flow.rotation.x = v.climbing ? -1.35 : Math.sin(this.spin * 0.5) * 0.06 * Math.min(1, v.speed / 4);
    this.flow.position.z = v.climbing ? -0.1 : 0;

    // exposição reduzida imerso (não é invisibilidade absoluta)
    let vis = 1;
    if (v.submerged) vis = this.isEnemy ? (v.speed > 1.5 ? 0.14 : 0.05) : 0.45;
    if (v.inEnemyInk) vis = 1;
    vis = Math.min(vis, this.nearFade);
    this.visibleFactor += (vis - this.visibleFactor) * Math.min(1, dt * 10);
    const translucent = this.visibleFactor < 0.98;
    for (const m of this.meshes) m.visibility = this.visibleFactor;
    for (const m of this.outlined) m.renderOutline = !translucent;

    // locomoção expressiva: passos largos, balanço e inclinação
    const walk = v.grounded && !v.climbing ? Math.min(1, v.speed / 5.5) : 0;
    this.phase += dt * (4 + v.speed * 2.0);
    // som de passo quando o pé apoia (troca de sinal do balanço), só andando na forma de combate
    const sign = Math.sin(this.phase) >= 0 ? 1 : -1;
    this.foot.step = sign !== this.stepSign && walk > 0.3 && v.form === 0 && !v.submerged;
    this.stepSign = sign;
    this.foot.landed = !this.wasGrounded && v.grounded && !v.climbing ? this.airTime : 0;
    this.airTime = v.grounded ? 0 : this.airTime + dt;
    const swing = Math.sin(this.phase) * 0.85 * walk;
    this.legL.rotation.x = v.grounded ? swing : -0.7;
    this.legR.rotation.x = v.grounded ? -swing : 0.35;
    const bob = Math.abs(Math.sin(this.phase)) * 0.06 * walk;
    this.upper.position.y = 0.42 + bob;
    this.upper.rotation.z = Math.sin(this.phase) * 0.06 * walk;
    if (!this.wasGrounded && v.grounded) this.squash = 0.18;
    this.wasGrounded = v.grounded;
    this.squash = Math.max(0, this.squash - dt);
    const sq = this.squash > 0 ? Math.sin((this.squash / 0.18) * Math.PI) * 0.16 : 0;
    const stretch = !v.grounded ? Math.min(0.1, Math.abs(v.vy) * 0.012) : 0;
    this.wobble = Math.max(0, this.wobble - dt * 5);
    const wob = Math.sin(performance.now() * 0.045) * 0.06 * this.wobble;
    this.combat.scaling.y *= 1 - sq + stretch;
    this.combat.scaling.x *= 1 + sq * 0.6 + wob;
    this.combat.scaling.z *= 1 + sq * 0.6 - wob;

    // mira: tronco e cabeça acompanham; recuo curto ao disparar
    if (v.firing) this.recoil = Math.min(1, this.recoil + dt * 20);
    else this.recoil = Math.max(0, this.recoil - dt * 8);
    const aim = -v.pitch * 0.55;
    this.upper.rotation.x = v.charging ? aim - 0.18 : aim + walk * 0.12 - this.recoil * 0.05;
    this.head.rotation.x = -v.pitch * 0.35 + (v.charging ? 0.1 : 0);
    const armAim = -1.35 - v.pitch * 0.6;
    if (this.weaponId === 'rodo') {
      const low = v.dragging ? -0.7 : v.swinging ? -2.5 : -0.9;
      this.armR.rotation.x = low;
      this.armL.rotation.x = low;
      this.tool.rotation.x = v.swinging ? -1.0 : v.dragging ? 0.18 + Math.sin(this.phase * 2) * 0.03 : 0;
    } else {
      this.armR.rotation.x = armAim + (v.firing ? Math.sin(this.phase * 9) * 0.05 : 0);
      this.armL.rotation.x = armAim + 0.1 + (v.charging ? 0.3 : 0);
      this.armL.rotation.z = 0.35;
      this.tool.position.z = 0.28 - this.recoil * 0.06;
    }
    if (this.band) this.band.scaling.z = 1 + (v.charging ? v.charge * 2.6 : 0);
    this.tankLiquid.scaling.y = Math.max(0.03, v.ink / 100);

    // olhos: piscar e expressão (sobrancelhas franzem ao disparar/carregar)
    this.blinkTimer -= dt;
    const blink = this.blinkTimer < 0.1 ? 0.12 : 1;
    if (this.blinkTimer < 0) this.blinkTimer = 2.5 + ((this.playerId * 7919) % 17) / 5;
    for (const e of this.eyes) e.scaling.y = blink;
    const frown = v.firing || v.charging ? 0.45 : 0;
    this.brows.forEach((br, i) => {
      const side = i === 0 ? -1 : 1;
      br.rotation.z = (-0.22 + frown) * side;
      br.position.y = 0.245 - frown * 0.02;
    });
    if (v.hp < this.lastHp - 0.5) this.hitReaction();
    this.lastHp = v.hp;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    const f = Math.min(0.65, this.flashTimer * 6);
    this.ceramic.setFlash(f);
    this.teamMat.setFlash(f * 0.6);

    this.bubble.setEnabled(v.protected);
    if (v.protected) (this.bubble.material as ToonMaterial).alpha = 0.14 + Math.sin(performance.now() * 0.008) * 0.05;
    if (this.marker) this.marker.rotation.y += dt * 2;

    if (groundY !== null) {
      const h = v.pos[1] - groundY;
      this.shadow.setEnabled(h < 6 && !v.climbing && !v.submerged);
      this.shadow.position.y = groundY - v.pos[1] + 0.03;
      const s = Math.max(0.35, 1 - h * 0.12) * (v.form === 1 ? 0.9 : 1.1);
      this.shadow.scaling.set(s, 1, s);
    } else this.shadow.setEnabled(false);
  }

  muzzleWorld(): Vector3 {
    return this.tool.getAbsolutePosition().add(this.root.forward.scale(0.35));
  }

  dispose() {
    this.root.dispose(false, true);
    for (const m of this.toon) m.dispose();
    for (const m of this.std) m.dispose();
  }
}

function jarProfile(): Vector3[] {
  return [
    new Vector3(0, 0, 0),
    new Vector3(0.18, 0.0, 0),
    new Vector3(0.29, 0.07, 0),
    new Vector3(0.33, 0.22, 0),
    new Vector3(0.31, 0.4, 0),
    new Vector3(0.21, 0.54, 0),
    new Vector3(0.14, 0.6, 0),
    new Vector3(0.16, 0.64, 0),
    new Vector3(0, 0.64, 0),
  ];
}

function headProfile(): Vector3[] {
  return [
    new Vector3(0, 0, 0),
    new Vector3(0.11, 0.0, 0),
    new Vector3(0.21, 0.06, 0),
    new Vector3(0.25, 0.16, 0),
    new Vector3(0.23, 0.27, 0),
    new Vector3(0.19, 0.31, 0),
    new Vector3(0, 0.31, 0),
  ];
}

function topProfile(): Vector3[] {
  return [
    new Vector3(0, 0.0, 0),
    new Vector3(0.05, 0.02, 0),
    new Vector3(0.2, 0.17, 0),
    new Vector3(0.4, 0.34, 0),
    new Vector3(0.42, 0.4, 0),
    new Vector3(0.32, 0.5, 0),
    new Vector3(0.13, 0.56, 0),
    new Vector3(0, 0.57, 0),
  ];
}
