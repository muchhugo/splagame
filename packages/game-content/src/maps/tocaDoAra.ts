import type { Vec3 } from '@borrifo/game-contracts';
import type { BlockSpec, DecorSpec, MapSpec } from '../mapSpec';
import { arena, assembleMap, box, centralPlaza, crate, hidden, platform, ramp, teamBase, wallX, bleachers } from './kit';

/**
 * Toca do Ara — pátio de um centro comunitário/oficina criativa. Evolui o antigo
 * Pátio da Olaria (reaproveita o desenho funcional da praça com passagem de baixo,
 * da varanda e das bases com quatro saídas), com identidade nova: oficina de
 * reboco colorido no lugar do forno, divisórias de cobogó, jardineiras, bancadas,
 * o mural da arara nos muros e o totem do Ara no centro.
 *
 * Lugares nomeáveis: "mural" (muros norte/sul), "totem" (centro), "passagem de baixo",
 * "varanda", "oficina", "bancadas", "horta" e "quadra" (só na ampliada).
 */

const TERRACOTA: Vec3 = [0.92, 0.58, 0.4];
const OCRE: Vec3 = [0.96, 0.78, 0.44];
const VERDE: Vec3 = [0.5, 0.74, 0.58];
const COBOGO: Vec3 = [0.97, 0.93, 0.86];

const LIGHTING: MapSpec['lighting'] = {
  // fim de tarde quente: sol mais baixo e dourado, sombras violeta suaves
  sunDirection: [-0.42, -0.8, 0.42],
  sunColor: [1.0, 0.93, 0.8],
  skyTop: [0.32, 0.56, 0.95],
  skyHorizon: [0.98, 0.88, 0.78],
  ambient: [0.78, 0.72, 0.72],
  shadowTint: [0.86, 0.84, 0.98],
  fogColor: [0.93, 0.87, 0.84],
  fogDensity: 0.006,
};

function outskirts(L: number, W: number): DecorSpec[] {
  // entorno fora dos muros: vegetação brasileira e casas do bairro (só oeste; leste própria)
  return [
    { kind: 'bananeira', pos: [-L - 6, 0, W * 0.5], scale: 1.2 },
    { kind: 'bananeira', pos: [-L - 8, 0, -W * 0.3], scale: 1.4 },
    { kind: 'palmeira', pos: [-L * 0.55, 0, W + 7], scale: 1.3 },
    { kind: 'arvore', pos: [-L - 12, 0, -W * 0.9], scale: 1.5, variant: 1 },
    { kind: 'casa', pos: [-L - 14, 0, W * 1.05], yaw: 0.4, variant: 0 },
    { kind: 'palmeira', pos: [L * 0.35, 0, -W - 8], scale: 1.1 },
    { kind: 'bananeira', pos: [L + 7, 0, -W * 0.45], scale: 1.3 },
    { kind: 'arvore', pos: [L + 10, 0, W * 0.6], scale: 1.3, variant: 2 },
    { kind: 'casa', pos: [L + 15, 0, -W * 1.0], yaw: 2.8, variant: 1 },
    { kind: 'palmeira', pos: [L + 6, 0, W * 0.9], scale: 1.4 },
  ];
}

/** Mural, totem, arara e letreiros: únicos (não espelhados). */
function landmarks(L: number, W: number, totemY: number, muralW: number): DecorSpec[] {
  return [
    // plano voltado para dentro da arena (a face da frente do plano aponta para −z)
    { kind: 'muralAra', pos: [0, 0, W - 0.02], yaw: 0, scale: muralW, variant: 0 },
    { kind: 'muralAra', pos: [0, 0, -W + 0.02], yaw: Math.PI, scale: muralW, variant: 1 },
    { kind: 'araTotem', pos: [0, totemY, 0], scale: 1 },
    // arara ambiental: voa alto, fora das rotas; pousa em pontos decorativos dos muros
    { kind: 'arara', pos: [0, 10, 0], scale: Math.min(L, W) * 0.9, to: [-L + 2, 4.3, W + 0.4] },
    { kind: 'letreiro', pos: [-L + 10, 4.4, W + 0.6], yaw: 0, variant: 0 },
    { kind: 'letreiro', pos: [L - 10, 4.4, -W - 0.6], yaw: Math.PI, variant: 1 },
  ];
}

