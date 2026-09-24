import type { BlockSpec, DecorSpec, MapSpec, MaterialId, RampRise, SidePaint, TopPaint } from '../mapSpec';
import { mirrorAabb, mirrorBlock, mirrorDecor, mirrorPoint } from '../mapSpec';
import type { Vec3 } from '@borrifo/game-contracts';

/**
 * Pátio da Olaria (v2) — arena original.
 *
 * Convenções: 1 unidade = 1 m, Y para cima. Urucum (0) nasce no oeste; Anil (1)
 * no leste. A metade oeste é definida à mão; a leste vem por simetria de ponto
 * (rotação de 180°): oportunidades equivalentes sem espelhar a decoração.
 *
 * Estrutura de jogo:
 * - Praça da Roda (centro): estrado elevado a 2,4 m com PASSAGEM INFERIOR sob
 *   uma ponte, quatro rampas (duas por turma, em lados rotacionados), paredes
 *   escaláveis quando pintadas e a estátua do Bibelô Gigante como cobertura/marco.
 * - Três linhas: norte (z > 8), central e sul (z < -8), separadas por varais
 *   altos alternados com muretas baixas (trechos protegidos e abertos).
 * - Galpões (bases) com QUATRO saídas legíveis: duas rampas frontais e duas
 *   laterais; escudo e paletes cortam linhas de tiro diretas ao spawn.
 * - Varanda elevada com duas rampas (rota alternativa contestável, não beco).
 * - Níveis: chão 0 · muretas 1,0 · tablado 1,0 · galpão 1,6 · varais 2,2 ·
 *   praça 2,4 · varanda 2,5 · forno 3,5.
 */

function box(id: string, min: Vec3, max: Vec3, material: MaterialId, top: TopPaint, sides: SidePaint, style?: string): BlockSpec {
  return { id, shape: 'box', min, max, material, top, sides, ...(style ? { style } : {}) };
}

function ramp(id: string, min: Vec3, max: Vec3, rise: RampRise, material: MaterialId): BlockSpec {
  // Rampas pontuam; laterais triangulares não são pintáveis nesta versão.
  return { id, shape: 'ramp', min, max, rise, material, top: 'score', sides: 'none', style: 'ramp' };
}

/** Peças únicas, simétricas por si mesmas. */
const global: BlockSpec[] = [
  box('chao', [-31, -1, -21], [31, 0, 21], 'terracota', 'score', 'none', 'ground'),
  box('muro_n', [-32, 0, 21], [32, 4, 22], 'muro', 'none', 'none', 'boundary'),
  box('muro_s', [-32, 0, -22], [32, 4, -21], 'muro', 'none', 'none', 'boundary'),
  box('muro_o', [-32, 0, -21], [-31, 4, 21], 'muro', 'none', 'none', 'boundary'),
  box('muro_l', [31, 0, -21], [32, 4, 21], 'muro', 'none', 'none', 'boundary'),
  // Praça da Roda: dois pilares maciços + ponte sobre a passagem inferior
  box('praca_norte', [-4.5, 0, 1.5], [4.5, 2.4, 4.5], 'pedra', 'score', 'paint', 'plaza'),
  box('praca_sul', [-4.5, 0, -4.5], [4.5, 2.4, -1.5], 'pedra', 'score', 'paint', 'plaza'),
  box('praca_ponte', [-4.5, 2.05, -1.5], [4.5, 2.4, 1.5], 'madeira', 'score', 'paint', 'bridge'),
  // pedestal azulejado (não pintável) e corpo sólido da estátua (colisor sem malha própria)
  box('pedestal', [-1.0, 2.4, -1.0], [1.0, 3.0, 1.0], 'azulejo', 'none', 'none', 'pedestal'),
  { ...box('estatua', [-0.65, 3.0, -0.65], [0.65, 5.6, 0.65], 'azulejo', 'none', 'none', 'hidden'), hidden: true },
];

