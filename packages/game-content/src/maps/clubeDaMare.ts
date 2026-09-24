import type { Vec3 } from '@borrifo/game-contracts';
import type { Aabb, BlockSpec, DecorSpec, MapSpec } from '../mapSpec';
import { arena, assembleMap, bleachers, box, crate, hallBuilding, platform, ramp, teamBase, wallX } from './kit';

/**
 * Clube da Maré — clube de bairro brasileiro: pátio de piscina VAZIA com fundo
 * jogável (sem água letal nem física aquática), rampas de acesso, torre de salto
 * no centro (passarelas desde a borda), vestiários com corredor atravessável, quiosque e arquibancada.
 * Desenho próprio: nada de layouts, nomes internos ou assets de mapas de outros jogos.
 *
 * Ritmo diferente da Toca do Ara: o centro é um POÇO (disputa de baixo para cima,
 * torre dominante acessível por uma rampa por turma) e as laterais são prédios com
 * telhados pontuáveis e escaláveis, em vez de varanda e praça elevada.
 */

const CORAL: Vec3 = [0.97, 0.56, 0.5];
const MENTA: Vec3 = [0.56, 0.86, 0.78];
const AREIA: Vec3 = [0.98, 0.9, 0.72];
const BRANCO: Vec3 = [0.98, 0.97, 0.95];
const AMARELO: Vec3 = [1.0, 0.82, 0.36];

const LIGHTING: MapSpec['lighting'] = {
  // meio-dia de verão: sol alto e branco, céu ciano, sombras azuladas
  sunDirection: [-0.22, -0.93, -0.3],
  sunColor: [1.0, 0.98, 0.93],
  skyTop: [0.2, 0.6, 0.98],
  skyHorizon: [0.78, 0.94, 1.0],
  ambient: [0.8, 0.82, 0.84],
  shadowTint: [0.82, 0.9, 1.0],
  fogColor: [0.84, 0.94, 1.0],
  fogDensity: 0.0055,
};

/** Piscina vazia centrada: fundo pontuável, bordas de azulejo, rampas de acesso a oeste (espelhadas a leste). */
function pool(hx: number, hz: number, depth: number, rampLen: number, rampZ: [number, number]) {
  const y = -depth;
  const global: BlockSpec[] = [box('piscina_fundo', [-hx, y - 1, -hz], [hx, y, hz], 'piscina', 'score', 'none', 'pool')];
  const half: BlockSpec[] = [
    // revestimento das paredes (não pintável: sair do poço exige as rampas ou a torre)
    box('piscina_borda_o', [-hx, y, -hz], [-hx + 0.2, 0, hz], 'piscina', 'none', 'none', 'poolwall'),
    box('piscina_borda_n', [-hx + 0.2, y, hz - 0.2], [hx - 0.2, 0, hz], 'piscina', 'none', 'none', 'poolwall'),
    ramp('piscina_rampa_n', [-hx + 0.2, y, rampZ[0]], [-hx + 0.2 + rampLen, 0, rampZ[1]], 'x-', 'piscina'),
    ramp('piscina_rampa_s', [-hx + 0.2, y, -rampZ[1]], [-hx + 0.2 + rampLen, 0, -rampZ[0]], 'x-', 'piscina'),
  ];
  const hole: Aabb = { min: [-hx, y, -hz], max: [hx, 0, hz] };
  return { global, half, hole };
}

function outskirts(L: number, W: number): DecorSpec[] {
  return [
    { kind: 'palmeira', pos: [-L - 5, 0, W * 0.6], scale: 1.4 },
    { kind: 'palmeira', pos: [-L - 7, 0, -W * 0.2], scale: 1.2 },
    { kind: 'palmeira', pos: [-L * 0.4, 0, W + 6], scale: 1.5 },
    { kind: 'casa', pos: [-L - 15, 0, -W * 0.9], yaw: 0.3, variant: 1 },
    { kind: 'palmeira', pos: [L + 6, 0, -W * 0.55], scale: 1.3 },
    { kind: 'palmeira', pos: [L * 0.45, 0, -W - 6], scale: 1.1 },
    { kind: 'arvore', pos: [L + 11, 0, W * 0.7], scale: 1.4, variant: 0 },
    { kind: 'casa', pos: [L + 14, 0, W * 1.0], yaw: 3.0, variant: 0 },
  ];
}

