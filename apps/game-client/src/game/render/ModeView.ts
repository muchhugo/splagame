import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { ObjectiveSnapshot, PickupSnapshot, TeamId, Vec3 } from '@borrifo/game-contracts';
import { CORREIO, type MapSpec } from '@borrifo/game-content';
import { ToonMaterial } from './ToonMaterial';

/**
 * Visual dos modos: cápsula do Correio do Ara (com feixe público enquanto carregada),
 * estações (ativa com anel de preparo por equipe e progresso de entrega) e pickups de
 * buff. Formas e ícones próprios; nada disso cruza a mira nem imita ataques.
 */
export class ModeView {
  private root: TransformNode;
  private capsule: TransformNode;
  private capsuleBody: Mesh;
  private capsuleMat: ToonMaterial;
  private beam: Mesh;
  private beamMat: StandardMaterial;
  private stations: Array<{ node: TransformNode; ring: Mesh; fill0: Mesh; fill1: Mesh; progress: Mesh }> = [];
  private stationMat: StandardMaterial;
  private stationIdleMat: StandardMaterial;
  private fillMats: [StandardMaterial, StandardMaterial];
  private progressMat: StandardMaterial;
  private pickups: Array<{ node: TransformNode; icon: TransformNode; base: Mesh; timer: Mesh; kind: 'embalo' | 'folego' }> = [];
  private own: Array<{ dispose(): void }> = [];
  private t = 0;
  private obj: ObjectiveSnapshot | null = null;
  private pk: PickupSnapshot[] = [];
  private capsulePos = new Vector3();
  private teamColors: [Color3, Color3];

  constructor(
    private readonly scene: Scene,
    private readonly map: MapSpec,
    colors: [Color3, Color3],
  ) {
    this.teamColors = colors;
    this.root = new TransformNode('modos', scene);
    const std = (name: string, c: Color3, alpha = 1) => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true;
      m.emissiveColor = c;
      m.alpha = alpha;
      m.backFaceCulling = false;
      this.own.push(m);
      return m;
    };

    // cápsula de pigmento: frasco com tampas de latão e faixas (neutra = dourada)
    this.capsule = new TransformNode('capsula', scene);
    this.capsule.parent = this.root;
    this.capsuleMat = new ToonMaterial('capsula-mat', scene, new Color3(1.0, 0.8, 0.3), 1);
    this.capsuleMat.setEmissive(new Color3(0.25, 0.18, 0.05));
    this.own.push(this.capsuleMat);
    this.capsuleBody = MeshBuilder.CreateCapsule('capsula-corpo', { radius: 0.24, height: 0.8, tessellation: 14 }, scene);
    this.capsuleBody.material = this.capsuleMat;
    this.capsuleBody.parent = this.capsule;
    this.capsuleBody.renderOutline = true;
    this.capsuleBody.outlineWidth = 0.02;
    this.capsuleBody.outlineColor = new Color3(0.2, 0.12, 0.1);
    const brass = new ToonMaterial('capsula-latao', scene, new Color3(0.95, 0.72, 0.3), 0.9);
    this.own.push(brass);
    for (const y of [-0.34, 0.34]) {
      const cap = MeshBuilder.CreateCylinder('capsula-tampa', { height: 0.1, diameter: 0.36, tessellation: 14 }, scene);
      cap.material = brass;
      cap.parent = this.capsule;
      cap.position.y = y;
    }
    // feixe vertical: a posição da cápsula é informação pública do modo
    this.beamMat = std('feixe', new Color3(1, 0.85, 0.4), 0.28);
    this.beam = MeshBuilder.CreateCylinder('feixe', { height: 14, diameterTop: 0.25, diameterBottom: 0.6, tessellation: 12, cap: Mesh.NO_CAP }, scene);
    this.beam.material = this.beamMat;
    this.beam.parent = this.capsule;
    this.beam.position.y = 7;
    this.beam.isPickable = false;

