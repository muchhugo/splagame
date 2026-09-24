import type { TeamId, Vec3 } from '@borrifo/game-contracts';
import type { Aabb, BlockSpec, DecorSpec, MapObjectives, MapSpec, MapVariant, MaterialId, RampRise, SidePaint, SpawnPoint, TopPaint } from '../mapSpec';
import { mirrorAabb, mirrorBlock, mirrorDecor, mirrorPoint } from '../mapSpec';

/**
 * Kit de peças reutilizáveis para montar arenas. Cada peça devolve blocos da
 * METADE OESTE (turma 0); `assembleMap` espelha por simetria de ponto (180° em Y),
 * garantindo oportunidades equivalentes. Peças centrais (x = 0) vão em `global`
 * e precisam ser simétricas por si mesmas.
 *
 * Convenções: 1 unidade = 1 m, Y para cima, chão em y = 0. Alturas legíveis:
 * mureta 1,0 · base 1,6 · varal/cobogó 2,2 · praça 2,4 · varanda 2,5.
 */

export function box(id: string, min: Vec3, max: Vec3, material: MaterialId, top: TopPaint, sides: SidePaint, style?: string, tint?: Vec3): BlockSpec {
  return { id, shape: 'box', min, max, material, top, sides, ...(style ? { style } : {}), ...(tint ? { tint } : {}) };
}

/** Rampas pontuam; laterais triangulares não são pintáveis. */
export function ramp(id: string, min: Vec3, max: Vec3, rise: RampRise, material: MaterialId, tint?: Vec3): BlockSpec {
  return { id, shape: 'ramp', min, max, rise, material, top: 'score', sides: 'none', style: 'ramp', ...(tint ? { tint } : {}) };
}

/** Colisor sem malha (a forma visível é decoração: estátua, totem). */
export function hidden(id: string, min: Vec3, max: Vec3): BlockSpec {
  return { ...box(id, min, max, 'azulejo', 'none', 'none', 'hidden'), hidden: true };
}

/** Piso retangular + muros de contorno não pintáveis. `holes` recorta o piso (ex.: piscina). */
export function arena(L: number, W: number, opts: { floor?: MaterialId; wall?: MaterialId; wallH?: number; floorBottom?: number; holes?: Aabb[]; floorTint?: Vec3; wallTint?: Vec3 } = {}): BlockSpec[] {
  const floor = opts.floor ?? 'terracota';
  const wall = opts.wall ?? 'muro';
  const h = opts.wallH ?? 4;
  const fb = opts.floorBottom ?? -1;
  const out: BlockSpec[] = [];
  const holes = opts.holes ?? [];
  if (!holes.length) out.push(box('chao', [-L, fb, -W], [L, 0, W], floor, 'score', 'none', 'ground', opts.floorTint));
  else {
    // um único furo central simétrico: quatro faixas ao redor (oeste, leste, norte, sul)
    const hl = holes[0];
    out.push(box('chao_o', [-L, fb, -W], [hl.min[0], 0, W], floor, 'score', 'none', 'ground', opts.floorTint));
    out.push(box('chao_l', [hl.max[0], fb, -W], [L, 0, W], floor, 'score', 'none', 'ground', opts.floorTint));
    out.push(box('chao_n', [hl.min[0], fb, hl.max[2]], [hl.max[0], 0, W], floor, 'score', 'none', 'ground', opts.floorTint));
    out.push(box('chao_s', [hl.min[0], fb, -W], [hl.max[0], 0, hl.min[2]], floor, 'score', 'none', 'ground', opts.floorTint));
  }
  out.push(
    box('muro_n', [-L - 1, 0, W], [L + 1, h, W + 1], wall, 'none', 'none', 'boundary', opts.wallTint),
    box('muro_s', [-L - 1, 0, -W - 1], [L + 1, h, -W], wall, 'none', 'none', 'boundary', opts.wallTint),
    box('muro_o', [-L - 1, 0, -W], [-L, h, W], wall, 'none', 'none', 'boundary', opts.wallTint),
    box('muro_l', [L, 0, -W], [L + 1, h, W], wall, 'none', 'none', 'boundary', opts.wallTint),
  );
  return out;
}