function landmarks(L: number, W: number, towerTop: number): DecorSpec[] {
  return [
    { kind: 'trampolim', pos: [0, towerTop, 0], scale: 1 },
    { kind: 'arara', pos: [0, 11, 0], scale: Math.min(L, W) * 0.9, to: [L - 3, 4.3, -W - 0.4] },
    { kind: 'letreiro', pos: [-L + 10, 4.4, W + 0.6], yaw: 0, variant: 2 },
    { kind: 'letreiro', pos: [L - 10, 4.4, -W - 0.6], yaw: Math.PI, variant: 3 },
  ];
}

/* ------------------------------ padrão (6–8) ------------------------------ */

function padrao(): MapSpec {
  const L = 30, W = 20;
  const p = pool(8, 6, 1.8, 4, [2.5, 5.5]);
  const base = teamBase({ x0: -L, depth: 7, halfWidth: 7, rampZ: 4, prefix: 'portaria', tint: MENTA });
  const global: BlockSpec[] = [
    ...arena(L, W, { floor: 'ladrilho', wall: 'reboco', floorBottom: -2.8, holes: [p.hole], wallTint: CORAL }),
    ...p.global,
    // torre de salto: ponto alto central, alcançável por uma rampa de cada turma ou escalando
    box('torre', [-1.5, -1.8, -1.5], [1.5, 2.4, 1.5], 'reboco', 'score', 'paint', 'tower', BRANCO),
  ];
  const half: BlockSpec[] = [
    ...base.blocks,
    ...p.half,
    // passarela da borda até a torre (flutua sobre o poço: dá para passar por baixo)
    ramp('torre_rampa', [-7.8, 0, -1.2], [-1.5, 2.4, 1.2], 'x+', 'reboco', BRANCO),
    // vestiário (norte): corredor atravessável; telhado pontuável com escada externa
    ...hallBuilding('vestiario', [-19, -13], [8, 15], 3.2, [10, 12.5], { tint: CORAL }),
    ramp('vestiario_escada', [-23.5, 0, 13], [-19, 3.2, 15], 'x+', 'cimento', AREIA),
    // quiosque (sul): balcão baixo e telhado de sapê sobre postes
    box('quiosque_balcao', [-16, 0, -10], [-12, 1.1, -9.2], 'madeira', 'paint', 'paint', 'counter', AMARELO),
    box('quiosque_poste_a', [-16, 0, -12.6], [-15.6, 2.8, -12.2], 'madeira', 'none', 'none', 'post'),
    box('quiosque_poste_b', [-12.4, 0, -12.6], [-12, 2.8, -12.2], 'madeira', 'none', 'none', 'post'),
    box('quiosque_telhado', [-16.6, 2.8, -13.2], [-11.4, 3.1, -8.8], 'barro', 'none', 'none', 'thatch'),
    // arquibancada (sul) em degraus de escada
    ...bleachers('arquibancada', [-24, -15], -15.6, 3, 1.4, 0.34, AREIA),
    // espreguiçadeiras e engradados: cobertura baixa ao redor da piscina
    box('espreguicadeira_1', [-12, 0, 7], [-10, 0.5, 7.8], 'madeira', 'paint', 'paint', 'lounger', BRANCO),
    box('espreguicadeira_2', [-6, 0, 8.5], [-4, 0.5, 9.3], 'madeira', 'paint', 'paint', 'lounger', BRANCO),
    crate('engradado_1', -10.5, 4, 1.1, 1.0, 'cratePlastic', 'cimento', AMARELO),
    crate('engradado_2', -10.5, -4.6, 1.1, 1.0, 'cratePlastic', 'cimento', MENTA),
    box('guarda_sol', [-11.2, 0, -3.2], [-10.8, 2.6, -2.8], 'latao', 'none', 'none', 'post'),
    wallX('jardineira_n', -22, -19.5, 6.6, 0.9, 'planter', 'barro', 1.0, [0.56, 0.78, 0.5]),
    wallX('jardineira_s', -22, -19.5, -6.6, 0.9, 'planter', 'barro', 1.0, [0.56, 0.78, 0.5]),
  ];
  return assembleMap(
    { id: 'clube-da-mare.padrao', family: 'clube-da-mare', familyName: 'Clube da Maré', variant: 'padrao', version: 1, L, W, lighting: LIGHTING, players: [6, 8] },
    {
      global,
      half,
      spawns0: base.spawns,
      zone0: base.zone,
      capsule: [0, 2.4, 0],
      objectivesHalf: {
        stations: [[-16, 3.2, 11.25], [-14, 0, -5.4]],
        pickups: [
          { pos: [-11.5, 0, 0], kind: 'embalo' },
          { pos: [-20, 0, 17.5], kind: 'folego' },
        ],
      },
      decorHalf: [
        { kind: 'guardaSol', pos: [-11, 2.6, -3], variant: 0 },
        { kind: 'bandeirinhas', pos: [-29.8, 6.2, 7.2], to: [-13, 6.4, 20.3] },
        { kind: 'vasos', pos: [-26, 4.0, 20.6], variant: 2 },
      ],
      decorGlobal: [...landmarks(L, W, 2.4), ...outskirts(L, W)],
    },
  );
}

