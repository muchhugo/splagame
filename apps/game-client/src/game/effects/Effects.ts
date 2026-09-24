import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { TeamId, Vec3, WorldObjectState } from '@borrifo/game-contracts';
import { MORINGA, RODA_DE_OLEIRO } from '@borrifo/game-content';
import type { PhysicsWorld } from '@borrifo/game-simulation';

/** Pool de partículas por thin instances: memória fixa, sem crescer a cada tiro. */
class InstancePool {
  readonly mesh: Mesh;
  private matrices: Float32Array;
  private colors: Float32Array;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array;
  gravity: Float32Array;
  flat: Uint8Array;
  count = 0;
  private tmp = new Matrix();
  private tmpS = new Vector3();
  private tmpP = new Vector3();
  private q = Quaternion.Identity();
  private qFlat = Quaternion.RotationYawPitchRoll(0, 0, 0);

  constructor(
    scene: Scene,
    name: string,
    readonly capacity: number,
    make: () => Mesh,
    private readonly shrink = true,
  ) {
    this.mesh = make();
    this.mesh.name = name;
    this.matrices = new Float32Array(capacity * 16);
    this.colors = new Float32Array(capacity * 4);
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.flat = new Uint8Array(capacity);
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    // mantém ao menos 1 instância (escala zero) para o material compilar com cor por instância
    Matrix.ComposeToRef(Vector3.Zero(), Quaternion.Identity(), new Vector3(0, -500, 0), this.tmp);
    this.tmp.copyToArray(this.matrices, 0);
    this.mesh.thinInstanceCount = 1;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    void scene;
  }

  spawn(p: Vec3, v: Vec3, life: number, size: number, color: Color3, gravity = 18, flat = false) {
    let i = this.count;
    if (i >= this.capacity) {
      // pool cheio: substitui a partícula mais antiga (índice 0)
      i = 0;
    } else this.count++;
    this.pos.set(p, i * 3);
    this.vel.set(v, i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.gravity[i] = gravity;
    this.flat[i] = flat ? 1 : 0;
    this.colors.set([color.r, color.g, color.b, 1], i * 4);
  }

  update(dt: number) {
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      // compacta para o início
      if (n !== i) {
        this.pos.copyWithin(n * 3, i * 3, i * 3 + 3);
        this.vel.copyWithin(n * 3, i * 3, i * 3 + 3);
        this.colors.copyWithin(n * 4, i * 4, i * 4 + 4);
        this.maxLife[n] = this.maxLife[i];
        this.size[n] = this.size[i];
        this.gravity[n] = this.gravity[i];
        this.flat[n] = this.flat[i];
      }
      this.life[n] = life;
      const o = n * 3;
      this.vel[o + 1] -= this.gravity[n] * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const t = life / this.maxLife[n];
      const s = this.size[n] * (this.shrink ? Math.min(1, t * 2.2) : 0.3 + (1 - t) * 1.4);
      this.tmpS.set(s, this.flat[n] ? s * 0.12 : s, s);
      this.tmpP.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]);
      Matrix.ComposeToRef(this.tmpS, this.flat[n] ? this.qFlat : this.q, this.tmpP, this.tmp);
      this.tmp.copyToArray(this.matrices, n * 16);
      n++;
    }
    this.count = n;
    if (n === 0) {
      Matrix.ComposeToRef(Vector3.Zero(), this.q, new Vector3(0, -500, 0), this.tmp);
      this.tmp.copyToArray(this.matrices, 0);
    }
    this.mesh.thinInstanceCount = Math.max(1, n);
    this.mesh.thinInstanceBufferUpdated('matrix');
    this.mesh.thinInstanceBufferUpdated('color');
  }

  clear() {
    this.count = 0;
    Matrix.ComposeToRef(Vector3.Zero(), this.q, new Vector3(0, -500, 0), this.tmp);
    this.tmp.copyToArray(this.matrices, 0);
    this.mesh.thinInstanceCount = 1;
    this.mesh.thinInstanceBufferUpdated('matrix');
  }
}

interface VisualProjectile {
  pos: Vec3;
  vel: Vec3;
  age: number;
  gd: number;
  g: number;
  life: number;
  team: TeamId;
}

interface Beam {
  mesh: Mesh;
  mat: StandardMaterial;
  life: number;
}

/**
 * Efeitos visuais transitórios (tiros, respingos, ondas, feixes, objetos).
 * Tudo com limite: pools fixos e objetos removidos ao terminar.
 */
