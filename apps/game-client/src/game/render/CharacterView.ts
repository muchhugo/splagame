import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, DynamicTexture } from '@babylonjs/core';
import type { AppearanceId, AppearanceParts, TeamId, WeaponId } from '@borrifo/game-contracts';
import { DEFAULT_APPEARANCE, parseAppearanceId } from '@borrifo/game-contracts';
import { sharedToon, ToonMaterial, type ToonMeshState } from './ToonMaterial';

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
  /** 1 = comemora (vitória), -1 = desanima (derrota), 0 = nada. */
  celebrate?: number;
  /** Informação pública dos modos: portador da cápsula e buffs/Mutirão ativos. */
  carrier?: boolean;
  embalo?: boolean;
  folego?: boolean;
  mutirao?: boolean;
}

/** Tons de pele escolhidos pelo jogador (nunca deduzidos). */
export const SKIN_TONES: readonly string[] = ['#f4d4ba', '#dfa982', '#b3764c', '#7a4a2d'];
/** Cores de cabelo (naturais: nenhuma lembra a cor de uma equipe). */
export const HAIR_COLORS: readonly string[] = ['#2b1c14', '#3b2318', '#5e3a22', '#9a4a26', '#d3a24c', '#a9a197'];
export const HAIR_COLOR_NAMES: readonly string[] = ['Preto', 'Castanho-escuro', 'Castanho', 'Acobreado', 'Loiro', 'Grisalho'];
/** Estilos de cabelo: silhuetas diferentes, a mesma cabeça e a mesma hitbox. */
export const HAIR_STYLE_NAMES: readonly string[] = ['Cachos com faixa', 'Rabo alto', 'Black power', 'Coquinhos'];
const CLOTH = { camisa: '#f3eadb', short: '#3b3643', legging: '#463d52', sola: '#fbf7f0', olho: '#3a2518' } as const;

export function parseAppearance(id: AppearanceId | undefined): AppearanceParts {
  return parseAppearanceId(id ?? DEFAULT_APPEARANCE);
}

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

const hex = (h: string) => Color3.FromHexString(h);

/**
 * Personagem humano estilizado, em duas bases (apresentação masculina 'a' e
 * feminina 'b') com a MESMA altura, volume e esqueleto: a hitbox (cápsula de
 * 1,55 m) é idêntica e a aparência é só cosmética. Cabeça grande, olhos
 * expressivos, cabelo e roupa esportiva. A cor da equipe fica em áreas
 * delimitadas (camiseta/jardineira, tênis, faixa ou elástico do cabelo,
 * mochila de pigmento e ferramenta); pele, olhos e cabelo nunca mudam.
 *
 * Forma Pião: a mochila se abre num pião de madeira pintada e a pessoa se
 * encolhe dentro dele (os olhos e o topete aparecem na borda).
 *
 * Materiais compartilhados por cena; o lampejo de dano e a luz sob o
 * personagem são estado por malha (ToonMeshState), lidos no bind.
 */
export class CharacterView {
  readonly root: TransformNode;
  readonly appearance: AppearanceParts;
  private combat: TransformNode;
  private flow: TransformNode;
  private flowSpin: TransformNode;
  private hips: TransformNode;
  private torso: TransformNode;
  private head: TransformNode;
  private shoulderL: TransformNode;
  private shoulderR: TransformNode;
  private elbowL: TransformNode;
  private elbowR: TransformNode;
  private thighL: TransformNode;
  private thighR: TransformNode;
  private kneeL: TransformNode;
  private kneeR: TransformNode;
  private tool: TransformNode;
  private pony: TransformNode | null = null;
  private band: TransformNode | null = null;
  private eyes: Mesh;
  private pupils: Mesh;
  private browL: Mesh;
  private browR: Mesh;
  private mouth: Mesh;
  private flowEyes: TransformNode;
  private tankLiquid: Mesh;
  private shadow: Mesh;
  private bubble: Mesh;
  private swirl: Mesh;
  private meshes: Mesh[] = [];
  private detail: Mesh[] = [];
  private outlined: Mesh[] = [];
  private own: Array<ToonMaterial | StandardMaterial> = [];
  private teamMat: ToonMaterial;
  private inkMat: ToonMaterial;
  private readonly toonState: ToonMeshState = { flash: 0, sunVis: 1 };
  private phase = 0;
  private formBlend = 0;
  private spin = 0;
  private squash = 0;
  private squashAmp = 0.14;
  private wasGrounded = true;
  /**
   * "Desleixo controlado": molas de inércia do tronco, cabeça, cabelo e braços, frenagem com
   * escorregão e aterrissagem elástica. Só visual: posição, rumo, hitbox e mira continuam
   * exatamente os da simulação. `focus` (0..1) sobe rápido ao mirar/disparar e corta o exagero.
   */
  private sp = { lagX: new Spring(), lagZ: new Spring(), twist: new Spring(), headX: new Spring(), headZ: new Spring(), hairX: new Spring(), hairZ: new Spring() };
  private prevPos: [number, number, number] | null = null;
  private prevYaw = 0;
  private velS: [number, number] = [0, 0];
  private accS: [number, number] = [0, 0];
  private focus = 0;
  private brakeT = 0;
  private flail = 0;
  private blinkTimer = 2;
  private flashTimer = 0;
  private hurtTimer = 0;
  private lastHp = 100;
  private visibleFactor = 1;
  private recoil = 0;
  private idleT: number;
  private deathTimer = 0;
  private wasAlive = true;
  private swirlT = 0;
  private lastForm = 0;
  private marker: Mesh | null = null;
  /** Aura de buff/Mutirão nos pés (material compartilhado por tipo). */
  private aura: Mesh;
  private auraMats: Record<'embalo' | 'folego' | 'mutirao', ToonMaterial>;