/* ------------------------------ compacta (2–4) ------------------------------ */

function compacto(): MapSpec {
  const L = 19, W = 12;
  const p = pool(5, 4, 1.4, 2.5, [1.3, 3.6]);
  const base = teamBase({ x0: -L, depth: 6, halfWidth: 5, rampZ: 3, prefix: 'portaria', tint: MENTA });
  const global: BlockSpec[] = [
    ...arena(L, W, { floor: 'ladrilho', wall: 'reboco', floorBottom: -2.4, holes: [p.hole], wallTint: CORAL }),
    ...p.global,
    // boia grande no centro do poço: degrau baixo (cobertura e ponto da cápsula)
    box('boia', [-0.9, -1.4, -0.9], [0.9, -1.06, 0.9], 'cimento', 'score', 'paint', 'float', AMARELO),
  ];
  const half: BlockSpec[] = [
    ...base.blocks,
    ...p.half,
    // quiosque à beira do poço: balcão alto (cobertura inteira) entre geladeira e freezer;
    // juntos cortam a linha de tiro do poço até a portaria na arena pequena
    box('quiosque_balcao', [-8.2, 0, -1.6], [-7.4, 1.35, 1.6], 'madeira', 'paint', 'paint', 'counter', AMARELO),
    box('quiosque_geladeira', [-8.3, 0, 1.6], [-7.3, 2.1, 3.4], 'cimento', 'none', 'paint', 'fridge', BRANCO),
    box('quiosque_freezer', [-8.3, 0, -3.4], [-7.3, 2.1, -1.6], 'cimento', 'none', 'paint', 'fridge', MENTA),
    ...hallBuilding('vestiario', [-11, -7], [6.5, 12], 2.6, [8.2, 10.2], { tint: CORAL, clearance: 2.2 }),
    ramp('vestiario_escada', [-15, 0, 10.4], [-11, 2.6, 12], 'x+', 'cimento', AREIA),
    ...bleachers('arquibancada', [-14, -7], -8, 2, 1.6, 0.34, AREIA),
    box('espreguicadeira', [-8, 0, 4.8], [-6.5, 0.5, 5.5], 'madeira', 'paint', 'paint', 'lounger', BRANCO),
    crate('engradado', -12.5, 4.2, 1.1, 1.0, 'cratePlastic', 'cimento', MENTA),
  ];
  return assembleMap(
    { id: 'clube-da-mare.compacto', family: 'clube-da-mare', familyName: 'Clube da Maré', variant: 'compacto', version: 1, L, W, lighting: LIGHTING, players: [2, 4] },
    {
      global,
      half,
      spawns0: base.spawns,
      zone0: base.zone,
      capsule: [0, -1.06, 0],
      objectivesHalf: {
        stations: [[-9, 2.6, 9.2], [-5.5, 0, -6.4]],
        pickups: [
          { pos: [-6.3, 0, 0], kind: 'embalo' },
          { pos: [-13, 0, 7.5], kind: 'folego' },
        ],
      },
      decorHalf: [
        { kind: 'guardaSol', pos: [-13, 2.6, -4.5], variant: 1 },
        { kind: 'bandeirinhas', pos: [-18.8, 6.0, 5.2], to: [-8, 6.2, 12.3] },
      ],
      decorGlobal: [...landmarks(L, W, -1.06).filter((d) => d.kind !== 'trampolim'), ...outskirts(L, W)],
    },
  );
}

/* ------------------------------ ampliada (10–16) ------------------------------ */