/** Metade oeste (turma Urucum) — espelhada para a leste. */
const half: BlockSpec[] = [
  // ---------------- Galpão (base) ----------------
  box('galpao', [-31, 0, -7], [-24, 1.6, 7], 'madeira', 'score', 'paint', 'deck'),
  ramp('galpao_rampa_n', [-24, 0, 2.5], [-20, 1.6, 5.5], 'x-', 'madeira'),
  ramp('galpao_rampa_s', [-24, 0, -5.5], [-20, 1.6, -2.5], 'x-', 'madeira'),
  ramp('galpao_saida_n', [-30.2, 0, 7], [-27.2, 1.6, 11], 'z-', 'madeira'),
  ramp('galpao_saida_s', [-30.2, 0, -11], [-27.2, 1.6, -7], 'z+', 'madeira'),
  box('galpao_escudo', [-24.6, 1.6, -2.2], [-24, 2.7, 2.2], 'tijolo', 'paint', 'paint', 'lowwall'),
  // paletes de telha nas quinas frontais: cortam linhas diagonais até o spawn
  box('galpao_palete_n', [-25, 1.6, 5.9], [-24, 3.3, 7], 'madeira', 'none', 'paint', 'crate'),
  box('galpao_palete_s', [-25, 1.6, -7], [-24, 3.3, -5.9], 'madeira', 'none', 'paint', 'crate'),
  box('galpao_poste_a', [-30.8, 1.6, 6.3], [-30.3, 5.4, 6.8], 'madeira', 'none', 'none', 'post'),
  box('galpao_poste_b', [-30.8, 1.6, -6.8], [-30.3, 5.4, -6.3], 'madeira', 'none', 'none', 'post'),
  box('galpao_poste_c', [-27.3, 1.6, 6.3], [-26.8, 5.4, 6.8], 'madeira', 'none', 'none', 'post'),
  box('galpao_poste_d', [-27.3, 1.6, -6.8], [-26.8, 5.4, -6.3], 'madeira', 'none', 'none', 'post'),
  box('galpao_telhado', [-31.2, 5.4, -7.3], [-26.4, 5.7, 7.3], 'barro', 'none', 'none', 'roof'),

  // ---------------- Linha central ----------------
  // forno de queima: bloqueia a visão direta spawn ⇄ centro; topo é um mirante contestável
  box('forno', [-17, 0, -2], [-14, 3.5, 2], 'tijolo', 'paint', 'paint', 'kiln'),
  box('forno_chamine', [-15.9, 3.5, -0.55], [-15.1, 5.4, 0.55], 'azulejo', 'none', 'none', 'chimney'),
  box('caixote_c1', [-12.2, 0, 4.6], [-11, 1.2, 5.8], 'madeira', 'paint', 'paint', 'crate'),
  box('caixote_c2', [-11, 0, -5.2], [-9.8, 1.2, -4], 'madeira', 'paint', 'paint', 'crate'),
  // mureta diante da boca da passagem inferior (cobertura baixa, dá para atirar por cima)
  box('mureta_tunel', [-8.4, 0, -1.3], [-7.9, 1.0, 1.3], 'tijolo', 'paint', 'paint', 'lowwall'),
  // rampas da Praça: oeste (lado norte) e pelo sul (lado oeste)
  ramp('praca_rampa_o', [-9.5, 0, 1.8], [-4.5, 2.4, 4.5], 'x+', 'pedra'),
  ramp('praca_rampa_s', [-4.2, 0, -9.5], [-1.2, 2.4, -4.5], 'z+', 'pedra'),

  // ---------------- Divisórias norte (varal alto · mureta · varal) ----------------
  box('varal_n1', [-21, 0, 7.6], [-15.5, 2.2, 8.4], 'madeira', 'paint', 'paint', 'rack'),
  box('mureta_n', [-12.5, 0, 7.7], [-9.5, 1.0, 8.3], 'tijolo', 'paint', 'paint', 'lowwall'),
  box('varal_n2', [-7.5, 0, 7.6], [-5, 2.2, 8.4], 'madeira', 'paint', 'paint', 'rack'),
  // ---------------- Divisórias sul ----------------
  box('varal_s1', [-20, 0, -8.4], [-14.5, 2.2, -7.6], 'madeira', 'paint', 'paint', 'rack'),
  box('mureta_s', [-12.5, 0, -8.3], [-10, 1.0, -7.7], 'tijolo', 'paint', 'paint', 'lowwall'),
  box('varal_s2', [-9.5, 0, -8.4], [-6, 2.2, -7.6], 'madeira', 'paint', 'paint', 'rack'),

  // ---------------- Linha norte: varanda elevada com duas rampas ----------------
  box('varanda', [-16, 0, 15], [-6, 2.5, 21], 'pedra', 'score', 'paint', 'balcony'),
  ramp('varanda_rampa_o', [-21, 0, 16.5], [-16, 2.5, 20.5], 'x+', 'pedra'),
  ramp('varanda_rampa_l', [-6, 0, 16.5], [-1.5, 2.5, 20.5], 'x-', 'pedra'),
  box('varanda_parapeito', [-12, 2.5, 15], [-9, 3.3, 15.4], 'tijolo', 'none', 'paint', 'parapet'),
  box('caixote_n1', [-11.5, 0, 10.6], [-10.3, 1.2, 11.8], 'madeira', 'paint', 'paint', 'crate'),
  box('caixote_n2', [-4.2, 0, 12.2], [-3, 1.2, 13.4], 'madeira', 'paint', 'paint', 'crate'),
  box('caixote_n3', [-19.5, 0, 10.2], [-18.3, 1.2, 11.4], 'madeira', 'paint', 'paint', 'crate'),
  box('potes_n', [-8.2, 0, 11.6], [-7, 2.6, 12.8], 'barro', 'none', 'paint', 'pillar'),
  box('caixote_q', [-28.2, 0, 14.6], [-27, 1.2, 15.8], 'madeira', 'paint', 'paint', 'crate'),

  // ---------------- Linha sul: tablado baixo com dois acessos ----------------
  box('tablado', [-15, 0, -17], [-8, 1.0, -11], 'madeira', 'score', 'paint', 'platform'),
  ramp('tablado_rampa_o', [-18, 0, -15.5], [-15, 1.0, -12.5], 'x+', 'madeira'),
  ramp('tablado_rampa_l', [-8, 0, -15], [-5.5, 1.0, -12.5], 'x-', 'madeira'),
  box('telhas', [-12, 1.0, -15], [-11, 2.3, -13], 'barro', 'none', 'paint', 'tiles'),
  box('pilar_s1', [-3.5, 0, -16], [-2.5, 2.8, -15], 'tijolo', 'none', 'paint', 'pillar'),
  box('pilar_s2', [-21.5, 0, -17.5], [-20.5, 2.8, -16.5], 'tijolo', 'none', 'paint', 'pillar'),
  // muro escalável no quintal sudoeste (atalho vertical para quem pinta)
  box('muro_sw', [-25.5, 0, -16], [-24.5, 3.2, -11], 'tijolo', 'paint', 'paint', 'wall'),
];

