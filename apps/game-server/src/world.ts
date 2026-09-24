import { MAPS, computeMapHash, type MapSpec } from '@borrifo/game-content';
import { NavGraph, PaintLayout, PhysicsWorld, initPhysics } from '@borrifo/game-simulation';

export interface StaticWorld {
  map: MapSpec;
  mapHash: string;
  layout: PaintLayout;
  nav: NavGraph;
}

const cache = new Map<string, Promise<StaticWorld>>();
const ready = new Map<string, StaticWorld>();

/**
 * Dados estáticos derivados do mapa (layout de tinta, grafo de navegação),
 * construídos uma vez por processo. O mundo de física é por sala e por rodada.
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
      const w = { map, mapHash: computeMapHash(map), layout, nav };
      ready.set(mapId, w);
      return w;
    })();
    cache.set(mapId, p);
  }
  return p;
}

/** Pré-carrega TODAS as variantes (na subida do servidor): a escolha por rodada fica síncrona. */
export async function preloadAllWorlds(): Promise<void> {
  await Promise.all(Object.keys(MAPS).map(loadStaticWorld));
}

/** Mundo já carregado (depois de `preloadAllWorlds`). */
export function staticWorld(mapId: string): StaticWorld {
  const w = ready.get(mapId);
  if (!w) throw new Error(`mapa não pré-carregado: ${mapId}`);
  return w;
}
