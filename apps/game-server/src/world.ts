import { MAPS, computeMapHash, type MapSpec } from '@borrifo/game-content';
import { NavGraph, PaintLayout, PhysicsWorld, initPhysics } from '@borrifo/game-simulation';

export interface StaticWorld {
  map: MapSpec;
  mapHash: string;
  layout: PaintLayout;
  nav: NavGraph;
}

const cache = new Map<string, Promise<StaticWorld>>();

/**
 * Dados estáticos derivados do mapa (layout de tinta, grafo de navegação),
 * construídos uma vez por processo. O mundo de física é por sala.
 */
export function loadStaticWorld(mapId: string): Promise<StaticWorld> {
  let p = cache.get(mapId);
  if (!p) {
    p = (async () => {
      const map = MAPS[mapId];
      if (!map) throw new Error(`mapa desconhecido: ${mapId}`);
      await initPhysics();
      const layout = PaintLayout.build(map);
      const tmp = new PhysicsWorld(map);
      const nav = NavGraph.build(map, layout, tmp);
      tmp.dispose();
      return { map, mapHash: computeMapHash(map), layout, nav };
    })();
    cache.set(mapId, p);
  }
  return p;
}