  constructor(
    private readonly scene: Scene,
    readonly playerId: number,
    readonly team: TeamId,
    readonly weaponId: WeaponId,
    teamColor: Color3,
    readonly isLocal: boolean,
    readonly isEnemy: boolean,
    appearance?: AppearanceId,
  ) {
    this.appearance = parseAppearance(appearance);
    const { base, tone, hair: hairStyle, hairColor } = this.appearance;
    this.idleT = (playerId * 1.37) % 6;
    this.root = new TransformNode(`pessoa-${playerId}`, scene);
    const skin = sharedToon(scene, `pele-${tone}`, hex(SKIN_TONES[tone]), 0.35);
    skin.soft = 1;
    const hair = sharedToon(scene, `cabelo-${hairColor}`, hex(HAIR_COLORS[hairColor] ?? HAIR_COLORS[0]), 0.55);
    const shirt = sharedToon(scene, 'camisa', hex(CLOTH.camisa), 0.3);
    const pants = sharedToon(scene, base === 'a' ? 'short' : 'legging', hex(base === 'a' ? CLOTH.short : CLOTH.legging), 0.25);
    const sole = sharedToon(scene, 'sola', hex(CLOTH.sola), 0.3);
    const white = sharedToon(scene, 'esclera', new Color3(1, 1, 1), 0.2);
    const iris = sharedToon(scene, 'iris', hex(CLOTH.olho), 0.9);
    const glass = sharedToon(scene, 'vidro', new Color3(0.82, 0.95, 1.0), 1.0);
    glass.alpha = 0.4;
    const brass = sharedToon(scene, 'latao', new Color3(0.95, 0.72, 0.28), 0.9);
    const wood = sharedToon(scene, 'madeira-pintada', new Color3(0.78, 0.55, 0.34), 0.25);
    const dark = sharedToon(scene, 'escuro', new Color3(0.16, 0.1, 0.1), 0.2);
    // cor da equipe: materiais do time (compartilhados por equipe, atualizados em setTeamColor)
    this.teamMat = sharedToon(scene, `equipe-${team}`, teamColor, 0.6);
    this.inkMat = sharedToon(scene, `tinta-${team}`, teamColor, 1.0);
    this.inkMat.setEmissive(teamColor.scale(0.15));

    const node = (name: string, parent: TransformNode, x = 0, y = 0, z = 0) => {
      const n = new TransformNode(name, scene);
      n.parent = parent;
      n.position.set(x, y, z);
      return n;
    };
    const put = (m: Mesh, parent: TransformNode, mat: ToonMaterial, x = 0, y = 0, z = 0) => {
      m.parent = parent;
      m.position.set(x, y, z);
      m.material = mat;
      this.meshes.push(m);
      return m;
    };
    // peça solta em coordenadas locais, para mesclar com outras do mesmo material (menos desenho)
    const at = (m: Mesh, x = 0, y = 0, z = 0) => {
      m.position.set(x, y, z);
      return m;
    };
    const cap = (name: string, r: number, h: number) => MeshBuilder.CreateCapsule(name, { radius: r, height: h, tessellation: 10, subdivisions: 1 }, scene);
    const sph = (name: string, d: number, seg = 10) => MeshBuilder.CreateSphere(name, { diameter: d, segments: seg }, scene);

    // ---------------- esqueleto (mesmas medidas nas duas bases) ----------------
    this.combat = node('combate', this.root);
    this.hips = node('quadril', this.combat, 0, 0.64, 0);
    const mkLeg = (side: number) => {
      const thigh = node('coxa', this.hips, 0.1 * side, 0, 0);
      put(cap('coxa', 0.088, 0.36), thigh, pants, 0, -0.14, 0);
      const knee = node('joelho', thigh, 0, -0.31, 0);
      // canela: pele na base 'a' (bermuda), legging na 'b'
      put(cap('canela', 0.068, 0.32), knee, base === 'a' ? skin : pants, 0, -0.14, 0);
      const shoe = put(sph('tenis', 0.2), knee, this.teamMat, 0, -0.3, 0.05);
      shoe.scaling.set(0.72, 0.5, 1.32);
      const s2 = at(sph('sola', 0.2), 0, -0.33, 0.05);
      s2.scaling.set(0.78, 0.25, 1.38);
      // base 'b': cano do tênis alto
      this.mergeInto(base === 'b' ? [s2, at(MeshBuilder.CreateCylinder('cano', { height: 0.09, diameter: 0.15, tessellation: 10 }, scene), 0, -0.24, 0)] : [s2], knee, sole, 'sola');
      return { thigh, knee };
    };
    ({ thigh: this.thighL, knee: this.kneeL } = mkLeg(-1));
    ({ thigh: this.thighR, knee: this.kneeR } = mkLeg(1));
    const pelvis = put(sph('bacia', 0.36), this.hips, pants, 0, 0.02, 0);
    pelvis.scaling.set(1.05, 0.55, 0.8);

    this.torso = node('tronco', this.hips, 0, 0.04, 0);
    const body = put(MeshBuilder.CreateLathe('camiseta', { shape: torsoProfile(), tessellation: 16 }, scene), this.torso, base === 'a' ? this.teamMat : shirt);
    body.scaling.z = 0.78;
    if (base === 'a') {
      // camiseta de time com gola e barra claras (faixas delimitadas)
      const collar = at(MeshBuilder.CreateTorus('gola', { diameter: 0.2, thickness: 0.035, tessellation: 16 }, scene), 0, 0.43, 0);
      collar.scaling.z = 0.8;
      const hem = at(MeshBuilder.CreateTorus('barra', { diameter: 0.42, thickness: 0.04, tessellation: 18 }, scene), 0, 0.03, 0);
      hem.scaling.z = 0.78;
      this.mergeInto([collar, hem], this.torso, shirt, 'gola-barra');
    } else {
      // jardineira na cor da equipe sobre a camiseta clara, com duas alças
      const bib = at(MeshBuilder.CreateLathe('jardineira', { shape: bibProfile(), tessellation: 16 }, scene));
      bib.scaling.z = 0.8;
      const straps = [-1, 1].map((side) => {
        const strap = at(MeshBuilder.CreateBox('alca', { width: 0.045, height: 0.24, depth: 0.03 }, scene), 0.085 * side, 0.3, 0.155);
        strap.rotation.x = -0.18;
        return strap;
      });
      this.mergeInto([bib, ...straps], this.torso, this.teamMat, 'jardineira');
      this.mergeInto([-1, 1].map((side) => at(sph('botao', 0.04, 6), 0.085 * side, 0.21, 0.175)), this.torso, brass, 'botoes');
    }
    put(MeshBuilder.CreateCylinder('pescoco', { height: 0.1, diameter: 0.1, tessellation: 10 }, scene), this.torso, skin, 0, 0.46, 0);

    // mochila de pigmento: frasco de vidro com o nível de tinta visível e alças da equipe
    const pack = node('mochila', this.torso, 0, 0.26, -0.2);
    pack.rotation.x = 0.1;
    const tank = put(cap('tanque', 0.13, 0.42), pack, glass);
    this.tankLiquid = put(cap('tinta', 0.108, 0.36), pack, this.inkMat);
    this.tankLiquid.setPivotPoint(new Vector3(0, -0.18, 0));
    const packStrap = at(MeshBuilder.CreateTorus('alca-mochila', { diameter: 0.34, thickness: 0.028, tessellation: 16 }, scene), 0, 0.02, 0.12);
    packStrap.rotation.x = Math.PI / 2;
    this.mergeInto([at(MeshBuilder.CreateCylinder('tampa', { height: 0.06, diameter: 0.18, tessellation: 12 }, scene), 0, 0.22, 0), packStrap], pack, this.teamMat, 'tampa-alca');

    // ---------------- cabeça e rosto ----------------
    this.head = node('cabeca', this.torso, 0, 0.72, 0.01);
    // crânio, orelhas e nariz: uma malha só (mesmo material, nada se move entre eles)
    const skullPart = at(sph('cabeca', 0.44, 14));
    skullPart.scaling.set(1, 1.04, 0.96);
    const ears = [-1, 1].map((side) => {
      const ear = at(sph('orelha', 0.1, 8), 0.215 * side, -0.01, -0.01);
      ear.scaling.set(0.45, 0.8, 0.6);
      return ear;
    });
    const nosePart = at(sph('nariz', 0.07, 8), 0, -0.03, 0.21);
    nosePart.scaling.set(1, 0.8, 0.8);
    const skull = this.mergeInto([skullPart, ...ears, nosePart], this.head, skin, 'cabeca');
    // olhos: esclera e íris (mescladas por material para economizar desenho)
    this.eyes = this.mergeInto(
      [-1, 1].map((side) => {
        const e = sph('esclera', 0.105, 10);
        e.position.set(0.085 * side, 0.035, 0.18);
        e.scaling.set(0.85, 1.12, 0.55);
        return e;
      }),
      this.head,
      white,
      'olhos',
    );
    this.pupils = this.mergeInto(
      [-1, 1].map((side) => {
        const p = sph('iris', 0.062, 8);
        p.position.set(0.085 * side, 0.03, 0.212);
        p.scaling.set(0.9, 1.1, 0.4);
        return p;
      }),
      this.head,
      iris,
      'iris',
    );
    const mkBrow = (side: number) => {
      const b = put(MeshBuilder.CreateBox('sobrancelha', { width: base === 'a' ? 0.1 : 0.085, height: base === 'a' ? 0.026 : 0.018, depth: 0.02 }, scene), this.head, hair, 0.088 * side, 0.125, 0.19);
      b.rotation.z = -0.12 * side;
      return b;
    };
    this.browL = mkBrow(-1);
    this.browR = mkBrow(1);
    // boca: arco fino (sorriso), invertido para franzir
    const arc: Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8 - 0.5) * 1.8;
      arc.push(new Vector3(Math.sin(t) * 0.055, -Math.cos(t) * 0.025 + 0.025, 0));
    }
    this.mouth = put(MeshBuilder.CreateTube('boca', { path: arc, radius: 0.0085, tessellation: 5, cap: Mesh.CAP_ALL }, scene), this.head, dark, 0, -0.09, 0.2);
    this.detail.push(this.pupils, this.browL, this.browR, this.mouth);

    // cabelo: o estilo é independente da base; cílios e brincos são da base 'b'
    if (base === 'b') {
      // cílios: traço curto na borda de fora de cada olho
      const lashes = [-1, 1].map((side) => {
        const l = at(MeshBuilder.CreateBox('cilio', { width: 0.05, height: 0.014, depth: 0.02 }, scene), 0.125 * side, 0.085, 0.19);
        l.rotation.z = 0.5 * side;
        return l;
      });
      this.detail.push(this.mergeInto(lashes, this.head, dark, 'cilios'));
      this.mergeInto([-1, 1].map((side) => at(sph('brinco', 0.035, 6), 0.215 * side, -0.07, 0.01)), this.head, brass, 'brincos');
    }
    if (hairStyle === 0) {
      // cachos curtos (várias bolinhas mescladas) e faixa esportiva da equipe
      const curls: Mesh[] = [];
      const pts: Array<[number, number, number, number]> = [
        [0, 0.17, 0.02, 0.2], [0.1, 0.15, 0.06, 0.15], [-0.1, 0.15, 0.06, 0.15], [0.13, 0.12, -0.06, 0.15], [-0.13, 0.12, -0.06, 0.15],
        [0, 0.15, -0.11, 0.18], [0.07, 0.19, -0.05, 0.14], [-0.07, 0.19, -0.05, 0.14], [0.05, 0.14, 0.13, 0.12], [-0.06, 0.15, 0.12, 0.12],
      ];
      for (const [x, y, z, d] of pts) {
        const c = sph('cacho', d, 8);
        c.position.set(x, y, z);
        curls.push(c);
      }
      this.mergeInto(curls, this.head, hair, 'cabelo');
      const bandana = put(MeshBuilder.CreateTorus('faixa', { diameter: 0.43, thickness: 0.045, tessellation: 20 }, scene), this.head, this.teamMat, 0, 0.1, -0.005);
      bandana.rotation.x = 0.16;
      bandana.scaling.set(1, 0.9, 0.97);
    } else if (hairStyle === 1) {
      // cabelo volumoso com franja lateral e rabo alto que balança; elástico da equipe
      const capHair = sph('cabelo', 0.47, 12);
      capHair.scaling.set(1.02, 0.94, 1.02);
      capHair.position.set(0, 0.07, -0.05);
      const fringe = sph('franja', 0.22, 8);
      fringe.position.set(0.07, 0.15, 0.13);
      fringe.scaling.set(1.3, 0.5, 0.6);
      fringe.rotation.z = -0.35;
      // mechas laterais que emolduram o rosto até a altura do queixo
      const locks = [-1, 1].map((side) => {
        const l = cap('mecha', 0.05, 0.3);
        l.position.set(0.185 * side, -0.02, 0.08);
        l.rotation.z = 0.12 * side;
        l.rotation.x = -0.12;
        return l;
      });
      this.mergeInto([capHair, fringe, ...locks], this.head, hair, 'cabelo');
      this.pony = node('rabo', this.head, 0, 0.2, -0.14);
      const tail = put(cap('rabo', 0.07, 0.34), this.pony, hair, 0, -0.14, -0.05);
      tail.rotation.x = 0.35;
      put(MeshBuilder.CreateTorus('elastico', { diameter: 0.09, thickness: 0.03, tessellation: 12 }, scene), this.pony, this.teamMat, 0, 0, 0);
    } else if (hairStyle === 2) {
      // black power arredondado, com a faixa da equipe marcando a testa
      const puff = sph('black', 0.6, 14);
      puff.scaling.set(1.06, 0.9, 1.0);
      puff.position.set(0, 0.13, -0.06);
      this.mergeInto([puff], this.head, hair, 'cabelo');
      const band = put(MeshBuilder.CreateTorus('faixa', { diameter: 0.45, thickness: 0.04, tessellation: 20 }, scene), this.head, this.teamMat, 0, 0.09, -0.01);
      band.rotation.x = 0.2;
      band.scaling.set(1, 0.9, 0.97);
    } else {
      // coquinhos: cabelo rente e dois coques no alto, presos com elásticos da equipe
      const capHair = sph('cabelo', 0.46, 12);
      capHair.scaling.set(1.01, 0.9, 1.0);
      capHair.position.set(0, 0.06, -0.04);
      const buns = [-1, 1].map((side) => at(sph('coque', 0.19, 10), 0.14 * side, 0.24, -0.04));
      this.mergeInto([capHair, ...buns], this.head, hair, 'cabelo');
      this.mergeInto(
        [-1, 1].map((side) => {
          const t = at(MeshBuilder.CreateTorus('elastico', { diameter: 0.13, thickness: 0.03, tessellation: 12 }, scene), 0.125 * side, 0.18, -0.04);
          t.rotation.z = 0.5 * side;
          return t;
        }),
        this.head,
        this.teamMat,
        'elasticos',
      );
    }

    // ---------------- braços ----------------
    const mkArm = (side: number) => {
      const sh = node('ombro', this.torso, 0.2 * side, 0.38, 0.01);
      put(cap('manga', 0.066, 0.2), sh, base === 'a' ? this.teamMat : shirt, 0, -0.08, 0);
      const elbow = node('cotovelo', sh, 0, -0.2, 0);
      const fore = cap('antebraco', 0.052, 0.24);
      fore.position.y = -0.1;
      const hand = sph('mao', 0.105, 8);
      hand.position.y = -0.24;
      this.mergeInto([fore, hand], elbow, skin, 'braco');
      return { sh, elbow };
    };
    ({ sh: this.shoulderL, elbow: this.elbowL } = mkArm(-1));
    ({ sh: this.shoulderR, elbow: this.elbowR } = mkArm(1));
    this.tool = this.makeTool(scene, weaponId, brass, glass, dark, wood);
    this.tool.parent = this.torso;

    // ---------------- Forma Pião ----------------
    this.flow = node('piao', this.root);
    this.flowSpin = node('giro', this.flow);
    put(MeshBuilder.CreateLathe('piao', { shape: topProfile(), tessellation: 18 }, scene), this.flowSpin, wood);
    this.mergeInto(([[0.3, 0.74], [0.42, 0.8]] as const).map(([y, d]) => at(MeshBuilder.CreateTorus('listra', { diameter: d, thickness: 0.07, tessellation: 22 }, scene), 0, y, 0)), this.flowSpin, this.teamMat, 'listras');
    put(MeshBuilder.CreateCylinder('ponta', { height: 0.12, diameterTop: 0.06, diameterBottom: 0.0, tessellation: 8 }, scene), this.flowSpin, brass, 0, -0.03, 0);
    // quem está dentro espia pela borda: topete e olhos não giram
    this.flowEyes = node('espia', this.flow, 0, 0.5, 0);
    const tuft = put(sph('topete', 0.26, 10), this.flowEyes, hair, 0, 0.05, -0.02);
    tuft.scaling.set(1, 0.6, 1);
    const fe = [-1, 1].map((side) => {
      const e = sph('esclera', 0.09, 8);
      e.position.set(0.06 * side, 0.02, 0.1);
      e.scaling.set(0.9, 1.1, 0.6);
      return e;
    });
    this.mergeInto(fe, this.flowEyes, white, 'olhos-piao');
    const fp = [-1, 1].map((side) => {
      const p = sph('iris', 0.05, 6);
      p.position.set(0.06 * side, 0.015, 0.13);
      p.scaling.set(0.9, 1.1, 0.4);
      return p;
    });
    this.mergeInto(fp, this.flowEyes, iris, 'iris-piao');
    this.flow.scaling.setAll(0.001);
    this.flow.setEnabled(false);

    // redemoinho de tinta na transição de forma
    this.swirl = MeshBuilder.CreateTorus('redemoinho', { diameter: 1.0, thickness: 0.06, tessellation: 24 }, scene);
    this.swirl.material = this.inkMat;
    this.swirl.parent = this.root;
    this.swirl.position.y = 0.35;
    this.swirl.setEnabled(false);
    this.meshes.push(this.swirl);

    // contorno discreto só nas silhuetas principais
    const outlineColor = new Color3(0.16, 0.1, 0.14);
    for (const m of [body, skull]) {
      m.renderOutline = true;
      m.outlineWidth = 0.012;
      m.outlineColor = outlineColor;
      this.outlined.push(m);
    }

    // aura de modo: anel baixo nos pés, cor e pulso por efeito (não parece ataque nem cobertura)
    this.auraMats = {
      embalo: sharedToon(scene, 'aura-embalo', new Color3(1.0, 0.6, 0.18), 1),
      folego: sharedToon(scene, 'aura-folego', new Color3(0.3, 0.8, 0.98), 1),
      mutirao: sharedToon(scene, 'aura-mutirao', new Color3(1.0, 0.86, 0.34), 1),
    };
    for (const m of Object.values(this.auraMats)) m.setEmissive(m.color.scale(0.5));
    this.aura = MeshBuilder.CreateTorus('aura', { diameter: 0.95, thickness: 0.06, tessellation: 20 }, scene);
    this.aura.parent = this.root;
    this.aura.position.y = 0.08;
    this.aura.setEnabled(false);

    // sombra de contato suave
    this.shadow = MeshBuilder.CreateGround('sombra', { width: 1.0, height: 1.0 }, scene);
    const sm = new StandardMaterial(`sombra-${playerId}`, scene);
    sm.diffuseTexture = blobShadowTexture(scene);
    sm.useAlphaFromDiffuseTexture = true;
    sm.disableLighting = true;
    sm.emissiveColor = new Color3(1, 1, 1);
    sm.zOffset = -2;
    this.own.push(sm);
    this.shadow.material = sm;
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.03;

    // bolha de proteção de reaparecimento (própria: alfa pulsa por personagem)
    this.bubble = MeshBuilder.CreateSphere('protecao', { diameter: 2, segments: 12 }, scene);
    const bm = new ToonMaterial(`bolha-${playerId}`, scene, teamColor.scale(0.6).add(new Color3(0.4, 0.4, 0.4)), 1);
    bm.alpha = 0.18;
    bm.setEmissive(teamColor.scale(0.3));
    bm.backFaceCulling = false;
    this.own.push(bm);
    this.bubble.material = bm;
    this.bubble.parent = this.root;
    this.bubble.position.y = 0.8;
    this.bubble.scaling.set(0.64, 0.92, 0.64);
    this.bubble.setEnabled(false);

    // marcador de aliado (seta sobre a cabeça)
    if (!isLocal && !isEnemy) {
      this.marker = MeshBuilder.CreateCylinder('marcador', { diameterTop: 0.24, diameterBottom: 0, height: 0.22, tessellation: 3 }, scene);
      const mm = new StandardMaterial(`marcador-${playerId}`, scene);
      mm.emissiveColor = teamColor;
      mm.disableLighting = true;
      this.own.push(mm);
      this.marker.material = mm;
      this.marker.parent = this.root;
      this.marker.position.y = 2.05;
      this.meshes.push(this.marker);
    }
    for (const m of this.root.getChildMeshes()) {
      m.isPickable = false;
      m.metadata = { toon: this.toonState };
    }
  }

  /** Funde peças de um mesmo material presas ao mesmo nó (menos chamadas de desenho). */
  private mergeInto(parts: Mesh[], parent: TransformNode, mat: ToonMaterial, name: string): Mesh {
    const merged = Mesh.MergeMeshes(parts, true, true) ?? parts[0];
    merged.name = name;
    merged.parent = parent;
    merged.material = mat;
    this.meshes.push(merged);
    return merged;
  }

  private makeTool(scene: Scene, weapon: WeaponId, brass: ToonMaterial, glass: ToonMaterial, dark: ToonMaterial, wood: ToonMaterial): TransformNode {
    const t = new TransformNode('ferramenta', scene);
    t.position.set(0.22, 0.26, 0.26);
    const add = (m: Mesh, mat: ToonMaterial, outline = false) => {
      m.material = mat;
      m.parent = t;
      this.meshes.push(m);
      if (outline) {
        m.renderOutline = true;
        m.outlineWidth = 0.01;
        m.outlineColor = new Color3(0.12, 0.08, 0.1);
        this.outlined.push(m);
      }
      return m;
    };
    if (weapon === 'esguicho') {
      // borrifador de jardim: reservatório bojudo e bico comprido
      const tank = add(MeshBuilder.CreateSphere('reservatorio', { diameter: 0.26, segments: 10 }, scene), glass, true);
      tank.scaling.set(1, 1, 1.25);
      const liquid = add(MeshBuilder.CreateSphere('liquido', { diameter: 0.21, segments: 8 }, scene), this.inkMat);
      liquid.scaling.set(1, 0.8, 1.2);
      liquid.position.y = -0.02;
      const nozzle = add(MeshBuilder.CreateCylinder('bico', { height: 0.42, diameterTop: 0.04, diameterBottom: 0.07, tessellation: 8 }, scene), brass);
      nozzle.rotation.x = Math.PI / 2 - 0.12;
      nozzle.position.set(0, 0.04, 0.32);
      const tip = add(MeshBuilder.CreateCylinder('ponteira', { height: 0.07, diameterTop: 0.1, diameterBottom: 0.05, tessellation: 10 }, scene), this.teamMat);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(0, 0.07, 0.54);
      const pump = add(MeshBuilder.CreateCylinder('bomba', { height: 0.18, diameter: 0.045, tessellation: 8 }, scene), dark);
      pump.position.set(0, 0.18, -0.05);
      this.detail.push(pump);
    } else if (weapon === 'rodo') {
      t.position.set(0, 0.0, 0.3);
      const handle = add(MeshBuilder.CreateCylinder('cabo', { height: 1.1, diameter: 0.055, tessellation: 8 }, scene), wood);
      handle.rotation.x = Math.PI / 2 - 0.95;
      handle.position.set(0, -0.14, 0.26);
      const blade = add(MeshBuilder.CreateBox('lamina', { width: 1.9, height: 0.16, depth: 0.11 }, scene), wood, true);
      blade.position.set(0, -0.48, 0.62);
      const rubber = add(MeshBuilder.CreateBox('borracha', { width: 1.94, height: 0.08, depth: 0.13 }, scene), this.teamMat);
      rubber.position.set(0, -0.59, 0.64);
    } else {
      // estilingue de forquilha grande com elástico da equipe
      add(MeshBuilder.CreateCylinder('empunhadura', { height: 0.22, diameter: 0.065, tessellation: 8 }, scene), wood);
      for (const side of [-1, 1]) {
        const prong = add(MeshBuilder.CreateCylinder('forquilha', { height: 0.26, diameter: 0.055, tessellation: 8 }, scene), wood, true);
        prong.position.set(0.08 * side, 0.2, 0);
        prong.rotation.z = -0.5 * side;
        const tipb = add(MeshBuilder.CreateSphere('ponta', { diameter: 0.07, segments: 6 }, scene), brass);
        tipb.position.set(0.15 * side, 0.31, 0);
      }
      this.band = new TransformNode('elastico', scene);
      this.band.parent = t;
      this.band.position.set(0, 0.31, 0);
      const pouch = MeshBuilder.CreateSphere('pedra', { diameter: 0.11, segments: 8 }, scene);
      pouch.position.z = -0.13;
      pouch.material = this.inkMat;
      pouch.parent = this.band;
      this.meshes.push(pouch);
      for (const side of [-1, 1]) {
        const strap = MeshBuilder.CreateCylinder('tira', { height: 0.19, diameter: 0.032, tessellation: 6 }, scene);
        strap.rotation.x = Math.PI / 2;
        strap.rotation.y = 0.62 * side;
        strap.position.set(0.07 * side, 0, -0.065);
        strap.material = this.teamMat;
        strap.parent = this.band;
        this.meshes.push(strap);
      }
    }
    return t;
  }

  /** Palco do lobby: a seta de aliado some (a etiqueta com nome e avatar já identifica). */
  hideMarker() {
    this.marker?.setEnabled(false);
  }

  setTeamColor(c: Color3) {
    this.teamMat.color = c;
    this.inkMat.color = c;
    this.inkMat.setEmissive(c.scale(0.15));
  }

  /** 0–1: esmaece o personagem colado na câmera para não tapar a mira. */
  nearFade = 1;
  /** Distância até a câmera (LOD: detalhes do rosto somem de longe). */
  camDist = 0;
  /** Eventos de pé do último update (para o som): passo no apoio e aterrissagem (s no ar). */
  readonly foot = { step: false, landed: 0 };
  private stepSign = 0;
  private airTime = 0;
  private lastAir = 0;

  /** Reação a dano: tranco, careta e lampejo claro. */
  hitReaction() {
    this.flashTimer = 0.12;
    this.hurtTimer = 0.35;
    // tranco: o tronco e a cabeça levam um empurrão que balança e assenta
    const side = (this.playerId * 37 + Math.floor(this.idleT * 10)) % 2 ? 1 : -1;
    this.sp.lagX.v -= 7;
    this.sp.headX.v -= 10;
    this.sp.lagZ.v += 5 * side;
    this.sp.headZ.v += 8 * side;
  }

  update(dt: number, v: CharacterVisual, groundY: number | null, sunVis = 1) {
    // eliminação estilizada: um "puf" curto (encolhe girando) antes de sumir
    if (!v.alive) {
      if (this.wasAlive) this.deathTimer = 0.28;
      this.wasAlive = false;
      this.lastHp = 100;
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.root.setEnabled(false);
        return;
      }
      const k = this.deathTimer / 0.28;
      this.combat.scaling.set(k * 1.15, k * 0.8, k * 1.15);
      this.combat.rotation.y += dt * 18;
      return;
    }
    if (!this.wasAlive) {
      this.combat.rotation.y = 0;
      this.wasAlive = true;
      for (const k of Object.values(this.sp)) k.reset();
      this.prevPos = null;
    }
    this.root.setEnabled(true);
    this.root.position.set(v.pos[0], v.pos[1], v.pos[2]);
    this.root.rotation.y = v.yaw;
    this.toonState.sunVis = sunVis;
    this.idleT += dt;

    // ---------------- forma (mistura com leve exagero) ----------------
    const target = v.form === 1 ? 1 : 0;
    if (target !== this.lastForm) {
      this.swirlT = 0.32;
      this.lastForm = target;
    }
    this.formBlend += (target - this.formBlend) * Math.min(1, dt * 14);
    const b = this.formBlend;
    const cs = Math.max(0.001, 1 - b);
    const fs = Math.max(0.001, b * (1 + Math.sin(b * Math.PI) * 0.25));
    this.combat.setEnabled(b < 0.985);
    this.flow.setEnabled(b > 0.015);
    this.combat.scaling.set(cs, cs, cs);
    this.combat.position.y = -0.3 * b; // encolhe para dentro do pião
    this.flow.scaling.set(fs, fs, fs);
    this.spin += dt * (7 + v.speed * 3.2);
    this.flowSpin.rotation.y = this.spin;
    const sub = v.submerged ? 1 : 0;
    this.flow.position.y = -0.34 * sub;
    this.flow.rotation.x = v.climbing ? -1.35 : Math.sin(this.spin * 0.5) * 0.06 * Math.min(1, v.speed / 4);
    this.flow.position.z = v.climbing ? -0.1 : 0;
    this.flowEyes.setEnabled(!sub);
    this.swirlT = Math.max(0, this.swirlT - dt);
    this.swirl.setEnabled(this.swirlT > 0 && this.visibleFactor > 0.5);
    if (this.swirlT > 0) {
      const k = 1 - this.swirlT / 0.32;
      this.swirl.scaling.setAll(0.4 + k * 0.9);
      this.swirl.rotation.y = k * 6;
      this.swirl.visibility = (1 - k) * this.visibleFactor;
    }

    // exposição reduzida imerso (não é invisibilidade absoluta)
    let vis = 1;
    if (v.submerged) vis = this.isEnemy ? (v.speed > 1.5 ? 0.14 : 0.05) : 0.45;
    if (v.inEnemyInk) vis = 1;
    vis = Math.min(vis, this.nearFade);
    this.visibleFactor += (vis - this.visibleFactor) * Math.min(1, dt * 10);
    const translucent = this.visibleFactor < 0.98;
    for (const m of this.meshes) if (m !== this.swirl) m.visibility = this.visibleFactor;
    // LOD por distância (menos desenho com 16 em campo): o contorno é uma passada extra
    // por malha e some a partir de 20 m
    const outlineOn = !translucent && this.camDist < 20;
    for (const m of this.outlined) m.renderOutline = outlineOn;
    // aura de modo (prioridade: Mutirão > Embalo > Fôlego); o portador é marcado pela cápsula
    const auraKind = v.mutirao ? 'mutirao' : v.embalo ? 'embalo' : v.folego ? 'folego' : null;
    this.aura.setEnabled(auraKind !== null && this.visibleFactor > 0.3);
    if (auraKind) {
      this.aura.material = this.auraMats[auraKind];
      const pulse = auraKind === 'embalo' ? 9 : auraKind === 'mutirao' ? 5 : 3;
      this.aura.scaling.setAll(1 + Math.sin(this.idleT * pulse) * 0.08 + (v.carrier ? 0.15 : 0));
      this.aura.rotation.y += dt * (auraKind === 'embalo' ? 6 : 1.5);
    }
    // LOD: detalhes pequenos do rosto e da ferramenta somem a partir de 18 m
    const near = this.camDist < 18;
    for (const m of this.detail) m.setEnabled(near);

    // ---------------- locomoção ----------------
    const walk = v.grounded && !v.climbing ? Math.min(1, v.speed / 5.5) : 0;
    const run = Math.max(0, Math.min(1, (v.speed - 4) / 3)) * walk;
    this.phase += dt * (3.5 + v.speed * 2.1);
    const sign = Math.sin(this.phase) >= 0 ? 1 : -1;
    this.foot.step = sign !== this.stepSign && walk > 0.3 && v.form === 0 && !v.submerged;
    this.stepSign = sign;
    this.foot.landed = !this.wasGrounded && v.grounded && !v.climbing ? this.airTime : 0;
    this.airTime = v.grounded ? 0 : this.airTime + dt;
    const s = Math.sin(this.phase);
    const stride = 0.75 + run * 0.35;
    if (v.grounded) {
      this.thighL.rotation.x = s * stride * walk;
      this.thighR.rotation.x = -s * stride * walk;
      // joelho dobra na volta da passada (peso), estica no apoio
      this.kneeL.rotation.x = Math.max(0, -Math.sin(this.phase + 0.9)) * 1.25 * walk;
      this.kneeR.rotation.x = Math.max(0, Math.sin(this.phase + 0.9)) * 1.25 * walk;
    } else {
      // no ar: pernas encolhidas (antecipação de pouso)
      const tuck = v.vy > 0 ? 1 : 0.6;
      this.thighL.rotation.x = -0.75 * tuck;
      this.thighR.rotation.x = -0.25 * tuck;
      this.kneeL.rotation.x = 1.1 * tuck;
      this.kneeR.rotation.x = 0.7 * tuck;
    }
    const bob = Math.abs(s) * (0.045 + run * 0.03) * walk;
    const breathe = Math.sin(this.idleT * 2.1) * 0.012 * (1 - walk);
    this.hips.position.y = 0.64 + bob - (v.grounded ? 0 : 0.02);
    this.torso.rotation.z = s * 0.05 * walk;
    this.torso.scaling.y = 1 + breathe;
    if (!this.wasGrounded && v.grounded) {
      // aterrissagem elástica proporcional à queda (sem mudar a hitbox: é escala visual)
      const impact = Math.min(1, this.lastAir * 1.4);
      this.squash = 0.2 + impact * 0.08;
      this.squashAmp = (0.1 + impact * 0.16) * (1 - this.focus * 0.6);
      this.sp.lagX.v += 4 * impact;
      this.sp.headX.v += 7 * impact;
      this.sp.hairX.v -= 9 * impact;
      this.flail = Math.max(this.flail, impact);
    }
    this.lastAir = v.grounded ? this.lastAir : this.airTime;
    this.wasGrounded = v.grounded;
    this.squash = Math.max(0, this.squash - dt);
    const sq = this.squash > 0 ? Math.sin((this.squash / 0.28) * Math.PI) * this.squashAmp : 0;
    const stretch = !v.grounded ? Math.min(0.08, Math.abs(v.vy) * 0.01) : 0;
    this.combat.scaling.y *= 1 - sq + stretch;
    this.combat.scaling.x *= 1 + sq * 0.5;
    this.combat.scaling.z *= 1 + sq * 0.5;
    if (this.pony) {
      this.pony.rotation.x = 0.2 + Math.sin(this.phase * 2) * 0.25 * walk + (v.grounded ? 0 : -0.4);
      this.pony.rotation.z = Math.sin(this.phase) * 0.2 * walk;
    }

    // ---------------- mira, ferramenta e reações ----------------
    if (v.firing) this.recoil = Math.min(1, this.recoil + dt * 20);
    else this.recoil = Math.max(0, this.recoil - dt * 8);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    const hurt = this.hurtTimer > 0 ? Math.sin((this.hurtTimer / 0.35) * Math.PI) : 0;
    const aim = -v.pitch * 0.5;
    const lean = walk * (0.1 + run * 0.08);
    this.torso.rotation.x = (v.charging ? aim - 0.16 : aim + lean - this.recoil * 0.05) - hurt * 0.25;
    this.head.rotation.x = -v.pitch * 0.3 + (v.charging ? 0.08 : 0) - hurt * 0.2;
    this.head.rotation.y = Math.sin(this.idleT * 0.6) * 0.18 * (1 - walk) * (v.firing ? 0 : 1);
    const armAim = -1.4 - v.pitch * 0.6;
    const celebrate = v.celebrate ?? 0;
    if (celebrate > 0) {
      // vitória: pulinhos e braços para cima
      const hop = Math.abs(Math.sin(this.idleT * 6));
      this.hips.position.y += hop * 0.12;
      this.shoulderL.rotation.x = -2.9 + Math.sin(this.idleT * 12) * 0.2;
      this.shoulderR.rotation.x = -2.9 - Math.sin(this.idleT * 12) * 0.2;
      this.shoulderL.rotation.z = -0.3;
      this.shoulderR.rotation.z = 0.3;
      this.elbowL.rotation.x = this.elbowR.rotation.x = -0.2;
    } else if (celebrate < 0) {
      this.torso.rotation.x = 0.35;
      this.head.rotation.x = 0.35;
      this.shoulderL.rotation.x = this.shoulderR.rotation.x = 0.15;
      this.shoulderL.rotation.z = -0.1;
      this.shoulderR.rotation.z = 0.1;
      this.elbowL.rotation.x = this.elbowR.rotation.x = -0.1;
    } else if (this.weaponId === 'rodo') {
      const low = v.dragging ? -0.7 : v.swinging ? -2.5 : -0.95;
      this.shoulderR.rotation.x = low;
      this.shoulderL.rotation.x = low;
      this.shoulderL.rotation.z = 0.25;
      this.shoulderR.rotation.z = -0.25;
      this.elbowL.rotation.x = this.elbowR.rotation.x = -0.35;
      this.tool.rotation.x = v.swinging ? -1.0 : v.dragging ? 0.18 + Math.sin(this.phase * 2) * 0.03 : 0;
    } else {
      this.shoulderR.rotation.x = armAim + (v.firing ? Math.sin(this.phase * 9) * 0.04 : 0);
      this.shoulderR.rotation.z = -0.08;
      this.elbowR.rotation.x = -0.35;
      // mão livre: apoia a ferramenta ou puxa o elástico ao carregar
      this.shoulderL.rotation.x = armAim + 0.15 + (v.charging ? 0.25 : 0);
      this.shoulderL.rotation.z = 0.45;
      this.elbowL.rotation.x = v.charging ? -1.2 - v.charge * 0.4 : -0.7;
      this.tool.position.z = 0.26 - this.recoil * 0.06;
      if (walk > 0 && !v.firing && !v.charging) {
        // correndo sem atirar: braços acompanham a passada
        this.shoulderL.rotation.x = -0.4 - s * 0.6 * walk;
        this.shoulderL.rotation.z = 0.12;
        this.elbowL.rotation.x = -0.9;
      }
    }
    if (this.band) this.band.scaling.z = 1 + (v.charging ? v.charge * 2.6 : 0);
    this.tankLiquid.scaling.y = Math.max(0.03, v.ink / 100);

    this.looseLayer(dt, v, walk, run, s, celebrate, hurt);

    // ---------------- rosto: piscar, olhar, expressão ----------------
    this.blinkTimer -= dt;
    const blink = this.blinkTimer < 0.1 ? 0.12 : 1;
    if (this.blinkTimer < 0) this.blinkTimer = 2.3 + ((this.playerId * 7919) % 17) / 5;
    const squint = hurt > 0 ? 0.35 : v.firing || v.charging ? 0.82 : 1;
    this.eyes.scaling.y = blink * squint;
    this.pupils.scaling.y = blink * squint;
    this.pupils.position.y = -v.pitch * 0.02;
    const frown = v.firing || v.charging ? 0.42 : hurt > 0 ? 0.3 : celebrate > 0 ? -0.2 : 0;
    this.browL.rotation.z = (-0.12 + frown) * -1;
    this.browR.rotation.z = -0.12 + frown;
    this.browL.position.y = this.browR.position.y = 0.125 - frown * 0.02 + (celebrate > 0 ? 0.015 : 0);
    // boca: sorriso por padrão; reta concentrada ao mirar; "o" de dor; tristeza na derrota
    const sad = celebrate < 0 || hurt > 0.3;
    this.mouth.scaling.set(hurt > 0.3 ? 0.55 : v.firing || v.charging ? 0.8 : 1, sad ? -1 : v.firing || v.charging ? 0.35 : celebrate > 0 ? 1.5 : 1, 1);
    if (v.hp < this.lastHp - 0.5) this.hitReaction();
    this.lastHp = v.hp;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.toonState.flash = Math.min(0.6, this.flashTimer * 6);

    this.bubble.setEnabled(v.protected);
    if (v.protected) (this.bubble.material as ToonMaterial).alpha = 0.14 + Math.sin(performance.now() * 0.008) * 0.05;
    if (this.marker) this.marker.rotation.y += dt * 2;

    if (groundY !== null) {
      const h = v.pos[1] - groundY;
      this.shadow.setEnabled(h < 6 && !v.climbing && !v.submerged);
      this.shadow.position.y = groundY - v.pos[1] + 0.03;
      const sc = Math.max(0.35, 1 - h * 0.12) * (v.form === 1 ? 0.9 : 1.0);
      this.shadow.scaling.set(sc, 1, sc);
    } else this.shadow.setEnabled(false);
  }

  /**
   * Camada de "boneco de posto" controlado, somada por cima da pose-base. Mede velocidade,
   * aceleração e giro a partir do próprio estado visual e move só nós internos (tronco,
   * cabeça, cabelo, braços, pernas). O nó raiz (posição e rumo) nunca é alterado aqui.
   */
  private looseLayer(dt: number, v: CharacterVisual, walk: number, run: number, s: number, celebrate: number, hurt: number) {
    if (dt <= 0) return;
    const sp = this.sp;
    // velocidade/aceleração visuais (suavizadas); teleporte ou reaparecimento zera
    let vx = this.velS[0],
      vz = this.velS[1];
    if (this.prevPos) {
      const dx = v.pos[0] - this.prevPos[0],
        dz = v.pos[2] - this.prevPos[2];
      if (Math.hypot(dx, dz) > 3) this.velS = [0, 0];
      else {
        vx = dx / dt;
        vz = dz / dt;
      }
    }
    const k = Math.min(1, dt * 14);
    const ax = (vx - this.velS[0]) / dt,
      az = (vz - this.velS[1]) / dt;
    this.velS = [this.velS[0] + (vx - this.velS[0]) * k, this.velS[1] + (vz - this.velS[1]) * k];
    this.accS = [this.accS[0] + (clampAbs(ax, 60) - this.accS[0]) * k, this.accS[1] + (clampAbs(az, 60) - this.accS[1]) * k];
    let yawRate = 0;
    if (this.prevPos) {
      const dy = Math.atan2(Math.sin(v.yaw - this.prevYaw), Math.cos(v.yaw - this.prevYaw));
      yawRate = clampAbs(dy / dt, 14);
    }
    this.prevPos = [v.pos[0], v.pos[1], v.pos[2]];
    this.prevYaw = v.yaw;
    const fx = Math.sin(v.yaw),
      fz = Math.cos(v.yaw);
    const fwdAcc = this.accS[0] * fx + this.accS[1] * fz;
    const sideAcc = this.accS[0] * fz - this.accS[1] * fx;

    // precisão: mirar, disparar, carregar e ações de contato cortam o exagero (entra rápido, sai devagar)
    const precise = v.firing || v.charging || v.dragging || v.swinging || v.travel > 0 || v.climbing || v.form === 1;
    this.focus += ((precise ? 1 : 0) - this.focus) * Math.min(1, dt * (precise ? 16 : 3));
    const loose = 1 - 0.8 * this.focus;

    // inércia do tronco: atrasa ao acelerar, embala ao frear, inclina e torce nas curvas
    const lagX = sp.lagX.step(clampAbs(-fwdAcc * 0.012, 0.32) * loose, 110, 9, dt);
    const lagZ = sp.lagZ.step(clampAbs(-yawRate * 0.045 + sideAcc * 0.012, 0.3) * loose, 95, 8, dt);
    const twist = sp.twist.step(clampAbs(-yawRate * 0.05, 0.32) * loose, 80, 8, dt);
    this.torso.rotation.x += lagX;
    this.torso.rotation.z += lagZ;
    this.torso.rotation.y = twist;
    // cabeça segue o tronco com atraso e passa um pouco do ponto
    const headX = sp.headX.step(-lagX * 0.7, 70, 6, dt);
    const headZ = sp.headZ.step(-lagZ * 0.9 + twist * 0.2, 65, 5.5, dt);
    this.head.rotation.x += headX * (1 - this.focus * 0.7);
    this.head.rotation.z = headZ;
    // cabelo e rabo de cavalo: balançam com a aceleração, o giro e a subida/descida
    const hairX = sp.hairX.step(clampAbs(v.vy * 0.07 - fwdAcc * 0.018, 0.9), 55, 4, dt);
    const hairZ = sp.hairZ.step(clampAbs(yawRate * 0.08 - sideAcc * 0.02, 0.8), 50, 4, dt);
    if (this.pony) {
      this.pony.rotation.x += clampAbs(hairX, 0.7);
      this.pony.rotation.z += clampAbs(hairZ, 0.6);
    }

    const grounded = v.grounded && !v.climbing;
    // frenagem brusca: escorrega com os pés à frente e os braços jogados para a frente
    const speed = Math.hypot(this.velS[0], this.velS[1]);
    if (grounded && fwdAcc < -16 && speed < 3.2) this.brakeT = Math.max(this.brakeT, 0.32);
    this.brakeT = Math.max(0, this.brakeT - dt);
    const brake = this.brakeT > 0 ? Math.sin((this.brakeT / 0.32) * Math.PI) * loose : 0;
    if (brake > 0) {
      this.thighL.rotation.x -= 0.55 * brake;
      this.thighR.rotation.x -= 0.35 * brake;
      this.kneeL.rotation.x += 0.2 * brake;
      this.hips.position.y -= 0.035 * brake;
      this.torso.rotation.x -= 0.18 * brake;
    }
    this.flail = Math.max(0, this.flail - dt * 2.5);

    const t = this.idleT;
    if (celebrate > 0) {
      // vitória: rebolado, braços moles acenando fora de fase e cabeça balançando
      this.combat.rotation.y = Math.sin(t * 2.4) * 0.45;
      this.shoulderL.rotation.z = -0.35 - Math.abs(Math.sin(t * 7)) * 0.6;
      this.shoulderR.rotation.z = 0.35 + Math.abs(Math.sin(t * 7 + 1.4)) * 0.6;
      this.elbowL.rotation.x = -0.2 - Math.max(0, Math.sin(t * 7 + 0.8)) * 0.9;
      this.elbowR.rotation.x = -0.2 - Math.max(0, Math.sin(t * 7 + 2.2)) * 0.9;
      this.head.rotation.z += Math.sin(t * 5) * 0.25;
      this.torso.rotation.z += Math.sin(t * 2.4 + 0.6) * 0.12;
      return;
    }
    if (celebrate < 0) {
      // derrota: largado, braços pendurados balançando e cabeça "não acredito"
      this.combat.rotation.y = 0;
      this.shoulderL.rotation.x = 0.1 + Math.sin(t * 1.4) * 0.18;
      this.shoulderR.rotation.x = 0.1 + Math.sin(t * 1.4 + 0.5) * 0.18;
      this.head.rotation.y = Math.sin(t * 1.1) * 0.35;
      this.hips.position.y -= 0.05;
      this.kneeL.rotation.x = this.kneeR.rotation.x = 0.25;
      return;
    }
    this.combat.rotation.y = 0;
    if (this.focus > 0.95) return;
    const idle = (1 - walk) * (grounded ? 1 : 0);
    // braço livre: balanço exagerado e cotovelo mole na corrida; pendurado e oscilando parado
    const armSwing = s * (0.9 + run * 0.5) * walk;
    const floppy = Math.sin(this.phase + 1.3) * 0.45 * walk;
    const dangle = Math.sin(t * 1.7 + this.playerId) * 0.12;
    const freeArm = this.weaponId !== 'rodo';
    if (freeArm) {
      const lx = grounded ? (walk > 0.05 ? -0.35 - armSwing : -0.12 + dangle) : -2.1 + Math.sin(t * 15) * 0.35;
      this.shoulderL.rotation.x += (lx - this.shoulderL.rotation.x) * loose;
      this.shoulderL.rotation.z += ((grounded ? 0.16 + Math.abs(floppy) * 0.35 + idle * 0.05 : 0.7) - this.shoulderL.rotation.z) * loose;
      this.elbowL.rotation.x += ((grounded ? -0.35 - Math.max(0, floppy) * 1.1 - idle * 0.15 : -0.5) - this.elbowL.rotation.x) * loose;
      // mão da ferramenta: abaixa um pouco e balança quando não está mirando (volta rápido ao mirar)
      const rDown = grounded ? idle * 0.55 + walk * 0.25 : 0.35;
      this.shoulderR.rotation.x += (rDown + s * 0.25 * walk) * loose;
      this.shoulderR.rotation.z += (grounded ? -0.06 : -0.35) * loose;
    }
    // ao frear ou no pouso forte, os braços voam para a frente/para cima e voltam
    const toss = Math.max(brake, this.flail);
    if (toss > 0) {
      this.shoulderL.rotation.x -= 1.1 * toss;
      this.shoulderR.rotation.x -= 0.4 * toss;
      this.shoulderL.rotation.z += 0.3 * toss;
    }
    // parado: postura largada, peso trocando de lado e uma "sacudida" de vez em quando
    if (idle > 0) {
      const sway = Math.sin(t * 1.25 + this.playerId * 0.7);
      this.torso.rotation.x += 0.09 * idle * loose;
      this.torso.rotation.z += sway * 0.06 * idle * loose;
      this.hips.position.x = sway * 0.025 * idle * loose;
      this.hips.rotation.z = -sway * 0.05 * idle * loose;
      this.thighL.rotation.z = 0.06 * idle;
      this.thighR.rotation.z = -0.06 * idle;
      const fidget = Math.pow(Math.max(0, Math.sin(t * 0.55 + this.playerId * 1.9)), 12);
      this.head.rotation.z += fidget * 0.35 * loose;
      this.shoulderL.position.y = 0.38 + fidget * 0.05;
      this.shoulderR.position.y = 0.38 + fidget * 0.05;
    } else {
      this.hips.position.x = 0;
      this.hips.rotation.z = 0;
      this.thighL.rotation.z = this.thighR.rotation.z = 0;
      this.shoulderL.position.y = this.shoulderR.position.y = 0.38;
    }
    // no ar: braços abertos girando, pernas pedalando (só na subida e no topo)
    if (!grounded && !v.climbing) {
      const pedal = Math.sin(t * 16) * 0.35 * loose;
      this.thighL.rotation.x += pedal;
      this.thighR.rotation.x -= pedal;
    }
    void hurt;
  }

  muzzleWorld(): Vector3 {
    return this.tool.getAbsolutePosition().add(this.root.forward.scale(0.35));
  }

  /** Quantas malhas este personagem desenha agora (medição de custo). */
  activeMeshCount(): number {
    return this.root.getChildMeshes(false).filter((m) => m.isEnabled() && m.isVisible).length;
  }

  dispose() {
    // materiais compartilhados ficam com a cena; só os próprios são liberados
    this.root.dispose(false, false);
    for (const m of this.own) m.dispose();
  }
}