export class Effects {
  private droplets: InstancePool;
  private splash: InstancePool;
  private rings: InstancePool;
  private projectiles: VisualProjectile[] = [];
  private beams: Beam[] = [];
  private lasers = new Map<number, Beam>();
  private objects = new Map<number, { node: TransformNode; kind: 'moringa' | 'wheel'; ring?: Mesh; seen: number }>();
  private objectMats: StandardMaterial[] = [];
  private teamColors: [Color3, Color3];
  private ceramic = new Color3(0.95, 0.92, 0.85);
  private time = 0;
  private markers = new Map<number, { mesh: Mesh; life: number }>();
  reduceFlashes = false;

  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    teamColors: [Color3, Color3],
  ) {
    this.teamColors = teamColors;
    const unlit = (name: string, spec = 0.4) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = new Color3(1, 1, 1);
      m.specularColor = new Color3(spec, spec, spec);
      m.specularPower = 48;
      this.objectMats.push(m);
      return m;
    };
    this.droplets = new InstancePool(scene, 'gotas', 320, () => {
      const m = MeshBuilder.CreateSphere('gota', { diameter: 1, segments: 6 }, scene);
      m.material = unlit('mat-gotas', 0.8);
      return m;
    });
    this.splash = new InstancePool(scene, 'respingos', 1200, () => {
      const m = MeshBuilder.CreateSphere('respingo', { diameter: 1, segments: 4 }, scene);
      m.material = unlit('mat-respingos', 0.6);
      return m;
    });
    this.rings = new InstancePool(
      scene,
      'aneis',
      96,
      () => {
        const m = MeshBuilder.CreateTorus('anel', { diameter: 1, thickness: 0.12, tessellation: 24 }, scene);
        const mat = unlit('mat-aneis', 0.2);
        mat.alpha = 0.55;
        m.material = mat;
        return m;
      },
      false,
    );
  }

  setTeamColors(c: [Color3, Color3]) {
    this.teamColors = c;
  }

  color(team: TeamId) {
    return this.teamColors[team];
  }

  /** Projétil visual (previsão local ou evento remoto). Não tem autoridade. */
  shot(p: Vec3, v: Vec3, gd: number, g: number, life: number, team: TeamId) {
    if (this.projectiles.length > 160) this.projectiles.shift();
    this.projectiles.push({ pos: [...p] as Vec3, vel: [...v] as Vec3, age: 0, gd, g, life, team });
  }

  impact(p: Vec3, n: Vec3, team: TeamId, size = 1) {
    const c = this.teamColors[team];
    const count = Math.round(6 + size * 6);
    for (let i = 0; i < count; i++) {
      const r = () => Math.random() - 0.5;
      const sp = 2 + Math.random() * 3 * size;
      this.splash.spawn([p[0] + n[0] * 0.05, p[1] + n[1] * 0.05, p[2] + n[2] * 0.05], [n[0] * sp + r() * 3, n[1] * sp + r() * 3 + 1, n[2] * sp + r() * 3], 0.35 + Math.random() * 0.3, 0.06 + Math.random() * 0.08 * size, c, 16);
    }
  }

  burst(p: Vec3, team: TeamId, radius: number) {
    const c = this.teamColors[team];
    const n = this.reduceFlashes ? 40 : 90;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const sp = radius * (1.2 + Math.random() * 1.6);
      this.splash.spawn(p, [Math.cos(a) * sp, up * sp * 1.2, Math.sin(a) * sp], 0.5 + Math.random() * 0.4, 0.1 + Math.random() * 0.14, c, 14);
    }
    this.rings.spawn([p[0], p[1] - 0.2, p[2]], [0, 0, 0], 0.45, radius * 2, c, 0, true);
  }

  wave(p: Vec3, team: TeamId, radius: number) {
    this.rings.spawn([p[0], p[1] + 0.08, p[2]], [0, 0, 0], 0.7, radius * 2, this.teamColors[team], 0, true);
  }

  ripple(p: Vec3, team: TeamId, size = 0.8) {
    this.rings.spawn([p[0], p[1] + 0.03, p[2]], [0, 0, 0], 0.5, size, this.teamColors[team], 0, true);
  }

  elimination(p: Vec3, team: TeamId) {
    const c = this.teamColors[team];
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      this.splash.spawn([p[0], p[1] + 0.8, p[2]], [Math.cos(a) * sp, 2 + Math.random() * 5, Math.sin(a) * sp], 0.6 + Math.random() * 0.4, 0.08 + Math.random() * 0.12, c, 16);
    }
    // cacos de cerâmica estilizados (sem violência gráfica)
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this.splash.spawn([p[0], p[1] + 1.0, p[2]], [Math.cos(a) * 3, 3 + Math.random() * 3, Math.sin(a) * 3], 0.9, 0.16, this.ceramic, 18);
    }
  }

  respawn(p: Vec3, team: TeamId) {
    const c = this.teamColors[team];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.splash.spawn([p[0] + Math.cos(a) * 0.8, p[1] + 0.1, p[2] + Math.sin(a) * 0.8], [-Math.cos(a) * 1.5, 3.5, -Math.sin(a) * 1.5], 0.5, 0.1, c, 4);
    }
  }

  beam(from: Vec3, to: Vec3, team: TeamId, charge: number) {
    const dir = new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const len = dir.length();
    if (len < 0.1) return;
    let b = this.beams.find((x) => x.life <= 0);
    if (!b) {
      if (this.beams.length >= 10) b = this.beams[0];
      else {
        const mesh = MeshBuilder.CreateCylinder('feixe', { height: 1, diameter: 1, tessellation: 8 }, this.scene);
        const mat = new StandardMaterial('mat-feixe', this.scene);
        mat.disableLighting = true;
        mesh.material = mat;
        mesh.isPickable = false;
        this.objectMats.push(mat);
        b = { mesh, mat, life: 0 };
        this.beams.push(b);
      }
    }
    const c = this.teamColors[team];
    b.mat.emissiveColor = c.scale(1.2);
    b.mesh.setEnabled(true);
    b.life = 0.28;
    const mid = new Vector3((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
    b.mesh.position.copyFrom(mid);
    const d = 0.06 + charge * 0.1;
    b.mesh.scaling.set(d, len, d);
    b.mesh.rotationQuaternion = quatFromTo(Vector3.Up(), dir.normalize());
    // gotas ao longo do feixe
    for (let t = 0.1; t < 1; t += 0.12) this.splash.spawn([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t], [0, -1, 0], 0.4, 0.07, c, 8);
  }

  /** Mira do Estilingue carregando: visível para todos (sinalização ao adversário). */
  laser(playerId: number, from: Vector3, dir: Vector3, length: number, team: TeamId, charge: number) {
    let b = this.lasers.get(playerId);
    if (!b) {
      const mesh = MeshBuilder.CreateCylinder('laser', { height: 1, diameter: 1, tessellation: 6 }, this.scene);
      const mat = new StandardMaterial('mat-laser', this.scene);
      mat.disableLighting = true;
      mat.alpha = 0.55;
      mesh.material = mat;
      mesh.isPickable = false;
      this.objectMats.push(mat);
      b = { mesh, mat, life: 0 };
      this.lasers.set(playerId, b);
    }
    b.mat.emissiveColor = this.teamColors[team].scale(0.8 + charge);
    b.life = 0.1;
    b.mesh.setEnabled(true);
    const end = from.add(dir.scale(length));
    b.mesh.position.copyFrom(from.add(end).scale(0.5));
    const d = 0.015 + charge * 0.02;
    b.mesh.scaling.set(d, length, d);
    b.mesh.rotationQuaternion = quatFromTo(Vector3.Up(), dir);
  }

  landingMarker(id: number, p: Vec3, team: TeamId) {
    let m = this.markers.get(id);
    if (!m) {
      const mesh = MeshBuilder.CreateTorus('chegada', { diameter: 1.6, thickness: 0.1, tessellation: 28 }, this.scene);
      const mat = new StandardMaterial('mat-chegada', this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = this.teamColors[team];
      mesh.material = mat;
      this.objectMats.push(mat);
      m = { mesh, life: 0 };
      this.markers.set(id, m);
    }
    m.mesh.position.set(p[0], p[1] + 0.06, p[2]);
    m.life = 2.5;
    m.mesh.setEnabled(true);
  }

  clearLandingMarker(id: number) {
    const m = this.markers.get(id);
    if (m) m.life = 0;
  }

  /** Sincroniza Moringas armadas e Rodas de Oleiro com o snapshot do servidor. */
  syncObjects(list: WorldObjectState[]) {
    this.time += 0;
    const seen = new Set<number>();
    for (const o of list) {
      seen.add(o.id);
      let e = this.objects.get(o.id);
      if (!e) {
        e = this.makeObject(o);
        this.objects.set(o.id, e);
      }
      e.node.position.set(o.p[0], o.p[1], o.p[2]);
      e.seen = performance.now();
      if (o.kind === 'moringa') {
        const blink = o.t > 0 ? Math.sin(performance.now() * (0.02 + o.t * 0.05)) > 0 : false;
        e.node.scaling.setAll(1 + (blink ? 0.12 : 0) + o.t * 0.15);
      } else if (e.ring) {
        e.ring.setEnabled(o.t > 0);
      }
    }
    for (const [id, e] of this.objects) {
      if (!seen.has(id)) {
        e.node.dispose(false, false);
        this.objects.delete(id);
      }
    }
  }

  private makeObject(o: WorldObjectState) {
    const node = new TransformNode(`obj-${o.id}`, this.scene);
    const c = this.teamColors[o.team];
    const clay = new StandardMaterial('mat-barro-obj', this.scene);
    clay.diffuseColor = new Color3(0.72, 0.42, 0.25);
    clay.specularColor = new Color3(0.2, 0.2, 0.2);
    const team = new StandardMaterial('mat-equipe-obj', this.scene);
    team.diffuseColor = c;
    team.emissiveColor = c.scale(0.4);
    this.objectMats.push(clay, team);
    if (o.kind === 'moringa') {
      const body = MeshBuilder.CreateSphere('moringa', { diameter: MORINGA.radius * 2.2, segments: 10 }, this.scene);
      body.scaling.y = 1.15;
      body.material = clay;
      body.parent = node;
      const neck = MeshBuilder.CreateCylinder('gargalo', { height: 0.14, diameterTop: 0.08, diameterBottom: 0.12 }, this.scene);
      neck.position.y = 0.2;
      neck.material = clay;
      neck.parent = node;
      const band = MeshBuilder.CreateTorus('faixa', { diameter: 0.4, thickness: 0.05, tessellation: 16 }, this.scene);
      band.material = team;
      band.parent = node;
      return { node, kind: 'moringa' as const, seen: performance.now() };
    }
    const disc = MeshBuilder.CreateCylinder('roda', { height: 0.16, diameter: 1.1, tessellation: 24 }, this.scene);
    disc.position.y = 0.12;
    disc.material = clay;
    disc.parent = node;
    const lump = MeshBuilder.CreateSphere('barro', { diameter: 0.5, segments: 10 }, this.scene);
    lump.scaling.y = 0.8;
    lump.position.y = 0.4;
    lump.material = team;
    lump.parent = node;
    // aviso ao adversário: anel no chão com o alcance máximo
    const ring = MeshBuilder.CreateTorus('alcance', { diameter: RODA_DE_OLEIRO.waveRadius * 2, thickness: 0.08, tessellation: 64 }, this.scene);
    ring.position.y = 0.05;
    const rm = new StandardMaterial('mat-alcance', this.scene);
    rm.disableLighting = true;
    rm.emissiveColor = c;
    rm.alpha = 0.6;
    ring.material = rm;
    this.objectMats.push(rm);
    ring.parent = node;
    return { node, kind: 'wheel' as const, ring, seen: performance.now() };
  }

  update(dt: number) {
    this.time += dt;
    // projéteis visuais
    const keep: VisualProjectile[] = [];
    for (const p of this.projectiles) {
      const vy = p.age >= p.gd ? p.vel[1] - p.g * dt : p.vel[1];
      p.vel[1] = vy;
      const next: Vec3 = [p.pos[0] + p.vel[0] * dt, p.pos[1] + vy * dt, p.pos[2] + p.vel[2] * dt];
      const seg: Vec3 = [next[0] - p.pos[0], next[1] - p.pos[1], next[2] - p.pos[2]];
      const L = Math.hypot(seg[0], seg[1], seg[2]);
      const hit = L > 1e-4 ? this.physics.raycast(p.pos, [seg[0] / L, seg[1] / L, seg[2] / L], L) : null;
      p.age += dt;
      if (hit) {
        this.impact(hit.point, hit.normal, p.team, 0.5);
        continue;
      }
      p.pos = next;
      if (p.age > p.life) continue;
      keep.push(p);
      this.droplets.spawn(p.pos, [0, 0, 0], dt * 1.01, 0.17, this.teamColors[p.team], 0);
    }
    this.projectiles = keep;
    this.droplets.update(dt);
    this.splash.update(dt);
    this.rings.update(dt);
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      b.mesh.visibility = Math.max(0, b.life / 0.28);
      if (b.life <= 0) b.mesh.setEnabled(false);
    }
    for (const b of this.lasers.values()) {
      b.life -= dt;
      if (b.life <= 0) b.mesh.setEnabled(false);
    }
    for (const m of this.markers.values()) {
      m.life -= dt;
      m.mesh.rotation.y += dt * 2;
      m.mesh.setEnabled(m.life > 0);
    }
    for (const o of this.objects.values()) if (o.kind === 'wheel') o.node.rotation.y += dt * 9;
  }

  clearAll() {
    this.projectiles = [];
    this.droplets.clear();
    this.splash.clear();
    this.rings.clear();
    for (const e of this.objects.values()) e.node.dispose(false, false);
    this.objects.clear();
  }

  dispose() {
    this.clearAll();
    this.droplets.mesh.dispose();
    this.splash.mesh.dispose();
    this.rings.mesh.dispose();
    for (const b of this.beams) b.mesh.dispose();
    for (const b of this.lasers.values()) b.mesh.dispose();
    for (const m of this.markers.values()) m.mesh.dispose();
    for (const m of this.objectMats) m.dispose();
  }
}

export function quatFromTo(a: Vector3, b: Vector3): Quaternion {
  const axis = Vector3.Cross(a, b);
  const d = Vector3.Dot(a, b);
  if (d < -0.9999) return Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
  const q = new Quaternion(axis.x, axis.y, axis.z, 1 + d);
  q.normalize();
  return q;
}
