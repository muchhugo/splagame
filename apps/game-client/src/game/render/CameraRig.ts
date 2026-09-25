import { FreeCamera, Scene, Vector3 } from '../babylon';
import type { Vec3 } from '@borrifo/game-contracts';
import type { PhysicsWorld } from '@borrifo/game-simulation';

/**
 * Câmera em terceira pessoa sobre o ombro: deslocamento lateral ajustável,
 * suavização moderada, colisão com o cenário e tremor opcional.
 */
export class CameraRig {
  readonly camera: FreeCamera;
  private dist = 4.2;
  private pivotH = 1.35;
  private shakeT = 0;
  private shakeAmp = 0;
  reduceShake = false;
  shoulder = 0.55;

  constructor(
    scene: Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.camera = new FreeCamera('camera', new Vector3(0, 5, -10), scene);
    this.camera.minZ = 0.05;
    this.camera.maxZ = 900;
    this.camera.inputs.clear();
    this.camera.fov = (72 * Math.PI) / 180;
  }

  setFov(deg: number) {
    this.camera.fov = (deg * Math.PI) / 180;
  }

  shake(amount: number) {
    if (this.reduceShake) return;
    this.shakeAmp = Math.min(0.25, this.shakeAmp + amount);
    this.shakeT = 0.25;
  }

  update(dt: number, feet: Vec3, yaw: number, pitch: number, compact: boolean) {
    const targetH = compact ? 0.95 : 1.35;
    this.pivotH += (targetH - this.pivotH) * Math.min(1, dt * 10);
    const pivot = new Vector3(feet[0], feet[1] + this.pivotH, feet[2]);
    const cp = Math.cos(pitch);
    const fwd = new Vector3(Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp);
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const wantDist = 4.2 + Math.max(0, pitch) * 0.6;
    const offset = right.scale(this.shoulder).add(new Vector3(0, 0.4, 0)).subtract(fwd.scale(wantDist));
    const len = offset.length();
    const dir = offset.scale(1 / len);
    const hit = this.physics.raycast([pivot.x, pivot.y, pivot.z], [dir.x, dir.y, dir.z], len + 0.3);
    const allowed = hit ? Math.max(0.35, hit.toi - 0.3) : len;
    // aproxima rápido ao colidir, afasta devagar ao liberar
    const k = allowed < this.dist ? 25 : 4;
    this.dist += (Math.min(allowed, len) - this.dist) * Math.min(1, dt * k);
    const pos = pivot.add(dir.scale(this.dist));
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * (this.shakeT / 0.25);
      pos.addInPlace(new Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a));
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    this.camera.position.copyFrom(pos);
    this.camera.rotation.set(pitch, yaw, 0);
  }

  forward(): Vec3 {
    const f = this.camera.getDirection(Vector3.Forward());
    return [f.x, f.y, f.z];
  }

  position(): Vec3 {
    const p = this.camera.position;
    return [p.x, p.y, p.z];
  }
}