const decorHalf: DecorSpec[] = [
  // bandeirinhas altas e junto aos muros: enfeitam sem cruzar a linha de visão do jogo
  { kind: 'bandeirinhas', pos: [-30.8, 6.4, 7.2], to: [-19, 6.6, 21.3] },
  { kind: 'bandeirinhas', pos: [-30.8, 6.4, -7.2], to: [-19, 6.6, -21.3] },
  { kind: 'bandeirinhas', pos: [-31.3, 6.2, -20.5], to: [-31.3, 6.2, -8] },
  { kind: 'potes', pos: [-24, 4.0, 21.5], variant: 0 },
  { kind: 'potes', pos: [-10, 4.0, -21.5], variant: 1 },
  { kind: 'potes', pos: [-31.5, 4.0, 12], variant: 2 },
  { kind: 'lampiao', pos: [-20, 4.0, 21.5] },
  { kind: 'lampiao', pos: [-31.5, 4.0, -12] },
  { kind: 'fornoBoca', pos: [-14, 0, 0], yaw: Math.PI / 2 },
  { kind: 'rodaGigante', pos: [-28.8, 5.72, 0] },
  { kind: 'arvore', pos: [-38, 0, 12], scale: 1.2, variant: 0 },
  { kind: 'arvore', pos: [-40, 0, -8], scale: 1.4, variant: 1 },
  { kind: 'arvore', pos: [-18, 0, 28], scale: 1.3, variant: 2 },
  { kind: 'arvore', pos: [-4, 0, -29], scale: 1.1, variant: 0 },
  { kind: 'arvore', pos: [-46, 0, 20], scale: 1.6, variant: 0 },
  { kind: 'casa', pos: [-44, 0, -22], yaw: 0.4, variant: 0 },
  { kind: 'casa', pos: [-28, 0, 32], yaw: -0.2, variant: 1 },
];

