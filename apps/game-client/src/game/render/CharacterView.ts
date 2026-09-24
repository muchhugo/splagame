import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { TeamId, WeaponId } from '@borrifo/game-contracts';

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
  [0.96, 0.93, 0.86],
  [0.86, 0.9, 0.93],
  [0.88, 0.93, 0.86],
  [0.97, 0.9, 0.84],
];

/**
 * Bibelô: autômato de cerâmica esmaltada e polímero. Forma Bibelô (bípede) e
 * Forma Pião (pião mecânico). Modelo 100% procedural, animação procedural.
 * Cosméticos (tampa, esmalte) nunca alteram a hitbox, que é do servidor.
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
  private eyes: Mesh[] = [];
  private tankLiquid: Mesh;
  private shadow: Mesh;
  private bubble: Mesh;
  private meshes: Mesh[] = [];
  private mats: StandardMaterial[] = [];
  private ceramic: StandardMaterial;
  private teamMat: StandardMaterial;
  private coreMat: StandardMaterial;
  private phase = 0;
  private formBlend = 0;
  private spin = 0;
  private squash = 0;
  private wasGrounded = true;
  private blinkTimer = 2;
  private flashTimer = 0;
  private lastHp = 100;
  private visibleFactor = 1;
  private marker: Mesh | null = null;

  constructor(
    scene: Scene,
    readonly playerId: number,
    readonly team: TeamId,
    readonly weaponId: WeaponId,
    teamColor: Color3,
    readonly isLocal: boolean,
    readonly isEnemy: boolean,
  ) {
    this.root = new TransformNode(`bibelo-${playerId}`, scene);
    const glaze = GLAZES[playerId % GLAZES.length];
    this.ceramic = this.mat(scene, 'ceramica', new Color3(...glaze), 0.55, 48);
    const polymer = this.mat(scene, 'polimero', new Color3(0.16, 0.15, 0.17), 0.25, 16);
    this.teamMat = this.mat(scene, 'equipe', teamColor, 0.6, 64);
    this.coreMat = this.mat(scene, 'miolo', teamColor, 0.4, 32);
    this.coreMat.emissiveColor = teamColor.scale(0.6);
    const dark = this.mat(scene, 'olho', new Color3(0.06, 0.05, 0.06), 0.8, 64);
    const glass = this.mat(scene, 'vidro', new Color3(0.8, 0.9, 0.95), 0.9, 96);
    glass.alpha = 0.35;
    const brass = this.mat(scene, 'latao', new Color3(0.82, 0.64, 0.28), 0.9, 64);

    // ---------------- Forma Bibelô ----------------
    this.combat = new TransformNode('combate', scene);
    this.combat.parent = this.root;
    // pernas
    const mkLeg = (side: number) => {
      const hip = new TransformNode('quadril', scene);
      hip.parent = this.combat;
      hip.position.set(0.14 * side, 0.46, 0);
      const leg = MeshBuilder.CreateCapsule('perna', { radius: 0.07, height: 0.42, tessellation: 8 }, scene);
      leg.position.y = -0.2;
      leg.material = polymer;
      leg.parent = hip;
      const foot = MeshBuilder.CreateSphere('pe', { diameter: 0.24, segments: 8 }, scene);
      foot.scaling.set(0.9, 0.55, 1.35);
      foot.position.set(0, -0.4, 0.04);
      foot.material = this.ceramic;
      foot.parent = hip;
      this.meshes.push(leg, foot);
      return hip;
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);
    // corpo-jarro
    this.upper = new TransformNode('tronco', scene);
    this.upper.parent = this.combat;
    this.upper.position.y = 0.46;
    const body = MeshBuilder.CreateLathe('corpo', { shape: jarProfile(), tessellation: 18 }, scene);
    body.material = this.ceramic;
    body.parent = this.upper;
    const beltBand = MeshBuilder.CreateTorus('faixa', { diameter: 0.62, thickness: 0.07, tessellation: 22 }, scene);
    beltBand.position.y = 0.28;
    beltBand.scaling.y = 0.8;
    beltBand.material = this.teamMat;
    beltBand.parent = this.upper;
    const core = MeshBuilder.CreateSphere('miolo', { diameter: 0.17, segments: 10 }, scene);
    core.position.set(0, 0.34, 0.27);
    core.material = this.coreMat;
    core.parent = this.upper;
    // reservatório nas costas (nível de pigmento visível)
    const tank = MeshBuilder.CreateCylinder('tanque', { height: 0.36, diameter: 0.2, tessellation: 12 }, scene);
    tank.position.set(0, 0.36, -0.3);
    tank.material = glass;
    tank.parent = this.upper;
    this.tankLiquid = MeshBuilder.CreateCylinder('tinta', { height: 0.34, diameter: 0.17, tessellation: 12 }, scene);
    this.tankLiquid.setPivotPoint(new Vector3(0, -0.17, 0));
    this.tankLiquid.position.set(0, 0.36, -0.3);
    this.tankLiquid.material = this.coreMat;
    this.tankLiquid.parent = this.upper;
    // cabeça-pote com tampa (variação cosmética)
    this.head = new TransformNode('cabeca', scene);
    this.head.parent = this.upper;
    this.head.position.y = 0.68;
    const skull = MeshBuilder.CreateLathe('pote', { shape: headProfile(), tessellation: 18 }, scene);
    skull.material = this.ceramic;
    skull.parent = this.head;
    const lid = this.makeLid(scene, playerId % 4);
    lid.material = this.teamMat;
    lid.parent = this.head;
    for (const side of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere('olho', { diameter: 0.075, segments: 8 }, scene);
      eye.scaling.set(0.8, 1.25, 0.5);
      eye.position.set(0.075 * side, 0.15, 0.2);
      eye.material = dark;
      eye.parent = this.head;
      this.eyes.push(eye);
      const brow = MeshBuilder.CreateBox('sobrancelha', { width: 0.07, height: 0.015, depth: 0.02 }, scene);
      brow.position.set(0.075 * side, 0.225, 0.205);
      brow.rotation.z = -0.25 * side;
      brow.material = dark;
      brow.parent = this.head;
      this.meshes.push(eye, brow);
    }
    // braços
    const mkArm = (side: number) => {
      const sh = new TransformNode('ombro', scene);
      sh.parent = this.upper;
      sh.position.set(0.3 * side, 0.5, 0.02);
      const arm = MeshBuilder.CreateCapsule('braco', { radius: 0.05, height: 0.36, tessellation: 8 }, scene);
      arm.position.y = -0.16;
      arm.material = polymer;
      arm.parent = sh;
      const hand = MeshBuilder.CreateSphere('mao', { diameter: 0.12, segments: 8 }, scene);
      hand.position.y = -0.34;
      hand.material = this.ceramic;
      hand.parent = sh;
      this.meshes.push(arm, hand);
      return sh;
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    this.tool = this.makeTool(scene, weaponId, brass, glass, polymer);
    this.tool.parent = this.upper;
    this.meshes.push(body, beltBand, core, tank, this.tankLiquid, skull, lid);

    // ---------------- Forma Pião ----------------
    this.flow = new TransformNode('piao', scene);
    this.flow.parent = this.root;
    const top = MeshBuilder.CreateLathe('piao', { shape: topProfile(), tessellation: 20 }, scene);
    top.material = this.ceramic;
    top.parent = this.flow;
    const stripe = MeshBuilder.CreateTorus('listra', { diameter: 0.74, thickness: 0.06, tessellation: 24 }, scene);
    stripe.position.y = 0.36;
    stripe.material = this.teamMat;
    stripe.parent = this.flow;
    const knob = MeshBuilder.CreateSphere('pino', { diameter: 0.14, segments: 8 }, scene);
    knob.position.y = 0.62;
    knob.material = this.coreMat;
    knob.parent = this.flow;
    const fins: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const fin = MeshBuilder.CreateBox('aleta', { width: 0.05, height: 0.12, depth: 0.2 }, scene);
      fin.position.set(Math.cos((i * Math.PI * 2) / 3) * 0.34, 0.42, Math.sin((i * Math.PI * 2) / 3) * 0.34);
      fin.rotation.y = (-i * Math.PI * 2) / 3;
      fin.material = polymer;
      fin.parent = this.flow;
      fins.push(fin);
    }
    this.meshes.push(top, stripe, knob, ...fins);
    this.flow.scaling.setAll(0.001);

    // sombra-bolha
    this.shadow = MeshBuilder.CreateDisc('sombra', { radius: 0.42, tessellation: 18 }, scene);
    this.shadow.rotation.x = Math.PI / 2;
    const sm = this.mat(scene, 'sombra', new Color3(0, 0, 0), 0, 1);
    sm.alpha = 0.32;
    sm.disableLighting = true;
    this.shadow.material = sm;
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.03;
    this.shadow.isPickable = false;

    // bolha de proteção de reaparecimento
    this.bubble = MeshBuilder.CreateSphere('protecao', { diameter: 2, segments: 14 }, scene);
    const bm = this.mat(scene, 'bolha', teamColor, 0.9, 64);
    bm.alpha = 0.16;
    bm.emissiveColor = teamColor.scale(0.35);
    bm.backFaceCulling = false;
    this.bubble.material = bm;
    this.bubble.parent = this.root;
    this.bubble.position.y = 0.8;
    this.bubble.scaling.set(0.62, 0.9, 0.62);
    this.bubble.setEnabled(false);

    // marcador de aliado (triângulo sobre a cabeça)
    if (!isLocal && !isEnemy) {
      this.marker = MeshBuilder.CreateCylinder('marcador', { diameterTop: 0.22, diameterBottom: 0, height: 0.22, tessellation: 3 }, scene);
      const mm = this.mat(scene, 'marcador', teamColor, 0, 1);
      mm.emissiveColor = teamColor;
      mm.disableLighting = true;
      this.marker.material = mm;
      this.marker.parent = this.root;
      this.marker.position.y = 2.1;
      this.meshes.push(this.marker);
    }
    for (const m of this.root.getChildMeshes()) m.isPickable = false;
  }

  private mat(scene: Scene, name: string, color: Color3, spec: number, power: number) {
    const m = new StandardMaterial(`${name}-${this.playerId}`, scene);
    m.diffuseColor = color.clone();
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = power;
    this.mats.push(m);
    return m;
  }

  private makeLid(scene: Scene, variant: number): Mesh {
    if (variant === 0) {
      const l = MeshBuilder.CreateCylinder('tampa', { height: 0.05, diameter: 0.34, tessellation: 18 }, scene);
      l.position.y = 0.31;
      const k = MeshBuilder.CreateSphere('pegador', { diameter: 0.08, segments: 6 }, scene);
      k.position.y = 0.05;
      k.parent = l;
      k.material = this.teamMat;
      return l;
    }
    if (variant === 1) {
      const l = MeshBuilder.CreateSphere('tampa', { diameter: 0.34, segments: 10, slice: 0.5 }, scene);
      l.position.y = 0.29;
      l.scaling.y = 0.6;
      return l;
    }
    if (variant === 2) {
      const l = MeshBuilder.CreateCylinder('tampa', { height: 0.14, diameterTop: 0.12, diameterBottom: 0.34, tessellation: 18 }, scene);
      l.position.y = 0.35;
      return l;
    }
    const l = MeshBuilder.CreateTorus('tampa', { diameter: 0.3, thickness: 0.05, tessellation: 18 }, scene);
    l.position.y = 0.31;
    return l;
  }

  private makeTool(scene: Scene, weapon: WeaponId, brass: StandardMaterial, glass: StandardMaterial, polymer: StandardMaterial): TransformNode {
    const t = new TransformNode('ferramenta', scene);
    t.position.set(0.22, 0.34, 0.26);
    if (weapon === 'esguicho') {
      const tank = MeshBuilder.CreateCylinder('reservatorio', { height: 0.26, diameter: 0.17, tessellation: 12 }, scene);
      tank.rotation.x = Math.PI / 2;
      tank.material = glass;
      tank.parent = t;
      const liquid = MeshBuilder.CreateCylinder('liquido', { height: 0.22, diameter: 0.14, tessellation: 12 }, scene);
      liquid.rotation.x = Math.PI / 2;
      liquid.material = this.coreMat;
      liquid.parent = t;
      const nozzle = MeshBuilder.CreateCylinder('bico', { height: 0.36, diameterTop: 0.03, diameterBottom: 0.05, tessellation: 8 }, scene);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.z = 0.28;
      nozzle.material = brass;
      nozzle.parent = t;
      const pump = MeshBuilder.CreateBox('bomba', { width: 0.04, height: 0.14, depth: 0.04 }, scene);
      pump.position.set(0, 0.12, -0.04);
      pump.material = brass;
      pump.parent = t;
      this.meshes.push(tank, liquid, nozzle, pump);
    } else if (weapon === 'rodo') {
      t.position.set(0, 0.05, 0.3);
      const handle = MeshBuilder.CreateCylinder('cabo', { height: 1.1, diameter: 0.05, tessellation: 8 }, scene);
      handle.rotation.x = Math.PI / 2 - 0.9;
      handle.position.set(0, -0.15, 0.25);
      handle.material = this.mats[0] ?? polymer;
      handle.parent = t;
      const blade = MeshBuilder.CreateBox('lamina', { width: 2.0, height: 0.14, depth: 0.08 }, scene);
      blade.position.set(0, -0.52, 0.62);
      blade.material = polymer;
      blade.parent = t;
      const rubber = MeshBuilder.CreateBox('borracha', { width: 2.02, height: 0.05, depth: 0.1 }, scene);
      rubber.position.set(0, -0.6, 0.62);
      rubber.material = this.teamMat;
      rubber.parent = t;
      this.meshes.push(handle, blade, rubber);
    } else {
      const grip = MeshBuilder.CreateCylinder('empunhadura', { height: 0.2, diameter: 0.05, tessellation: 8 }, scene);
      grip.material = brass;
      grip.parent = t;
      for (const side of [-1, 1]) {
        const prong = MeshBuilder.CreateCylinder('forquilha', { height: 0.2, diameter: 0.04, tessellation: 8 }, scene);
        prong.position.set(0.06 * side, 0.17, 0);
        prong.rotation.z = -0.45 * side;
        prong.material = brass;
        prong.parent = t;
        this.meshes.push(prong);
      }
      this.band = new TransformNode('elastico', scene);
      this.band.parent = t;
      this.band.position.set(0, 0.25, 0);
      const pouch = MeshBuilder.CreateSphere('pedra', { diameter: 0.08, segments: 8 }, scene);
      pouch.position.z = -0.12;
      pouch.material = this.coreMat;
      pouch.parent = this.band;
      for (const side of [-1, 1]) {
        const strap = MeshBuilder.CreateCylinder('tira', { height: 0.16, diameter: 0.018, tessellation: 6 }, scene);
        strap.rotation.x = Math.PI / 2;
        strap.rotation.y = 0.5 * side;
        strap.position.set(0.05 * side, 0, -0.06);
        strap.material = this.teamMat;
        strap.parent = this.band;
        this.meshes.push(strap);
      }
      this.meshes.push(grip, pouch);
    }
    return t;
  }

  setTeamColor(c: Color3) {
    this.teamMat.diffuseColor = c.clone();
    this.coreMat.diffuseColor = c.clone();
    this.coreMat.emissiveColor = c.scale(0.6);
  }

  update(dt: number, v: CharacterVisual, groundY: number | null) {
    this.root.setEnabled(v.alive);
    if (!v.alive) {
      this.lastHp = 100;
      return;
    }
    this.root.position.set(v.pos[0], v.pos[1], v.pos[2]);
    this.root.rotation.y = v.yaw;
    // mistura de forma com leve exagero (transição legível)
    const target = v.form === 1 ? 1 : 0;
    this.formBlend += (target - this.formBlend) * Math.min(1, dt * 14);
    const b = this.formBlend;
    const cs = Math.max(0.001, 1 - b);
    const fs = Math.max(0.001, b * (1 + Math.sin(b * Math.PI) * 0.25));
    this.combat.scaling.set(cs, cs, cs);
    this.flow.scaling.set(fs, fs, fs);
    this.spin += dt * (6 + v.speed * 3.5);
    this.flow.rotation.y = this.spin;
    const sub = v.submerged ? 1 : 0;
    this.flow.position.y = -0.34 * sub;
    if (v.climbing) {
      this.flow.rotation.x = -1.35;
      this.flow.position.z = -0.1;
    } else {
      this.flow.rotation.x = 0;
      this.flow.position.z = 0;
    }

    // visibilidade: imerso reduz exposição (não é invisibilidade absoluta)
    let vis = 1;
    if (v.submerged) vis = this.isEnemy ? (v.speed > 1.5 ? 0.14 : 0.05) : 0.45;
    if (v.inEnemyInk) vis = 1;
    this.visibleFactor += (vis - this.visibleFactor) * Math.min(1, dt * 10);
    for (const m of this.meshes) m.visibility = this.visibleFactor;

    // locomoção
    const walk = v.grounded && !v.climbing ? Math.min(1, v.speed / 5.5) : 0;
    this.phase += dt * (4 + v.speed * 1.9);
    const swing = Math.sin(this.phase) * 0.75 * walk;
    this.legL.rotation.x = v.grounded ? swing : -0.5;
    this.legR.rotation.x = v.grounded ? -swing : 0.2;
    const bob = Math.abs(Math.sin(this.phase)) * 0.05 * walk;
    this.upper.position.y = 0.46 + bob;
    if (!this.wasGrounded && v.grounded) this.squash = 0.16;
    this.wasGrounded = v.grounded;
    this.squash = Math.max(0, this.squash - dt);
    const sq = this.squash > 0 ? Math.sin((this.squash / 0.16) * Math.PI) * 0.12 : 0;
    const stretch = !v.grounded ? Math.min(0.08, Math.abs(v.vy) * 0.01) : 0;
    this.combat.scaling.y *= 1 - sq + stretch;
    this.combat.scaling.x *= 1 + sq * 0.6;
    this.combat.scaling.z *= 1 + sq * 0.6;

    // mira: tronco e cabeça acompanham o pitch
    const aim = -v.pitch * 0.55;
    this.upper.rotation.x = v.charging ? aim - 0.12 : aim + walk * 0.08;
    this.head.rotation.x = -v.pitch * 0.35;
    // braços
    const armAim = -1.35 - v.pitch * 0.6;
    if (this.weaponId === 'rodo') {
      const low = v.dragging ? -0.7 : v.swinging ? -2.4 : -0.9;
      this.armR.rotation.x = low;
      this.armL.rotation.x = low;
      this.tool.rotation.x = v.swinging ? -0.9 : v.dragging ? 0.15 : 0;
    } else {
      this.armR.rotation.x = armAim + (v.firing ? Math.sin(this.phase * 9) * 0.05 : 0);
      this.armL.rotation.x = armAim + 0.1;
      this.armL.rotation.z = 0.35;
      this.tool.rotation.x = 0;
      this.tool.position.z = 0.26 + (v.firing ? -Math.abs(Math.sin(performance.now() * 0.05)) * 0.04 : 0);
    }
    if (this.band) this.band.scaling.z = 1 + (v.charging ? v.charge * 2.2 : 0);
    // pigmento visível no reservatório
    this.tankLiquid.scaling.y = Math.max(0.02, v.ink / 100);

    // piscar
    this.blinkTimer -= dt;
    const blink = this.blinkTimer < 0.1 ? 0.15 : 1;
    if (this.blinkTimer < 0) this.blinkTimer = 2.5 + ((this.playerId * 7919) % 17) / 5;
    for (const e of this.eyes) e.scaling.y = 1.25 * blink;
    // dano: lampejo
    if (v.hp < this.lastHp - 0.5) this.flashTimer = 0.14;
    this.lastHp = v.hp;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.ceramic.emissiveColor.set(this.flashTimer * 5, this.flashTimer * 4, this.flashTimer * 4);

    this.bubble.setEnabled(v.protected);
    if (v.protected) (this.bubble.material as StandardMaterial).alpha = 0.12 + Math.sin(performance.now() * 0.008) * 0.05;
    if (this.marker) this.marker.rotation.y += dt * 2;

    // sombra projetada no chão abaixo
    if (groundY !== null) {
      const h = v.pos[1] - groundY;
      this.shadow.setEnabled(h < 6 && !v.climbing && !v.submerged);
      this.shadow.position.y = groundY - v.pos[1] + 0.03;
      const s = Math.max(0.3, 1 - h * 0.12);
      this.shadow.scaling.set(s, s, s);
    } else this.shadow.setEnabled(false);
  }

  /** Posição aproximada do cano (visual). */
  muzzleWorld(): Vector3 {
    return this.tool.getAbsolutePosition().add(this.root.forward.scale(0.35));
  }

  dispose() {
    this.root.dispose(false, true);
    for (const m of this.mats) m.dispose();
  }
}