export interface BaseOptions {
  /** x da parede de fundo (negativo). */
  x0: number;
  depth?: number;
  halfWidth?: number;
  height?: number;
  /** Centro (|z|) das rampas frontais. */
  rampZ?: number;
  /** Saídas laterais (norte/sul) além das frontais. */
  sideExits?: boolean;
  material?: MaterialId;
  tint?: Vec3;
  roof?: boolean;
  prefix?: string;
}

/**
 * Base de turma elevada com escudo frontal (corta a linha de tiro até o spawn),
 * duas rampas frontais, saídas laterais opcionais, paletes nas quinas e telhado.
 * Devolve blocos, oito pontos de nascimento (voltados para as rampas) e a zona protegida.
 */
export function teamBase(o: BaseOptions): { blocks: BlockSpec[]; spawns: Vec3[]; zone: Aabb; frontX: number } {
  const d = o.depth ?? 7;
  const hw = o.halfWidth ?? 7;
  const h = o.height ?? 1.6;
  const rz = o.rampZ ?? 4;
  const mat = o.material ?? 'madeira';
  const p = o.prefix ?? 'base';
  const x0 = o.x0;
  const x1 = x0 + d;
  const b: BlockSpec[] = [
    box(`${p}`, [x0, 0, -hw], [x1, h, hw], mat, 'score', 'paint', 'deck', o.tint),
    ramp(`${p}_rampa_n`, [x1, 0, rz - 1.5], [x1 + 4, h, rz + 1.5], 'x-', mat, o.tint),
    ramp(`${p}_rampa_s`, [x1, 0, -rz - 1.5], [x1 + 4, h, -rz + 1.5], 'x-', mat, o.tint),
    box(`${p}_escudo`, [x1 - 0.6, h, -2.2], [x1, h + 1.1, 2.2], 'tijolo', 'paint', 'paint', 'lowwall'),
    box(`${p}_palete_n`, [x1 - 1, h, hw - 1.1], [x1, h + 1.7, hw], 'madeira', 'none', 'paint', 'crate'),
    box(`${p}_palete_s`, [x1 - 1, h, -hw], [x1, h + 1.7, -hw + 1.1], 'madeira', 'none', 'paint', 'crate'),
  ];
  if (o.sideExits !== false) {
    b.push(
      ramp(`${p}_saida_n`, [x0 + 0.8, 0, hw], [x0 + 3.8, h, hw + 4], 'z-', mat, o.tint),
      ramp(`${p}_saida_s`, [x0 + 0.8, 0, -hw - 4], [x0 + 3.8, h, -hw], 'z+', mat, o.tint),
    );
  }
  if (o.roof !== false) {
    const top = h + 3.8;
    for (const [id, x, z] of [['a', x0 + 0.2, hw - 0.7], ['b', x0 + 0.2, -hw + 0.2], ['c', x0 + 3.7, hw - 0.7], ['d', x0 + 3.7, -hw + 0.2]] as const)
      b.push(box(`${p}_poste_${id}`, [x, h, z], [x + 0.5, top, z + 0.5], 'madeira', 'none', 'none', 'post'));
    b.push(box(`${p}_telhado`, [x0 - 0.2, top, -hw - 0.3], [x0 + 4.6, top + 0.3, hw + 0.3], 'barro', 'none', 'none', 'roof'));
  }
  const zs = [rz - 0.6, rz + 0.6].flatMap((z) => [z, -z]);
  const spawns: Vec3[] = [];
  for (const x of [x1 - 2.2, x1 - 4.4]) for (const z of zs) spawns.push([x, h, z]);
  return { blocks: b, spawns, zone: { min: [x0, h - 0.4, -hw], max: [x1, h + 3.7, hw] }, frontX: x1 };
}