/* ------------------------------ padrão (6–8) ------------------------------ */

function padrao(): MapSpec {
  const L = 31, W = 21;
  const base = teamBase({ x0: -L, depth: 7, halfWidth: 7, rampZ: 4, prefix: 'galpao', tint: OCRE });
  const global: BlockSpec[] = [
    ...arena(L, W, { floor: 'terracota', wall: 'muro' }),
    ...centralPlaza({ hx: 4.5, hz: 4.5 }),
    box('pedestal', [-1.0, 2.4, -1.0], [1.0, 3.0, 1.0], 'azulejo', 'none', 'none', 'pedestal'),
    hidden('totem', [-0.6, 3.0, -0.6], [0.6, 5.4, 0.6]),
  ];
  const half: BlockSpec[] = [
    ...base.blocks,
    // oficina de reboco (antigo forno): bloqueia a visão direta base ⇄ centro; topo é mirante
    box('oficina', [-17, 0, -2], [-14, 3.5, 2], 'reboco', 'paint', 'paint', 'workshop', TERRACOTA),
    box('bancada', [-13.4, 0, -2.6], [-12.6, 1.0, -0.9], 'madeira', 'paint', 'paint', 'bench'),
    crate('caixote_c1', -11.6, 5.2),
    crate('caixote_c2', -10.4, -4.6),
    box('mureta_tunel', [-8.4, 0, -1.3], [-7.9, 1.0, 1.3], 'tijolo', 'paint', 'paint', 'lowwall'),
    ramp('praca_rampa_o', [-9.5, 0, 1.8], [-4.5, 2.4, 4.5], 'x+', 'pedra'),
    ramp('praca_rampa_s', [-4.2, 0, -9.5], [-1.2, 2.4, -4.5], 'z+', 'pedra'),
    // divisórias: cobogó alto, mureta baixa, cobogó (trechos protegidos e abertos)
    wallX('cobogo_n1', -21, -15.5, 8, 2.2, 'cobogo', 'reboco', 0.8, COBOGO),
    wallX('mureta_n', -12.5, -9.5, 8, 1.0, 'lowwall', 'tijolo', 0.6),
    wallX('cobogo_n2', -7.5, -5, 8, 2.2, 'cobogo', 'reboco', 0.8, COBOGO),
    wallX('cobogo_s1', -20, -14.5, -8, 2.2, 'cobogo', 'reboco', 0.8, COBOGO),
    wallX('mureta_s', -12.5, -10, -8, 1.0, 'lowwall', 'tijolo', 0.6),
    wallX('cobogo_s2', -9.5, -6, -8, 2.2, 'cobogo', 'reboco', 0.8, COBOGO),
    // linha norte: varanda com duas rampas
    ...platform('varanda', [-16, 15], [-6, 21], 2.5, { rampLen: 4.5, rampW: 4, parapetZ: 15.2 }),
    crate('caixote_n1', -10.9, 11.2),
    crate('caixote_n2', -3.6, 12.8),
    crate('caixote_n3', -18.9, 10.8),
    box('jardineira_n', [-8.2, 0, 11.6], [-7, 2.6, 12.8], 'barro', 'none', 'paint', 'planter', VERDE),
    crate('caixote_q', -27.6, 15.2),
    // linha sul: bancadas da oficina (tablado baixo com dois acessos)
    ...platform('bancadas', [-15, -17], [-8, -11], 1.0, { material: 'madeira', style: 'platform', rampLen: 3, rampW: 3 }),
    box('ferramentas', [-12, 1.0, -15], [-11, 2.3, -13], 'madeira', 'none', 'paint', 'toolrack'),
    box('pilar_s1', [-3.5, 0, -16], [-2.5, 2.8, -15], 'tijolo', 'none', 'paint', 'pillar'),
    box('pilar_s2', [-21.5, 0, -17.5], [-20.5, 2.8, -16.5], 'tijolo', 'none', 'paint', 'pillar'),
    // muro escalável no quintal sudoeste (atalho vertical para quem pinta)
    box('muro_sw', [-25.5, 0, -16], [-24.5, 3.2, -11], 'reboco', 'paint', 'paint', 'wall', TERRACOTA),
  ];
  return assembleMap(
    { id: 'toca-do-ara.padrao', family: 'toca-do-ara', familyName: 'Toca do Ara', variant: 'padrao', version: 1, L, W, lighting: LIGHTING, players: [6, 8] },
    {
      global,
      half,
      spawns0: base.spawns,
      zone0: base.zone,
      capsule: [0, 0, 0],
      objectivesHalf: {
        stations: [[-12, 0, 12.4], [-11.5, 1.0, -12.6]],
        pickups: [
          { pos: [-14, 0, 8], kind: 'embalo' },
          { pos: [-13.4, 0, -8], kind: 'folego' },
        ],
      },
      decorHalf: [
        { kind: 'bandeirinhas', pos: [-30.8, 6.4, 7.2], to: [-19, 6.6, 21.3] },
        { kind: 'bandeirinhas', pos: [-30.8, 6.4, -7.2], to: [-19, 6.6, -21.3] },
        { kind: 'vasos', pos: [-24, 4.0, 21.5], variant: 0 },
        { kind: 'vasos', pos: [-10, 4.0, -21.5], variant: 1 },
        { kind: 'lampiao', pos: [-20, 4.0, 21.5] },
        { kind: 'lampiao', pos: [-31.5, 4.0, -12] },
        { kind: 'oficinaFachada', pos: [-14, 0, 0], yaw: Math.PI / 2 },
      ],
      decorGlobal: [...landmarks(L, W, 3.0, 12), ...outskirts(L, W)],
    },
  );
}