function ampliado(): MapSpec {
  const L = 40, W = 27;
  const p = pool(10, 7, 1.8, 4.5, [3.2, 6.8]);
  const base = teamBase({ x0: -L, depth: 7, halfWidth: 8, rampZ: 4.5, prefix: 'portaria', tint: MENTA });
  const global: BlockSpec[] = [
    ...arena(L, W, { floor: 'ladrilho', wall: 'reboco', floorBottom: -2.8, holes: [p.hole], wallTint: CORAL }),
    ...p.global,
    box('torre', [-2, -1.8, -2], [2, 2.6, 2], 'reboco', 'score', 'paint', 'tower', BRANCO),
  ];
  const half: BlockSpec[] = [
    ...base.blocks,
    ...p.half,
    ramp('torre_rampa', [-9.8, 0, -1.4], [-2, 2.6, 1.4], 'x+', 'reboco', BRANCO),
    // lanchonete com corredor: corta a visão da base e abre o flanco central
    ...hallBuilding('lanchonete', [-27, -23], [-3.5, 3.5], 3.0, [-1.2, 1.2], { tint: AMARELO }),
    ...hallBuilding('vestiario', [-24, -17], [9, 17], 3.2, [11.5, 14], { tint: CORAL }),
    ramp('vestiario_escada', [-28.5, 0, 15], [-24, 3.2, 17], 'x+', 'cimento', AREIA),
    // toboágua (norte): plataforma alta com duas escadas
    ...platform('toboagua', [-14, 19], [-8, 25], 2.8, { material: 'reboco', style: 'slide', rampLen: 5.6, rampW: 3, tint: MENTA }),
    box('quiosque_balcao', [-18, 0, -12], [-14, 1.1, -11.2], 'madeira', 'paint', 'paint', 'counter', AMARELO),
    box('quiosque_poste_a', [-18, 0, -14.6], [-17.6, 2.8, -14.2], 'madeira', 'none', 'none', 'post'),
    box('quiosque_poste_b', [-14.4, 0, -14.6], [-14, 2.8, -14.2], 'madeira', 'none', 'none', 'post'),
    box('quiosque_telhado', [-18.6, 2.8, -15.2], [-13.4, 3.1, -10.8], 'barro', 'none', 'none', 'thatch'),
    ...bleachers('arquibancada', [-30, -18], -20.5, 4, 1.4, 0.34, AREIA),
    crate('engradado_1', -14, 5.5, 1.1, 1.0, 'cratePlastic', 'cimento', AMARELO),
    crate('engradado_2', -14, -6, 1.1, 1.0, 'cratePlastic', 'cimento', MENTA),
    crate('engradado_3', -31, -8, 1.1, 1.0, 'cratePlastic', 'cimento', AMARELO),
    box('espreguicadeira_1', [-15, 0, 8.2], [-13, 0.5, 9], 'madeira', 'paint', 'paint', 'lounger', BRANCO),
    box('espreguicadeira_2', [-7, 0, 9.6], [-5, 0.5, 10.4], 'madeira', 'paint', 'paint', 'lounger', BRANCO),
    wallX('jardineira_n', -34, -29, 10, 0.9, 'planter', 'barro', 1.0, [0.56, 0.78, 0.5]),
    box('guarda_sol', [-13.2, 0, -3.2], [-12.8, 2.6, -2.8], 'latao', 'none', 'none', 'post'),
  ];
  return assembleMap(
    { id: 'clube-da-mare.ampliado', family: 'clube-da-mare', familyName: 'Clube da Maré', variant: 'ampliado', version: 1, L, W, lighting: LIGHTING, players: [10, 16] },
    {
      global,
      half,
      spawns0: base.spawns,
      zone0: base.zone,
      capsule: [0, 2.6, 0],
      objectivesHalf: {
        stations: [[-20.5, 3.2, 12.75], [-11, 2.8, 22], [-21, 0, -7.5]],
        pickups: [
          { pos: [-12.5, 0, 0], kind: 'embalo' },
          { pos: [-22, 0, 20], kind: 'folego' },
          { pos: [-30, 0, -14], kind: 'embalo' },
        ],
      },
      decorHalf: [
        { kind: 'guardaSol', pos: [-13, 2.6, -3], variant: 0 },
        { kind: 'bandeirinhas', pos: [-39.8, 6.2, 8.2], to: [-20, 6.4, 27.3] },
      ],
      decorGlobal: [...landmarks(L, W, 2.6), ...outskirts(L, W)],
    },
  );
}

export const CLUBE_DA_MARE: Record<'compacto' | 'padrao' | 'ampliado', MapSpec> = { compacto: compacto(), padrao: padrao(), ampliado: ampliado() };