    // estações: anel neutro; a ativa ganha preenchimento por equipe e o progresso da entrega
    this.stationMat = std('estacao', new Color3(1, 0.95, 0.8), 0.9);
    this.stationIdleMat = std('estacao-inativa', new Color3(0.95, 0.9, 0.8), 0.35);
    this.fillMats = [std('estacao-t0', colors[0], 0.55), std('estacao-t1', colors[1], 0.55)];
    this.progressMat = std('estacao-prog', new Color3(1, 1, 1), 0.95);
    const R = CORREIO.stationRadius;
    for (const [i, p] of map.objectives.stations.entries()) {
      const node = new TransformNode(`estacao-${i}`, scene);
      node.parent = this.root;
      node.position.set(p[0], p[1] + 0.06, p[2]);
      const ring = MeshBuilder.CreateTorus(`estacao-anel-${i}`, { diameter: R * 2, thickness: 0.12, tessellation: 40 }, scene);
      ring.parent = node;
      ring.material = this.stationIdleMat;
      const arc = (name: string, radius: number, mat: StandardMaterial) => {
        const m = MeshBuilder.CreateTorus(name, { diameter: radius * 2, thickness: 0.16, tessellation: 40 }, scene);
        m.parent = node;
        m.material = mat;
        m.setEnabled(false);
        return m;
      };
      const fill0 = arc(`estacao-t0-${i}`, R - 0.25, this.fillMats[0]);
      const fill1 = arc(`estacao-t1-${i}`, R - 0.45, this.fillMats[1]);
      const progress = arc(`estacao-prog-${i}`, R + 0.25, this.progressMat);
      this.stations.push({ node, ring, fill0, fill1, progress });
    }