/* ------------------------------ compacta (2–4) ------------------------------ */

function compacto(): MapSpec {
  const L = 20, W = 13;
  const base = teamBase({ x0: -L, depth: 6, halfWidth: 5, rampZ: 3, prefix: 'galpao', tint: OCRE });
  const global: BlockSpec[] = [
    ...arena(L, W, { floor: 'terracota', wall: 'muro' }),
    ...centralPlaza({ hx: 3.5, hz: 3.5, h: 2.0, gap: 1.3 }),
    box('pedestal', [-0.8, 2.0, -0.8], [0.8, 2.5, 0.8], 'azulejo', 'none', 'none', 'pedestal'),
    hidden('totem', [-0.5, 2.5, -0.5], [0.5, 4.6, 0.5]),
  ];
  const half: BlockSpec[] = [
    ...base.blocks,
    box('oficina', [-10.5, 0, -2.4], [-8, 3.0, 2.4], 'reboco', 'paint', 'paint', 'workshop', TERRACOTA),
    box('mureta_tunel', [-6.2, 0, -1.1], [-5.7, 1.0, 1.1], 'tijolo', 'paint', 'paint', 'lowwall'),
    ramp('praca_rampa_o', [-7.5, 0, 1.4], [-3.5, 2.0, 3.5], 'x+', 'pedra'),
    ramp('praca_rampa_s', [-3.3, 0, -7.5], [-1.0, 2.0, -3.5], 'z+', 'pedra'),
    wallX('cobogo_n', -15, -10.5, 6.5, 2.2, 'cobogo', 'reboco', 0.8, COBOGO),
    wallX('mureta_n', -8.5, -6, 6.5, 1.0, 'lowwall', 'tijolo', 0.6),
    wallX('cobogo_s', -14, -9.5, -6.5, 2.2, 'cobogo', 'reboco', 0.8, COBOGO),
    wallX('mureta_s', -7.5, -5.5, -6.5, 1.0, 'lowwall', 'tijolo', 0.6),
    ...platform('varandinha', [-12, 9.5], [-6, 13], 1.8, { rampLen: 3.6, rampW: 3 }),
    crate('caixote_c1', -9, 4.3),
    crate('caixote_s1', -11, -10),
    box('jardineira_s', [-4.6, 0, -10.2], [-3.4, 2.2, -9], 'barro', 'none', 'paint', 'planter', VERDE),
  ];
  return assembleMap(
    { id: 'toca-do-ara.compacto', family: 'toca-do-ara', familyName: 'Toca do Ara', variant: 'compacto', version: 1, L, W, lighting: LIGHTING, players: [2, 4] },
    {
      global,
      half,
      spawns0: base.spawns,
      zone0: base.zone,
      capsule: [0, 0, 0],
      objectivesHalf: {
        stations: [[-9, 1.8, 11.25], [-8, 0, -9.6]],
        pickups: [
          { pos: [-9.5, 0, 6.5], kind: 'embalo' },
          { pos: [-8.5, 0, -6.5], kind: 'folego' },
        ],
      },
      decorHalf: [
        { kind: 'bandeirinhas', pos: [-19.8, 6.0, 5.2], to: [-10, 6.2, 13.3] },
        { kind: 'vasos', pos: [-14, 4.0, 13.5], variant: 0 },
        { kind: 'lampiao', pos: [-20.5, 4.0, -8] },
        { kind: 'oficinaFachada', pos: [-8, 0, 0], yaw: Math.PI / 2 },
      ],
      decorGlobal: [...landmarks(L, W, 2.5, 8), ...outskirts(L, W)],
    },
  );
}

