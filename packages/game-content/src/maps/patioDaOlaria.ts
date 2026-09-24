import type { BlockSpec, DecorSpec, MapSpec, MaterialId, RampRise, SidePaint, TopPaint } from '../mapSpec';
import { mirrorAabb, mirrorBlock, mirrorDecor, mirrorPoint } from '../mapSpec';
import type { Vec3 } from '@borrifo/game-contracts';

/**
 * Pátio da Olaria — arena original.
 *
 * Convenções: 1 unidade = 1 m, Y para cima. A turma Urucum (0) nasce no oeste
 * (x < 0); a turma Anil (1) no leste. A metade oeste é definida à mão e a leste é
 * gerada por simetria de ponto (rotação de 180°), garantindo oportunidades
 * equivalentes sem espelhar a decoração.
 *
 * Três linhas de progressão: norte (z > 8), central e sul (z < -8), separadas por
 * varais de secagem com vãos de conexão. Níveis: chão 0 m, tablado 1,0 m,
 * estrado central 1,2 m, galpão 1,6 m, topo dos varais 2,2 m, varanda 2,5 m,
 * topo do forno 3,5 m.
 */

function box(id: string, min: Vec3, max: Vec3, material: MaterialId, top: TopPaint, sides: SidePaint, style?: string): BlockSpec {
  return { id, shape: 'box', min, max, material, top, sides, ...(style ? { style } : {}) };
}

function ramp(id: string, min: Vec3, max: Vec3, rise: RampRise, material: MaterialId, style = 'ramp'): BlockSpec {
  // Rampas pontuam e suas faces laterais triangulares não são pintáveis nesta versão.
  return { id, shape: 'ramp', min, max, rise, material, top: 'score', sides: 'none', style };
}

/** Peças únicas, já simétricas por si. */
const global: BlockSpec[] = [
  box('chao', [-31, -1, -21], [31, 0, 21], 'terracota', 'score', 'none', 'ground'),
  box('muro_n', [-32, 0, 21], [32, 5, 22], 'muro', 'none', 'none', 'boundary'),
  box('muro_s', [-32, 0, -22], [32, 5, -21], 'muro', 'none', 'none', 'boundary'),
  box('muro_o', [-32, 0, -21], [-31, 5, 21], 'muro', 'none', 'none', 'boundary'),
  box('muro_l', [31, 0, -21], [32, 5, 21], 'muro', 'none', 'none', 'boundary'),
  box('estrado', [-4.5, 0, -4], [4.5, 1.2, 4], 'pedra', 'score', 'paint', 'plaza'),
  box('chamine', [-0.9, 1.2, -0.9], [0.9, 6.5, 0.9], 'azulejo', 'none', 'none', 'chimney'),
];