/** Perfil da camiseta (tronco): cintura, peito e ombros arredondados. */
function torsoProfile(): Vector3[] {
  return [
    new Vector3(0, 0.0, 0),
    new Vector3(0.17, 0.0, 0),
    new Vector3(0.19, 0.08, 0),
    new Vector3(0.2, 0.22, 0),
    new Vector3(0.21, 0.33, 0),
    new Vector3(0.18, 0.41, 0),
    new Vector3(0.09, 0.46, 0),
    new Vector3(0, 0.46, 0),
  ];
}

/** Jardineira: parte da frente/baixo do tronco, um pouco mais larga que a camiseta. */
function bibProfile(): Vector3[] {
  return [
    new Vector3(0, -0.01, 0),
    new Vector3(0.185, -0.01, 0),
    new Vector3(0.205, 0.08, 0),
    new Vector3(0.212, 0.2, 0),
    new Vector3(0.0, 0.2, 0),
  ];
}

function topProfile(): Vector3[] {
  return [
    new Vector3(0, 0.0, 0),
    new Vector3(0.05, 0.02, 0),
    new Vector3(0.2, 0.17, 0),
    new Vector3(0.4, 0.34, 0),
    new Vector3(0.42, 0.4, 0),
    new Vector3(0.34, 0.5, 0),
    new Vector3(0.18, 0.54, 0),
    new Vector3(0, 0.55, 0),
  ];
}

/**
 * Mola amortecida para movimento secundário (só apresentação). Semi-implícita e com
 * passo limitado: estável mesmo com quadros longos.
 */
class Spring {
  x = 0;
  v = 0;
  step(target: number, k: number, damping: number, dt: number): number {
    const h = Math.min(dt, 1 / 30);
    let n = Math.max(1, Math.ceil(dt / h));
    const hh = dt / n;
    while (n-- > 0) {
      this.v += (k * (target - this.x) - damping * this.v) * hh;
      this.x += this.v * hh;
    }
    return this.x;
  }
  reset() {
    this.x = 0;
    this.v = 0;
  }
}

const clampAbs = (x: number, m: number) => Math.max(-m, Math.min(m, x));