/* ------------------------------ ampliada (10–16) ------------------------------ */

function ampliado(): MapSpec {
  const L = 40, W = 28;
  const base = teamBase({ x0: -L, depth: 7, halfWidth: 8, rampZ: 4.5, prefix: 'galpao', tint: OCRE });
  const global: BlockSpec[] = [
    ...arena(L, W, { floor: 'terracota', wall: 'muro' }),
    ...centralPlaza({ hx: 5, hz: 5, gap: 1.6 }),
    box('pedestal', [-1.0, 2.4, -1.0], [1.0, 3.0, 1.0], 'azulejo', 'none', 'none', 'pedestal'),
    hidden('totem', [-0.6, 3.0, -0.6], [0.6, 5.4, 0.6]),
  ];
  const half: BlockSpec[] = [
    ...base.blocks,
    // oficina grande com corredor (atravessável): corta a visão da base e abre um flanco
    box('oficina_a', [-26, 0, 1.3], [-21, 3.4, 4], 'reboco', 'score', 'paint', 'workshop', TERRACOTA),
    box('oficina_b', [-26, 0, -4], [-21, 3.4, -1.3], 'reboco', 'score', 'paint', 'workshop', TERRACOTA),
    box('oficina_teto', [-26, 2.4, -1.3], [-21, 3.4, 1.3], 'reboco', 'score', 'paint', 'workshop', TERRACOTA),
    box('bancada', [-18.4, 0, -2.6], [-17.6, 1.0, -0.9], 'madeira', 'paint', 'paint', 'bench'),
    crate('caixote_c1', -13.6, 5.6),
    crate('caixote_c2', -12.4, -5.2),
    crate('caixote_c3', -29.8, 11.5),
    box('mureta_tunel', [-9, 0, -1.4], [-8.5, 1.0, 1.4], 'tijolo', 'paint', 'paint', 'lowwall'),
    ramp('praca_rampa_o', [-10.5, 0, 2], [-5, 2.4, 5], 'x+', 'pedra'),
    ramp('praca_rampa_s', [-4.5, 0, -10.5], [-1.5, 2.4, -5], 'z+', 'pedra'),
    // divisórias da faixa norte e sul
    wallX('cobogo_n1', -30, -24, 9, 2.2, 'cobogo', 'reboco', 0.8, COBOGO),
    wallX('mureta_n', -19, -14, 9, 1.0, 'lowwall', 'tijolo', 0.6),
    wallX('cobogo_n2', -9, -6, 9, 2.2, 'cobogo', 'reboco', 0.8, COBOGO),
    wallX('cobogo_s1', -30, -24, -9, 2.2, 'cobogo', 'reboco', 0.8, COBOGO),
    wallX('mureta_s', -19, -14, -9, 1.0, 'lowwall', 'tijolo', 0.6),
    wallX('cobogo_s2', -9, -6, -9, 2.2, 'cobogo', 'reboco', 0.8, COBOGO),
    ...platform('varanda', [-18, 17], [-8, 23], 2.5, { rampLen: 5, rampW: 3, parapetZ: 17.2 }),
    crate('caixote_n1', -12.5, 13),
    crate('caixote_n2', -4, 14.5),
    // horta (faixa externa norte): canteiros baixos e estufa elevada
    wallX('canteiro_1', -35, -30, 25, 0.8, 'planter', 'barro', 1.2, VERDE),
    wallX('canteiro_2', -14, -9, 25.5, 0.8, 'planter', 'barro', 1.2, VERDE),
    ...platform('estufa', [-24, 23.5], [-17, 27.5], 1.6, { material: 'madeira', style: 'platform', rampLen: 3.2, rampW: 2.6 }),
    // faixa sul: bancadas, pilares e muro escalável
    ...platform('bancadas', [-17, -19], [-9, -12], 1.0, { material: 'madeira', style: 'platform', rampLen: 3, rampW: 3 }),
    box('ferramentas', [-14, 1.0, -17], [-13, 2.3, -15], 'madeira', 'none', 'paint', 'toolrack'),
    box('pilar_s1', [-4, 0, -18], [-3, 2.8, -17], 'tijolo', 'none', 'paint', 'pillar'),
    box('muro_sw', [-31, 0, -18], [-30, 3.2, -12], 'reboco', 'paint', 'paint', 'wall', TERRACOTA),
    // quadra (faixa externa sul): arquibancada em degraus de escada
    ...bleachers('arquibancada', [-22, -12], -24.5, 3, 1.1, 0.34, COBOGO),
    crate('caixote_q', -30, -23),
  ];
  return assembleMap(
    { id: 'toca-do-ara.ampliado', family: 'toca-do-ara', familyName: 'Toca do Ara', variant: 'ampliado', version: 1, L, W, lighting: LIGHTING, players: [10, 16] },
    {
      global,
      half,
      spawns0: base.spawns,
      zone0: base.zone,
      capsule: [0, 0, 0],
      objectivesHalf: {
        stations: [[-14, 0, 14.5], [-13, 1.0, -13.4], [-20.5, 1.6, 25.5]],
        pickups: [
          { pos: [-21.5, 0, 9], kind: 'embalo' },
          { pos: [-21.5, 0, -9], kind: 'folego' },
          { pos: [-28, 0, 21], kind: 'embalo' },
        ],
      },
      decorHalf: [
        { kind: 'bandeirinhas', pos: [-39.8, 6.4, 8.2], to: [-26, 6.6, 28.3] },
        { kind: 'bandeirinhas', pos: [-39.8, 6.4, -8.2], to: [-26, 6.6, -28.3] },
        { kind: 'vasos', pos: [-30, 4.0, 28.5], variant: 0 },
        { kind: 'lampiao', pos: [-40.5, 4.0, -14] },
        { kind: 'oficinaFachada', pos: [-21, 0, 0], yaw: Math.PI / 2 },
      ],
      decorGlobal: [...landmarks(L, W, 3.0, 16), ...outskirts(L, W)],
    },
  );
}

export const TOCA_DO_ARA: Record<'compacto' | 'padrao' | 'ampliado', MapSpec> = { compacto: compacto(), padrao: padrao(), ampliado: ampliado() };