function spawnsFor(sign: 1 | -1) {
  // alinhados às rampas frontais: a saída fica à frente, não atrás do escudo
  const pts: Vec3[] = [
    [-26.2, 1.6, 3.4],
    [-26.2, 1.6, -3.4],
    [-28.4, 1.6, 4.6],
    [-28.4, 1.6, -4.6],
  ];
  return pts.map((p) => ({ pos: sign === 1 ? p : mirrorPoint(p), yaw: sign === 1 ? Math.PI / 2 : -Math.PI / 2 }));
}

const spawnZone0 = { min: [-31, 1.2, -7] as Vec3, max: [-24, 5.3, 7] as Vec3 };

export const PATIO_DA_OLARIA: MapSpec = {
  id: 'patio-da-olaria',
  name: 'Pátio da Olaria',
  version: 2,
  cellSize: 0.25,
  bounds: { min: [-31, -2, -21], max: [31, 12, 21] },
  killY: -6,
  blocks: [...global, ...half, ...half.map((b) => mirrorBlock(b))],
  spawns: { 0: spawnsFor(1), 1: spawnsFor(-1) },
  spawnZones: { 0: spawnZone0, 1: mirrorAabb(spawnZone0) },
  decor: [
    ...decorHalf,
    ...decorHalf.filter((d) => d.kind !== 'arvore' && d.kind !== 'casa').map(mirrorDecor),
    { kind: 'estatua', pos: [0, 3.0, 0], scale: 1.05, yaw: Math.PI / 2 },
    { kind: 'letreiro', pos: [0, 4.4, 21.6], yaw: 0, variant: 0 },
    { kind: 'letreiro', pos: [0, 4.4, -21.6], yaw: Math.PI, variant: 1 },
    { kind: 'arvore', pos: [39, 0, -11], scale: 1.3, variant: 1 },
    { kind: 'arvore', pos: [37, 0, 9], scale: 1.1, variant: 2 },
    { kind: 'arvore', pos: [15, 0, -29], scale: 1.4, variant: 0 },
    { kind: 'arvore', pos: [6, 0, 30], scale: 1.2, variant: 1 },
    { kind: 'arvore', pos: [46, 0, -20], scale: 1.5, variant: 0 },
    { kind: 'casa', pos: [45, 0, 20], yaw: 2.9, variant: 1 },
    { kind: 'casa', pos: [22, 0, -33], yaw: 0.1, variant: 0 },
    { kind: 'fumaca', pos: [-15.5, 5.4, 0] },
    { kind: 'fumaca', pos: [15.5, 5.4, 0] },
  ],
  lighting: {
    // fim de manhã: sol alto e quente, céu azul vivo, sombras lilás-azuladas
    sunDirection: [-0.3, -0.88, 0.36],
    sunColor: [1.0, 0.96, 0.88],
    skyTop: [0.3, 0.58, 0.98],
    skyHorizon: [0.8, 0.9, 1.0],
    ambient: [0.76, 0.73, 0.74],
    shadowTint: [0.88, 0.88, 0.98],
    fogColor: [0.8, 0.88, 0.99],
    fogDensity: 0.0065,
  },
};