    // pickups: Embalo (setas duplas) e Fôlego (gota), girando sobre uma base com anel de reaparecimento
    const embaloMat = new ToonMaterial('embalo', scene, new Color3(1.0, 0.62, 0.2), 0.8);
    embaloMat.setEmissive(new Color3(0.3, 0.15, 0.02));
    const folegoMat = new ToonMaterial('folego', scene, new Color3(0.3, 0.78, 0.95), 0.9);
    folegoMat.setEmissive(new Color3(0.05, 0.18, 0.25));
    const baseMat = new ToonMaterial('pickup-base', scene, new Color3(0.98, 0.95, 0.88), 0.3);
    const timerMat = std('pickup-timer', new Color3(1, 1, 1), 0.7);
    this.own.push(embaloMat, folegoMat, baseMat);
    for (const [i, p] of map.objectives.pickups.entries()) {
      const node = new TransformNode(`pickup-${i}`, scene);
      node.parent = this.root;
      node.position.set(p.pos[0], p.pos[1], p.pos[2]);
      const base = MeshBuilder.CreateCylinder(`pickup-base-${i}`, { height: 0.08, diameter: 1.1, tessellation: 24 }, scene);
      base.parent = node;
      base.position.y = 0.04;
      base.material = baseMat;
      const timer = MeshBuilder.CreateTorus(`pickup-timer-${i}`, { diameter: 1.2, thickness: 0.06, tessellation: 32 }, scene);
      timer.parent = node;
      timer.position.y = 0.09;
      timer.material = timerMat;
      const icon = new TransformNode(`pickup-icon-${i}`, scene);
      icon.parent = node;
      icon.position.y = 0.95;
      if (p.kind === 'embalo') {
        for (const z of [-0.14, 0.14]) {
          const chev = MeshBuilder.CreateCylinder('seta', { height: 0.14, diameterTop: 0, diameterBottom: 0.46, tessellation: 3 }, scene);
          chev.rotation.x = Math.PI / 2;
          chev.position.z = z;
          chev.parent = icon;
          chev.material = embaloMat;
        }
      } else {
        const drop = MeshBuilder.CreateSphere('gota', { diameter: 0.42, segments: 12 }, scene);
        drop.parent = icon;
        drop.material = folegoMat;
        const tip = MeshBuilder.CreateCylinder('gota-ponta', { height: 0.3, diameterTop: 0, diameterBottom: 0.36, tessellation: 12 }, scene);
        tip.position.y = 0.22;
        tip.parent = icon;
        tip.material = folegoMat;
      }
      this.pickups.push({ node, icon, base, timer, kind: p.kind });
    }
    this.root.setEnabled(false);
    for (const m of this.root.getChildMeshes()) m.isPickable = false;
  }

  setTeamColors(c: [Color3, Color3]) {
    this.teamColors = c;
    this.fillMats[0].emissiveColor = c[0];
    this.fillMats[1].emissiveColor = c[1];
  }

  setSnapshot(obj: ObjectiveSnapshot | undefined, pk: PickupSnapshot[] | undefined) {
    this.obj = obj ?? null;
    this.pk = pk ?? [];
  }

  /** `carrierPos`: posição renderizada do portador (suaviza a cápsula junto do personagem). */
  update(dt: number, active: boolean, carrierPos: (id: number) => Vec3 | null, carrierTeam: (id: number) => TeamId | null) {
    this.root.setEnabled(active);
    if (!active) return;
    this.t += dt;
    const o = this.obj;
    const hasObj = !!o && this.map.objectives.stations.length > 0;
    this.capsule.setEnabled(hasObj && o!.st !== 'aguardando' && o!.st !== 'entregue');
    for (const s of this.stations) s.node.setEnabled(hasObj);
    if (o && hasObj) {
      let target = new Vector3(o.p[0], o.p[1] + 0.9, o.p[2]);
      if (o.c !== null) {
        const cp = carrierPos(o.c);
        if (cp) target = new Vector3(cp[0], cp[1] + 1.95, cp[2]);
      }
      const k = Math.min(1, dt * 14);
      this.capsulePos.addInPlace(target.subtract(this.capsulePos).scale(k));
      if (Vector3.Distance(this.capsulePos, target) > 4) this.capsulePos.copyFrom(target);
      this.capsule.position.copyFrom(this.capsulePos);
      this.capsule.rotation.y += dt * 1.8;
      const bob = o.c === null ? Math.sin(this.t * 2.4) * 0.08 : 0;
      this.capsuleBody.position.y = bob;
      const team = o.c !== null ? carrierTeam(o.c) : null;
      const col = team === null ? new Color3(1.0, 0.8, 0.3) : this.teamColors[team];
      this.capsuleMat.color = col;
      this.beamMat.emissiveColor = team === null ? new Color3(1, 0.85, 0.4) : col;
      // caída: pisca devagar; retornando: some aos poucos
      this.beam.setEnabled(o.st !== 'retornando');
      this.capsuleBody.visibility = o.st === 'caida' ? 0.65 + Math.sin(this.t * 6) * 0.3 : o.st === 'retornando' ? Math.max(0.1, 1 - (1.5 - o.t) / 1.5) : 1;
      for (const [i, s] of this.stations.entries()) {
        const isActive = i === o.s;
        s.ring.material = isActive ? this.stationMat : this.stationIdleMat;
        s.ring.scaling.setAll(isActive ? 1 + Math.sin(this.t * 3) * 0.02 : 1);
        s.fill0.setEnabled(isActive && o.sp[0] > 0.01);
        s.fill1.setEnabled(isActive && o.sp[1] > 0.01);
        // preenchimento por equipe: espessura cresce com a fração pintada (60% = anel cheio)
        const f0 = Math.min(1, o.sp[0] / CORREIO.stationPaintShare);
        const f1 = Math.min(1, o.sp[1] / CORREIO.stationPaintShare);
        s.fill0.scaling.set(1, 0.4 + f0 * 1.6, 1);
        s.fill1.scaling.set(1, 0.4 + f1 * 1.6, 1);
        s.fill0.visibility = 0.35 + f0 * 0.6;
        s.fill1.visibility = 0.35 + f1 * 0.6;
        s.progress.setEnabled(isActive && o.pr > 0);
        s.progress.scaling.setAll(0.6 + o.pr * 0.4);
      }
    }
    // pickups
    for (const p of this.pickups) {
      const snap = this.pk.find((x) => this.pickups[x.i] === p);
      const avail = snap?.a === 1;
      p.icon.setEnabled(avail);
      p.icon.rotation.y += dt * 2.2;
      p.icon.position.y = 0.95 + Math.sin(this.t * 2 + p.node.position.x) * 0.08;
      p.timer.setEnabled(!avail && !!snap);
      if (snap && !avail) p.timer.scaling.setAll(Math.max(0.15, 1 - snap.t / 20));
    }
  }

  dispose() {
    this.root.dispose(false, false);
    for (const o of this.own) o.dispose();
  }
}