/** Metade oeste (turma Urucum) — espelhada para a leste. */
const half: BlockSpec[] = [
  // Galpão (base) com duas rampas frontais e escudo de spawn.
  box('galpao', [-31, 0, -7], [-24, 1.6, 7], 'madeira', 'score', 'paint', 'deck'),
  ramp('galpao_rampa_n', [-24, 0, 2.5], [-20, 1.6, 5.5], 'x-', 'madeira'),
  ramp('galpao_rampa_s', [-24, 0, -5.5], [-20, 1.6, -2.5], 'x-', 'madeira'),
  box('galpao_escudo', [-24.6, 1.6, -2.2], [-24, 2.7, 2.2], 'tijolo', 'paint', 'paint', 'lowwall'),
  box('galpao_poste_a', [-30.8, 1.6, 6.3], [-30.3, 5.4, 6.8], 'madeira', 'none', 'none', 'post'),
  box('galpao_poste_b', [-30.8, 1.6, -6.8], [-30.3, 5.4, -6.3], 'madeira', 'none', 'none', 'post'),
  box('galpao_poste_c', [-27.3, 1.6, 6.3], [-26.8, 5.4, 6.8], 'madeira', 'none', 'none', 'post'),
  box('galpao_poste_d', [-27.3, 1.6, -6.8], [-26.8, 5.4, -6.3], 'madeira', 'none', 'none', 'post'),
  box('galpao_telhado', [-31.2, 5.4, -7.3], [-26.4, 5.7, 7.3], 'barro', 'none', 'none', 'roof'),

  // Forno de queima na linha central: bloqueia a visão direta spawn ⇄ centro.
  box('forno', [-17, 0, -2], [-14, 3.5, 2], 'tijolo', 'paint', 'paint', 'kiln'),

  // Cobertura da linha central.
  box('caixote_c1', [-10.2, 0, 3.2], [-9, 1.2, 4.4], 'madeira', 'paint', 'paint', 'crate'),
  box('caixote_c2', [-11, 0, -5.2], [-9.8, 1.2, -4], 'madeira', 'paint', 'paint', 'crate'),
  box('mureta_c', [-7.8, 0, 1.2], [-7.3, 1.0, 3.6], 'tijolo', 'paint', 'paint', 'lowwall'),

  // Rampas do estrado central (oeste e norte; as opostas vêm do espelho).
  ramp('estrado_rampa_o', [-7.5, 0, -4], [-4.5, 1.2, -0.8], 'x+', 'pedra'),
  ramp('estrado_rampa_n', [0.8, 0, 4], [4.2, 1.2, 6.8], 'z-', 'pedra'),

  // Varais (divisores) entre linha norte e central.
  box('varal_n1', [-21, 0, 7.6], [-12.5, 2.2, 8.4], 'madeira', 'paint', 'paint', 'rack'),
  box('varal_n2', [-8.5, 0, 7.6], [-3.5, 2.2, 8.4], 'madeira', 'paint', 'paint', 'rack'),

  // Varanda elevada (noroeste): altura relevante com exposição.
  box('varanda', [-16, 0, 15], [-6, 2.5, 21], 'pedra', 'score', 'paint', 'balcony'),
  ramp('varanda_rampa', [-21, 0, 16.5], [-16, 2.5, 20.5], 'x+', 'pedra'),
  box('varanda_parapeito', [-12, 2.5, 15], [-9, 3.3, 15.4], 'tijolo', 'none', 'paint', 'parapet'),

  // Linha norte.
  box('caixote_n1', [-11.5, 0, 10.6], [-10.3, 1.2, 11.8], 'madeira', 'paint', 'paint', 'crate'),
  box('caixote_n2', [-4.2, 0, 12.6], [-3, 1.2, 13.8], 'madeira', 'paint', 'paint', 'crate'),
  box('caixote_n3', [-19.5, 0, 10.2], [-18.3, 1.2, 11.4], 'madeira', 'paint', 'paint', 'crate'),

  // Varais entre linha sul e central.
  box('varal_s1', [-20, 0, -8.4], [-13, 2.2, -7.6], 'madeira', 'paint', 'paint', 'rack'),
  box('varal_s2', [-9.5, 0, -8.4], [-5, 2.2, -7.6], 'madeira', 'paint', 'paint', 'rack'),

  // Tablado baixo (sudoeste) com pilha de telhas.
  box('tablado', [-15, 0, -17], [-8, 1.0, -11], 'madeira', 'score', 'paint', 'platform'),
  ramp('tablado_rampa', [-18, 0, -15.5], [-15, 1.0, -12.5], 'x+', 'madeira'),
  box('telhas', [-12, 1.0, -15], [-11, 2.3, -13], 'barro', 'none', 'paint', 'tiles'),
  box('pilar_s1', [-5, 0, -15.5], [-4, 2.8, -14.5], 'tijolo', 'none', 'paint', 'pillar'),
  box('pilar_s2', [-21.5, 0, -17.5], [-20.5, 2.8, -16.5], 'tijolo', 'none', 'paint', 'pillar'),

  // Muro escalável no quintal sudoeste.
  box('muro_sw', [-27, 0, -15], [-26, 3.2, -9], 'tijolo', 'paint', 'paint', 'wall'),
];

