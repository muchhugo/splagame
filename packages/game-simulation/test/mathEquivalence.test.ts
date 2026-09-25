import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@borrifo/game-contracts';
import { Rng, addScaled, clamp, dist, dot, sub, segmentCapsuleHit, closestSegmentSegment } from '../src/math';

// referência: a implementação anterior (com vetores alocados), para provar que a versão
// sem alocação dá EXATAMENTE o mesmo resultado (servidor e previsão dependem disso)
function refClosest(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) return { s: 0, t: 0, dist: Math.hypot(r[0], r[1], r[2]) };
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
  return { s, t, dist: dist(addScaled(p1, d1, s), addScaled(p2, d2, t)) };
}
function refCapsule(p0: Vec3, p1: Vec3, base: Vec3, height: number, radius: number) {
  const res = refClosest(p0, p1, [base[0], base[1] + radius, base[2]], [base[0], base[1] + Math.max(radius, height - radius), base[2]]);
  if (res.dist > radius) return -1;
  const segLen = dist(p0, p1);
  if (segLen < 1e-6) return 0;
  return clamp(res.s - Math.sqrt(Math.max(0, radius * radius - res.dist * res.dist)) / segLen, 0, 1);
}

describe('matemática sem alocação: mesmo resultado bit a bit', () => {
  it('segmento × segmento e segmento × cápsula em 20 000 casos aleatórios (e degenerados)', () => {
    const r = new Rng(99);
    const v = (): Vec3 => [r.range(-10, 10), r.range(-2, 6), r.range(-10, 10)];
    for (let i = 0; i < 20000; i++) {
      const p1 = v(), q1 = i % 50 === 0 ? ([...p1] as Vec3) : v(), p2 = v(), q2 = i % 70 === 0 ? ([...p2] as Vec3) : v();
      expect(closestSegmentSegment(p1, q1, p2, q2)).toEqual(refClosest(p1, q1, p2, q2));
      const base = v();
      const h = r.range(0.5, 2.2), rad = r.range(0.2, 0.8);
      // perto da cápsula metade das vezes, para exercitar o caso de acerto
      const a = i % 2 ? v() : ([base[0] + r.range(-1, 1), base[1] + r.range(0, 2), base[2] + r.range(-1, 1)] as Vec3);
      const b = v();
      expect(segmentCapsuleHit(a, b, base, h, rad)).toBe(refCapsule(a, b, base, h, rad));
    }
  });
});
