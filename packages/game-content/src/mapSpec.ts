import type { TeamId, Vec3 } from '@borrifo/game-contracts';

/**
 * Materiais visuais. A pintabilidade NÃO é deduzida do material: ela é declarada
 * por face (top/sides). O renderer usa o material para acabamento e para sinalizar
 * superfícies não pintáveis (azulejo esmaltado).
 */
export type MaterialId = 'terracota' | 'tijolo' | 'madeira' | 'azulejo' | 'pedra' | 'barro' | 'latao' | 'muro' | 'reboco' | 'ladrilho' | 'piscina' | 'cimento';

/** 'score' = pintável e conta no placar; 'paint' = pintável sem pontuar; 'none' = não pintável. */
export type TopPaint = 'score' | 'paint' | 'none';
/** Faces laterais pintáveis são também escaláveis na forma de fluxo. */
export type SidePaint = 'paint' | 'none';

export type RampRise = 'x+' | 'x-' | 'z+' | 'z-';

export interface BlockSpec {
  id: string;
  shape: 'box' | 'ramp';
  min: Vec3;
  max: Vec3;
  /** Rampa: direção em que a altura aumenta. */
  rise?: RampRise;
  material: MaterialId;
  top: TopPaint;
  sides: SidePaint;
  /** Dica para o renderer (ex.: 'kiln', 'crate', 'rack'). */
  style?: string;
  /** Só colisor: sem faces renderizadas nem tinta (ex.: corpo da estátua, cuja malha é decoração). */
  hidden?: boolean;
  /** Cor-base visual (RGB 0..1) no lugar da cor padrão do material; não muda regra. */
  tint?: Vec3;
}

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface DecorSpec {
  kind: string;
  pos: Vec3;
  yaw?: number;
  scale?: number;
  /** Cor/variação cosmética. */
  variant?: number;
  /** Pontos extras (ex.: varal de bandeirinhas: ponto final). */
  to?: Vec3;
}

/** Perfil de tamanho: compacto 2–4, padrão 6–8, ampliado 10–16 participantes ativos (com bots). */
export type MapVariant = 'compacto' | 'padrao' | 'ampliado';
export const MAP_VARIANTS: readonly MapVariant[] = ['compacto', 'padrao', 'ampliado'];

/** Pontos de objetivo usados pelos modos (entram no hash: mudam a jogabilidade). */
export interface MapObjectives {
  /** Onde a cápsula do Correio do Ara aparece (centro disputável). */
  capsule: Vec3;
  /** Estações de entrega neutras, em pares simétricos [oeste, leste, oeste, leste…]. */
  stations: Vec3[];
  /** Pickups de buff (Embalo/Fôlego), em pares simétricos. */
  pickups: Array<{ pos: Vec3; kind: 'embalo' | 'folego' }>;
}

export interface MapSpec {
  /** Id único da variante (ex.: 'toca-do-ara.padrao'). */
  id: string;
  /** Família do mapa (ex.: 'toca-do-ara'); o nome é o mesmo nas três variantes. */
  family: string;
  name: string;
  variant: MapVariant;
  /** Faixa de participantes ativos (incluindo bots) para a qual a variante foi desenhada. */
  players: [number, number];
  version: number;
  cellSize: number;
  bounds: Aabb;
  killY: number;
  blocks: BlockSpec[];
  spawns: Record<TeamId, SpawnPoint[]>;
  spawnZones: Record<TeamId, Aabb>;
  objectives: MapObjectives;
  decor: DecorSpec[];
  lighting: {
    sunDirection: Vec3;
    sunColor: Vec3;
    skyTop: Vec3;
    skyHorizon: Vec3;
    ambient: Vec3;
    /** Multiplicador de cor das sombras (matiz frio no estilo cartoon). */
    shadowTint: Vec3;
    fogColor: Vec3;
    fogDensity: number;
  };
}

/** Espelhamento por simetria de ponto (rotação de 180° em torno do eixo Y). */
export function mirrorBlock(b: BlockSpec, idSuffix = '_m'): BlockSpec {
  const rise: Record<RampRise, RampRise> = { 'x+': 'x-', 'x-': 'x+', 'z+': 'z-', 'z-': 'z+' };
  return {
    ...b,
    id: b.id + idSuffix,
    min: [-b.max[0], b.min[1], -b.max[2]],
    max: [-b.min[0], b.max[1], -b.min[2]],
    ...(b.rise ? { rise: rise[b.rise] } : {}),
  };
}

export function mirrorPoint(p: Vec3): Vec3 {
  return [-p[0], p[1], -p[2]];
}

export function mirrorAabb(a: Aabb): Aabb {
  return { min: [-a.max[0], a.min[1], -a.max[2]], max: [-a.min[0], a.max[1], -a.min[2]] };
}

export function mirrorDecor(d: DecorSpec): DecorSpec {
  return {
    ...d,
    pos: mirrorPoint(d.pos),
    ...(d.yaw !== undefined ? { yaw: d.yaw + Math.PI } : {}),
    ...(d.to ? { to: mirrorPoint(d.to) } : {}),
  };
}

/** Stringify estável (chaves ordenadas) para hash de versão do mapa. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])).join(',') + '}';
}

/** cyrb53 — hash de 53 bits, suficiente para detectar versões incompatíveis. */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

/**
 * Hash dos dados relevantes à jogabilidade (geometria, pintura, spawns, célula).
 * Decoração e iluminação ficam fora: não alteram colisão nem pontuação.
 */
export function computeMapHash(map: MapSpec): string {
  return cyrb53(
    stableStringify({
      id: map.id,
      version: map.version,
      cellSize: map.cellSize,
      bounds: map.bounds,
      blocks: map.blocks,
      spawns: map.spawns,
      spawnZones: map.spawnZones,
      objectives: map.objectives,
      variant: map.variant,
    }),
  );
}
