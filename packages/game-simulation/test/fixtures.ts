import type { MapSpec, BlockSpec } from '@borrifo/game-content';
import { computeMapHash } from '@borrifo/game-content';

/**
 * Mapa de teste controlado (20 × 20 m):
 * - piso pontuável y ∈ [-1, 0];
 * - parede central pintável (x ∈ [-0.25, 0.25], z ∈ [-5, 5], altura 3);
 * - plataforma alta pontuável (x ∈ [5, 9], z ∈ [-2, 2], altura 2);
 * - caixa não pintável (x ∈ [-8, -7], z ∈ [6, 7]);
 * - caixa de 0,3 m de largura (célula parcial): x ∈ [-6, -5.7], z ∈ [-8, -7.5], altura 1.
 */
const blocks: BlockSpec[] = [
  { id: 'piso', shape: 'box', min: [-10, -1, -10], max: [10, 0, 10], material: 'terracota', top: 'score', sides: 'none' },
  { id: 'parede', shape: 'box', min: [-0.25, 0, -5], max: [0.25, 3, 5], material: 'tijolo', top: 'paint', sides: 'paint' },
  { id: 'plataforma', shape: 'box', min: [5, 0, -2], max: [9, 2, 2], material: 'pedra', top: 'score', sides: 'paint' },
  { id: 'azulejo', shape: 'box', min: [-8, 0, 6], max: [-7, 1, 7], material: 'azulejo', top: 'none', sides: 'none' },
  { id: 'fina', shape: 'box', min: [-6, 0, -8], max: [-5.7, 1, -7.5], material: 'madeira', top: 'score', sides: 'none' },
  { id: 'muro_n', shape: 'box', min: [-11, 0, 10], max: [11, 4, 11], material: 'muro', top: 'none', sides: 'none' },
  { id: 'muro_s', shape: 'box', min: [-11, 0, -11], max: [11, 4, -10], material: 'muro', top: 'none', sides: 'none' },
  { id: 'muro_o', shape: 'box', min: [-11, 0, -10], max: [-10, 4, 10], material: 'muro', top: 'none', sides: 'none' },
  { id: 'muro_l', shape: 'box', min: [10, 0, -10], max: [11, 4, 10], material: 'muro', top: 'none', sides: 'none' },
];

export const TEST_MAP: MapSpec = {
  id: 'teste',
  name: 'Mapa de teste',
  version: 1,
  cellSize: 0.25,
  bounds: { min: [-10, -2, -10], max: [10, 8, 10] },
  killY: -6,
  blocks,
  spawns: { 0: [{ pos: [-8, 0, 0], yaw: Math.PI / 2 }], 1: [{ pos: [8, 2, 0], yaw: -Math.PI / 2 }] },
  spawnZones: { 0: { min: [-10, -1, -2], max: [-6, 3, 2] }, 1: { min: [5, 1, -2], max: [9, 5, 2] } },
  decor: [],
  lighting: { sunDirection: [0, -1, 0], sunColor: [1, 1, 1], skyTop: [0, 0, 1], skyHorizon: [1, 1, 1], ambient: [0.5, 0.5, 0.5], shadowTint: [1, 1, 1], fogColor: [1, 1, 1], fogDensity: 0 },
};

export const TEST_MAP_HASH = computeMapHash(TEST_MAP);