function jarProfile(): Vector3[] {
  return [
    new Vector3(0, 0, 0),
    new Vector3(0.16, 0.0, 0),
    new Vector3(0.27, 0.08, 0),
    new Vector3(0.31, 0.24, 0),
    new Vector3(0.29, 0.42, 0),
    new Vector3(0.2, 0.56, 0),
    new Vector3(0.13, 0.62, 0),
    new Vector3(0.15, 0.66, 0),
    new Vector3(0, 0.66, 0),
  ];
}

function headProfile(): Vector3[] {
  return [
    new Vector3(0, 0, 0),
    new Vector3(0.1, 0.0, 0),
    new Vector3(0.2, 0.07, 0),
    new Vector3(0.24, 0.17, 0),
    new Vector3(0.22, 0.27, 0),
    new Vector3(0.18, 0.3, 0),
    new Vector3(0, 0.3, 0),
  ];
}

function topProfile(): Vector3[] {
  return [
    new Vector3(0, 0.0, 0),
    new Vector3(0.05, 0.02, 0),
    new Vector3(0.2, 0.18, 0),
    new Vector3(0.38, 0.34, 0),
    new Vector3(0.4, 0.4, 0),
    new Vector3(0.3, 0.5, 0),
    new Vector3(0.12, 0.56, 0),
    new Vector3(0, 0.57, 0),
  ];
}