const decorHalf: DecorSpec[] = [
  { kind: 'bandeirinhas', pos: [-30.5, 5.3, 6.5], to: [-14, 4.2, 20.8] },
  { kind: 'bandeirinhas', pos: [-30.5, 5.3, -6.5], to: [-14, 4.2, -20.8] },
  { kind: 'bandeirinhas', pos: [-15.5, 3.7, 0], to: [-1, 6.3, 0] },
  { kind: 'potes', pos: [-24, 5.0, 21.5], variant: 0 },
  { kind: 'potes', pos: [-10, 5.0, -21.5], variant: 1 },
  { kind: 'potes', pos: [-31.5, 5.0, 12], variant: 2 },
  { kind: 'lampiao', pos: [-24.3, 2.7, 0] },
  { kind: 'lampiao', pos: [-16, 3.5, 21.4] },
  { kind: 'fornoBoca', pos: [-14, 0, 0], yaw: Math.PI / 2 },
  { kind: 'arvore', pos: [-36, 0, 12], scale: 1.2, variant: 0 },
  { kind: 'arvore', pos: [-38, 0, -8], scale: 1.4, variant: 1 },
  { kind: 'arvore', pos: [-18, 0, 27], scale: 1.3, variant: 1 },
  { kind: 'arvore', pos: [-4, 0, -28], scale: 1.1, variant: 0 },
  { kind: 'casa', pos: [-40, 0, -22], yaw: 0.4, variant: 0 },
  { kind: 'casa', pos: [-28, 0, 31], yaw: -0.2, variant: 1 },
];

function spawnsFor(sign: 1 | -1) {
  // longe do muro de fundo para a câmera ter espaço atrás do personagem
  const pts: Vec3[] = [
    [-27.2, 1.6, -3.2],
    [-27.2, 1.6, 3.2],
    [-25.8, 1.6, -1.3],
    [-25.8, 1.6, 1.3],
  ];
  return pts.map((p) => ({ pos: sign === 1 ? p : mirrorPoint(p), yaw: sign === 1 ? Math.PI / 2 : -Math.PI / 2 }));
}

const spawnZone0 = { min: [-31, 1.2, -7] as Vec3, max: [-24, 5.3, 7] as Vec3 };

export const PATIO_DA_OLARIA: MapSpec = {
  id: 'patio-da-olaria',
  name: 'Pátio da Olaria',
  version: 1,
  cellSize: 0.25,
  bounds: { min: [-31, -2, -21], max: [31, 12, 21] },
  killY: -6,
  blocks: [...global, ...half, ...half.map((b) => mirrorBlock(b))],
  spawns: { 0: spawnsFor(1), 1: spawnsFor(-1) },
  spawnZones: { 0: spawnZone0, 1: mirrorAabb(spawnZone0) },
  decor: [
    ...decorHalf,
    ...decorHalf.filter((d) => d.kind !== 'arvore' && d.kind !== 'casa').map(mirrorDecor),
    { kind: 'arvore', pos: [37, 0, -11], scale: 1.3, variant: 1 },
    { kind: 'arvore', pos: [36, 0, 9], scale: 1.1, variant: 0 },
    { kind: 'arvore', pos: [15, 0, -28], scale: 1.4, variant: 0 },
    { kind: 'arvore', pos: [6, 0, 29], scale: 1.2, variant: 1 },
    { kind: 'casa', pos: [41, 0, 20], yaw: 2.9, variant: 1 },
    { kind: 'casa', pos: [22, 0, -32], yaw: 0.1, variant: 0 },
    { kind: 'fumaca', pos: [0, 6.6, 0] },
  ],
  lighting: {
    sunDirection: [-0.45, -0.62, 0.64],
    sunColor: [1.0, 0.86, 0.68],
    skyTop: [0.33, 0.52, 0.86],
    skyHorizon: [1.0, 0.8, 0.62],
    ambient: [0.46, 0.44, 0.52],
    fogColor: [0.98, 0.82, 0.68],
    fogDensity: 0.006,
  },
};
