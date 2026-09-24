import { describe, expect, it, beforeAll } from 'vitest';
import { MAPS } from '@borrifo/game-content';
import { PhysicsWorld, initPhysics } from '@borrifo/game-simulation';
import { findLobbySpot } from '../src/game/render/lobbySpot';

beforeAll(async () => {
  await initPhysics();
});

describe('palco do lobby em todas as variantes', () => {
  for (const map of Object.values(MAPS)) {
    it(`${map.id}: trecho plano e livre, câmera com visão para o grupo`, () => {
      const pw = new PhysicsWorld(map);
      const t0 = performance.now();
      const s = findLobbySpot(pw, map);
      const ms = performance.now() - t0;
      expect(s.found).toBe(true);
      // determinístico
      expect(findLobbySpot(pw, map)).toEqual(s);
      // câmera geral fora do sólido e com visão do centro do palco
      const cam: [number, number, number] = [s.c[0] + s.d[0] * s.camDist, s.c[1] + s.camH, s.c[2] + s.d[1] * s.camDist];
      expect(pw.pointInsideWorld(cam)).toBe(false);
      expect(pw.segmentBlocked(cam, [s.c[0], s.c[1] + 1, s.c[2]])).toBe(false);
      // longe das zonas de spawn não é exigência, mas precisa estar dentro dos limites
      expect(s.c[0]).toBeGreaterThan(map.bounds.min[0]);
      expect(s.c[0]).toBeLessThan(map.bounds.max[0]);
      expect(ms).toBeLessThan(4000);
      pw.dispose();
    });
  }
});
