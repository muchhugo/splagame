import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from '@borrifo/game-contracts';
import type { MapSpec, MovementTuning } from '@borrifo/game-content';
import { rampVertices } from '../map/geometry';

let initPromise: Promise<void> | null = null;

/** Inicializa o WASM do Rapier uma única vez (cliente e servidor). */
export function initPhysics(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      // O pacote compat emite um aviso sobre parâmetros de init obsoletos; silenciamos só esse.
      const warn = console.warn;
      console.warn = (...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].includes('deprecated parameters for the initialization function')) return;
        warn(...args);
      };
      try {
        await RAPIER.init();
      } finally {
        console.warn = warn;
      }
    })();
  }
  return initPromise;
}

const GROUP_WORLD = 0x0001;
const GROUP_PLAYER = 0x0002;
/** membership << 16 | filter */
const WORLD_COLLIDER_GROUPS = (GROUP_WORLD << 16) | 0xffff;
const PLAYER_COLLIDER_GROUPS = (GROUP_PLAYER << 16) | GROUP_WORLD;
/** Consultas que só enxergam o cenário estático. */
export const WORLD_QUERY_GROUPS = (GROUP_WORLD << 16) | GROUP_WORLD;

export interface RayHit {
  toi: number;
  point: Vec3;
  normal: Vec3;
}

export interface MoveResult {
  moved: Vec3;
  grounded: boolean;
  /** Normais de contato (saindo do obstáculo) e pontos de contato. */
  contacts: Array<{ normal: Vec3; point: Vec3 }>;
}

/**
 * Mundo de colisão estático construído do MapSpec. Sem renderer, sem DOM:
 * usado igualmente pelo servidor autoritativo e pela previsão do cliente.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private disposed = false;

  constructor(readonly map: MapSpec) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    for (const b of map.blocks) {
      let desc: RAPIER.ColliderDesc | null;
      if (b.shape === 'box') {
        const hx = (b.max[0] - b.min[0]) / 2;
        const hy = (b.max[1] - b.min[1]) / 2;
        const hz = (b.max[2] - b.min[2]) / 2;
        desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(b.min[0] + hx, b.min[1] + hy, b.min[2] + hz);
      } else {
        const pts = rampVertices(b).flat();
        desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      }
      if (!desc) throw new Error(`collider inválido para ${b.id}`);
      desc.setCollisionGroups(WORLD_COLLIDER_GROUPS).setFriction(0);
      this.world.createCollider(desc);
    }
    // Um passo para montar a estrutura de aceleração das consultas.
    this.world.step();
  }

  /** Raycast apenas contra o cenário. `dir` deve ser unitário. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number): RayHit | null {
    // um raio reutilizado: consulta quente (projéteis, linha de visão dos bots, pickups)
    const ray = (this.ray ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }));
    ray.origin.x = origin[0];
    ray.origin.y = origin[1];
    ray.origin.z = origin[2];
    ray.dir.x = dir[0];
    ray.dir.y = dir[1];
    ray.dir.z = dir[2];
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, WORLD_QUERY_GROUPS);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      toi: t,
      point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t],
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
    };
  }

  /** Verdadeiro se o cenário obstrui o segmento (com folga no final). */
  segmentBlocked(from: Vec3, to: Vec3, endMargin = 0.05): boolean {
    const dx = to[0] - from[0],
      dy = to[1] - from[1],
      dz = to[2] - from[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return false;
    const d = this.segDir;
    d[0] = dx / L;
    d[1] = dy / L;
    d[2] = dz / L;
    const hit = this.raycast(from, d, L);
    return !!hit && hit.toi < L - endMargin;
  }
  private ray: RAPIER.Ray | null = null;
  private readonly segDir: Vec3 = [0, 0, 0];

  /** Teste de ponto dentro do cenário sólido. */
  pointInsideWorld(p: Vec3): boolean {
    let inside = false;
    this.world.intersectionsWithPoint(
      { x: p[0], y: p[1], z: p[2] },
      () => {
        inside = true;
        return false;
      },
      undefined,
      WORLD_QUERY_GROUPS,
    );
    return inside;
  }

  createCharacter(tuning: MovementTuning): CharacterBody {
    return new CharacterBody(this, tuning);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.world.free();
  }
}