/** Praça central elevada com passagem inferior sob uma ponte (simétrica por si só). */
export function centralPlaza(o: { hx: number; hz: number; h?: number; gap?: number; material?: MaterialId; bridge?: MaterialId; tint?: Vec3 }): BlockSpec[] {
  const h = o.h ?? 2.4;
  const g = o.gap ?? 1.5;
  const m = o.material ?? 'pedra';
  return [
    box('praca_norte', [-o.hx, 0, g], [o.hx, h, o.hz], m, 'score', 'paint', 'plaza', o.tint),
    box('praca_sul', [-o.hx, 0, -o.hz], [o.hx, h, -g], m, 'score', 'paint', 'plaza', o.tint),
    box('praca_ponte', [-o.hx, h - 0.35, -g], [o.hx, h, g], o.bridge ?? 'madeira', 'score', 'paint', 'bridge'),
  ];
}

export function crate(id: string, x: number, z: number, s = 1.2, h = 1.2, style = 'crate', material: MaterialId = 'madeira', tint?: Vec3): BlockSpec {
  return box(id, [x - s / 2, 0, z - s / 2], [x + s / 2, h, z + s / 2], material, 'paint', 'paint', style, tint);
}

/** Divisória ao longo de X (varal, cobogó, mureta). */
export function wallX(id: string, x0: number, x1: number, z: number, h: number, style: string, material: MaterialId = 'madeira', t = 0.8, tint?: Vec3): BlockSpec {
  return box(id, [x0, 0, z - t / 2], [x1, h, z + t / 2], material, 'paint', 'paint', style, tint);
}
/** Divisória ao longo de Z. */
export function wallZ(id: string, z0: number, z1: number, x: number, h: number, style: string, material: MaterialId = 'tijolo', t = 0.5, tint?: Vec3): BlockSpec {
  return box(id, [x - t / 2, 0, z0], [x + t / 2, h, z1], material, 'paint', 'paint', style, tint);
}

/**
 * Plataforma elevada com rampas nas pontas leste/oeste (rota alternativa, nunca beco).
 * `parapet` acrescenta uma mureta baixa no meio da borda interna.
 */
export function platform(id: string, min: [number, number], max: [number, number], h: number, o: { material?: MaterialId; style?: string; rampW?: number; rampLen?: number; parapetZ?: number; tint?: Vec3; ramps?: Array<'o' | 'l'> } = {}): BlockSpec[] {
  const m = o.material ?? 'pedra';
  const rw = o.rampW ?? 3;
  const rl = o.rampLen ?? h * 2;
  const zc = (min[1] + max[1]) / 2;
  const out: BlockSpec[] = [box(id, [min[0], 0, min[1]], [max[0], h, max[1]], m, 'score', 'paint', o.style ?? 'balcony', o.tint)];
  const ramps = o.ramps ?? ['o', 'l'];
  if (ramps.includes('o')) out.push(ramp(`${id}_rampa_o`, [min[0] - rl, 0, zc - rw / 2], [min[0], h, zc + rw / 2], 'x+', m, o.tint));
  if (ramps.includes('l')) out.push(ramp(`${id}_rampa_l`, [max[0], 0, zc - rw / 2], [max[0] + rl, h, zc + rw / 2], 'x-', m, o.tint));
  if (o.parapetZ !== undefined) {
    const cx = (min[0] + max[0]) / 2;
    out.push(box(`${id}_parapeito`, [cx - 1.5, h, o.parapetZ - 0.2], [cx + 1.5, h + 0.8, o.parapetZ + 0.2], 'tijolo', 'none', 'paint', 'parapet'));
  }
  return out;
}

