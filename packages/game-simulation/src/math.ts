import type { Vec3 } from '@borrifo/game-contracts';

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}
export function copy3(a: Vec3): Vec3 {
  return [a[0], a[1], a[2]];
}
export function isFiniteVec(a: Vec3): boolean {
  return Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);
}

/** Direção de mira: yaw 0 = +Z, pitch positivo = para baixo (convenção do projeto). */
export function aimDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp];
}
export function forwardFromYaw(yaw: number): Vec3 {
  return [Math.sin(yaw), 0, Math.cos(yaw)];
}
export function rightFromYaw(yaw: number): Vec3 {
  return [Math.cos(yaw), 0, -Math.sin(yaw)];
}
export function yawFromDir(d: Vec3): number {
  return Math.atan2(d[0], d[2]);
}
export function pitchFromDir(d: Vec3): number {
  return -Math.asin(clamp(d[1] / (len(d) || 1), -1, 1));
}

/** PRNG determinístico (mulberry32) — sementes controladas no servidor e nos testes. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** Aproximadamente normal (soma de uniformes). */
  gauss(): number {
    return (this.next() + this.next() + this.next() - 1.5) * 1.1547;
  }
}

/** Interseção segmento–cápsula vertical (eixo Y). Retorna t ∈ [0,1] ou -1. */
export function segmentCapsuleHit(p0: Vec3, p1: Vec3, base: Vec3, height: number, radius: number): number {
  // Aproxima a cápsula por cilindro com tampas esféricas, amostrando o segmento
  // pela distância mínima entre o segmento e o eixo da cápsula.
  const a0: Vec3 = [base[0], base[1] + radius, base[2]];
  const a1: Vec3 = [base[0], base[1] + Math.max(radius, height - radius), base[2]];
  const res = closestSegmentSegment(p0, p1, a0, a1);
  if (res.dist > radius) return -1;
  // Recuo aproximado até a superfície para obter o primeiro contato.
  const segLen = dist(p0, p1);
  if (segLen < 1e-6) return 0;
  const back = Math.sqrt(Math.max(0, radius * radius - res.dist * res.dist)) / segLen;
  return clamp(res.s - back, 0, 1);
}

export function closestSegmentSegment(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): { s: number; t: number; dist: number } {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    return { s: 0, t: 0, dist: len(r) };
  }
  if (a <= 1e-9) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-9) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const c1 = addScaled(p1, d1, s);
  const c2 = addScaled(p2, d2, t);
  return { s, t, dist: dist(c1, c2) };
}