/**
 * Corpo cinemático do personagem (cápsula). Usa o controlador de personagem do
 * Rapier: degraus, rampas, deslizamento e snap ao chão.
 */
export class CharacterBody {
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly centerOffset: number;
  private snapEnabled = true;

  constructor(
    private readonly pw: PhysicsWorld,
    readonly tuning: MovementTuning,
  ) {
    const desc = RAPIER.ColliderDesc.capsule(tuning.capsuleHalfHeight, tuning.capsuleRadius).setSensor(true).setCollisionGroups(PLAYER_COLLIDER_GROUPS);
    this.collider = pw.world.createCollider(desc);
    this.centerOffset = tuning.capsuleHalfHeight + tuning.capsuleRadius;
    this.controller = pw.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(tuning.stepHeight, 0.15, false);
    this.controller.setMaxSlopeClimbAngle((tuning.maxSlopeDeg * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle(((tuning.maxSlopeDeg + 4) * Math.PI) / 180);
    this.controller.enableSnapToGround(0.3);
  }

  setSnap(on: boolean) {
    if (on === this.snapEnabled) return;
    this.snapEnabled = on;
    if (on) this.controller.enableSnapToGround(0.3);
    else this.controller.disableSnapToGround();
  }

  /** Move a cápsula a partir da posição dos pés; retorna o deslocamento efetivo. */
  move(feet: Vec3, desired: Vec3): MoveResult {
    this.collider.setTranslation({ x: feet[0], y: feet[1] + this.centerOffset, z: feet[2] });
    this.controller.computeColliderMovement(this.collider, { x: desired[0], y: desired[1], z: desired[2] }, undefined, WORLD_QUERY_GROUPS);
    const m = this.controller.computedMovement();
    const contacts: MoveResult['contacts'] = [];
    const n = this.controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const c = this.controller.computedCollision(i);
      if (!c) continue;
      contacts.push({ normal: [c.normal1.x, c.normal1.y, c.normal1.z], point: [c.witness1.x, c.witness1.y, c.witness1.z] });
    }
    const moved: Vec3 = [m.x, m.y, m.z];
    const grounded = this.controller.computedGrounded();
    // Correção de penetração: o controlador do Rapier 0.20, com deslizamento ligado, deixa a
    // cápsula afundar devagar num piso plano em alguns pontos (ex.: diagonal x = z de um bloco)
    // quando o movimento é só vertical. Se os pés terminaram abaixo de um piso quase plano
    // logo acima, sobe até ele. Determinístico: servidor e previsão aplicam o mesmo.
    if (grounded || moved[1] < 0) {
      const f: Vec3 = [feet[0] + moved[0], feet[1] + moved[1], feet[2] + moved[2]];
      const hit = this.pw.raycast([f[0], f[1] + 0.4, f[2]], [0, -1, 0], 0.45);
      if (hit && hit.normal[1] > 0.7 && hit.point[1] > f[1] + 1e-3) moved[1] += hit.point[1] - f[1];
    }
    return { moved, grounded, contacts };
  }

  /** Há espaço livre para a cápsula nesta posição dos pés? */
  fits(feet: Vec3): boolean {
    let blocked = false;
    const shape = new RAPIER.Capsule(this.tuning.capsuleHalfHeight, this.tuning.capsuleRadius - 0.02);
    this.pw.world.intersectionsWithShape(
      { x: feet[0], y: feet[1] + this.centerOffset + 0.02, z: feet[2] },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      () => {
        blocked = true;
        return false;
      },
      undefined,
      WORLD_QUERY_GROUPS,
    );
    return !blocked;
  }

  dispose() {
    try {
      this.pw.world.removeCharacterController(this.controller);
      this.pw.world.removeCollider(this.collider, false);
    } catch {
      /* mundo já liberado */
    }
  }
}