/** Construção com corredor atravessável (vestiário, oficina). Topo pontuável, paredes escaláveis quando pintadas. */
export function hallBuilding(id: string, x: [number, number], z: [number, number], h: number, corridor: [number, number], o: { material?: MaterialId; style?: string; tint?: Vec3; clearance?: number } = {}): BlockSpec[] {
  const m = o.material ?? 'reboco';
  const st = o.style ?? 'building';
  const cl = o.clearance ?? 2.4;
  return [
    box(`${id}_a`, [x[0], 0, corridor[1]], [x[1], h, z[1]], m, 'score', 'paint', st, o.tint),
    box(`${id}_b`, [x[0], 0, z[0]], [x[1], h, corridor[0]], m, 'score', 'paint', st, o.tint),
    box(`${id}_teto`, [x[0], cl, corridor[0]], [x[1], h, corridor[1]], m, 'score', 'paint', st, o.tint),
  ];
}

/** Arquibancada em degraus de 0,5 m ao longo de X, subindo para longe do centro (|z| crescente). */
export function bleachers(id: string, x: [number, number], zFront: number, steps: number, stepDepth = 1.4, stepH = 0.5, tint?: Vec3): BlockSpec[] {
  const dir = zFront < 0 ? -1 : 1;
  const out: BlockSpec[] = [];
  for (let i = 0; i < steps; i++) {
    const za = zFront + dir * i * stepDepth;
    const zb = za + dir * stepDepth;
    out.push(box(`${id}_${i}`, [x[0], 0, Math.min(za, zb)], [x[1], stepH * (i + 1), Math.max(za, zb)], 'reboco', 'score', 'paint', 'bleacher', tint));
  }
  return out;
}

export interface MapHalf {
  global: BlockSpec[];
  half: BlockSpec[];
  spawns0: Vec3[];
  zone0: Aabb;
  decorHalf?: DecorSpec[];
  /** Decoração única (não espelhada). */
  decorGlobal?: DecorSpec[];
  /** Decoração só da metade oeste que NÃO deve ser espelhada (entorno assimétrico). */
  decorWestOnly?: DecorSpec[];
  /** Objetivos da metade oeste; `center` é o ponto da cápsula. */
  objectivesHalf: { stations: Vec3[]; pickups: Array<{ pos: Vec3; kind: 'embalo' | 'folego' }> };
  capsule: Vec3;
}

/** Monta um MapSpec completo por simetria de ponto. */
export function assembleMap(meta: { id: string; family: string; familyName: string; variant: MapVariant; version: number; L: number; W: number; lighting: MapSpec['lighting']; players: [number, number] }, h: MapHalf): MapSpec {
  const yaw0 = Math.PI / 2;
  const spawnsFor = (team: TeamId): SpawnPoint[] => h.spawns0.map((p) => ({ pos: team === 0 ? p : mirrorPoint(p), yaw: team === 0 ? yaw0 : -yaw0 }));
  const objectives: MapObjectives = {
    capsule: h.capsule,
    // estações em pares simétricos, intercaladas (a sequência do servidor alterna os lados)
    stations: h.objectivesHalf.stations.flatMap((s) => [s, mirrorPoint(s)]),
    pickups: h.objectivesHalf.pickups.flatMap((p) => [p, { pos: mirrorPoint(p.pos), kind: p.kind }]),
  };
  return {
    id: meta.id,
    family: meta.family,
    name: meta.familyName,
    variant: meta.variant,
    players: meta.players,
    version: meta.version,
    cellSize: 0.25,
    bounds: { min: [-meta.L, -3, -meta.W], max: [meta.L, 14, meta.W] },
    killY: -8,
    blocks: [...h.global, ...h.half, ...h.half.map((b) => mirrorBlock(b))],
    spawns: { 0: spawnsFor(0), 1: spawnsFor(1) },
    spawnZones: { 0: h.zone0, 1: mirrorAabb(h.zone0) },
    objectives,
    decor: [...(h.decorHalf ?? []), ...(h.decorHalf ?? []).map(mirrorDecor), ...(h.decorGlobal ?? []), ...(h.decorWestOnly ?? [])],
    lighting: meta.lighting,
  };
}
