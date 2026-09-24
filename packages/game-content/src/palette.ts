/**
 * Tokens de cor do jogo, num só lugar, em três conjuntos que não se misturam:
 *
 *  1. MARCA E INTERFACE — referência: `trivo logo.svg`, recebido no repositório
 *     (commit 4e77adc). Os valores abaixo são os preenchimentos EXATOS desse
 *     arquivo, lidos dele; não foram confirmados como a paleta oficial do Trivo.
 *  2. EQUIPES — pares de cores de apresentação escolhidos pelo servidor a cada
 *     rodada. `TeamId` continua sendo a identidade lógica; cor, nome e padrão são
 *     só apresentação (e a acessibilidade pode remapear localmente).
 *  3. CENÁRIO — decoração do mundo. Fica longe das cores de equipe: uma arara
 *     azul no fundo não pode parecer um jogador da equipe azul.
 *
 * A separação é verificada por teste (distância no espaço OKLab), não a olho.
 */

// ------------------------------------------------------------ 1. marca e interface
/** Preenchimentos presentes em `trivo logo.svg` (a arara do Trivo). */
export const TRIVO_SVG = {
  azul: '#003fcc',
  azulProfundo: '#002ba0',
  azulTraco: '#0034b4',
  verde: '#008e32',
  amarelo: '#febd00',
  branco: '#fbfaf9',
} as const;

/** Tokens semânticos da interface (menus, botões, foco). Derivados do SVG + superfícies do jogo. */
export const UI_TOKENS = {
  destaque: TRIVO_SVG.amarelo,
  marca: TRIVO_SVG.azul,
  marcaProfunda: TRIVO_SVG.azulProfundo,
  sucesso: TRIVO_SVG.verde,
  texto: TRIVO_SVG.branco,
  superficie: '#1d1411',
  superficieAlta: '#2b1f1a',
} as const;

// ------------------------------------------------------------ 2. equipes
export interface TeamLook {
  /** Nome de apresentação ("Turma Urucum"). Não é identidade. */
  name: string;
  color: string;
}

export interface TeamPair {
  id: string;
  /** Nome do par para configurações e documentação. */
  label: string;
  teams: readonly [TeamLook, TeamLook];
}

/**
 * Pares aprovados pela legibilidade (teste: distância entre as duas cores, também
 * sob daltonismo simulado, e distância do cenário e do azul da marca). Os nomes
 * vêm de pigmentos e frutos brasileiros e mudam com o par.
 */
export const TEAM_PAIRS: readonly TeamPair[] = [
  { id: 'urucum-anil', label: 'Urucum × Anil (laranja × azul)', teams: [{ name: 'Urucum', color: '#ff6414' }, { name: 'Anil', color: '#4a3dff' }] },
  { id: 'acai-mate', label: 'Açaí × Mate (roxo × verde)', teams: [{ name: 'Açaí', color: '#9b3df2' }, { name: 'Mate', color: '#35c46a' }] },
  { id: 'pitanga-jenipapo', label: 'Pitanga × Jenipapo (vermelho × turquesa)', teams: [{ name: 'Pitanga', color: '#c81e3c' }, { name: 'Jenipapo', color: '#5fe6ea' }] },
];

export const DEFAULT_TEAM_PAIR_ID = TEAM_PAIRS[0].id;

export function teamPair(id: string | null | undefined): TeamPair {
  return TEAM_PAIRS.find((p) => p.id === id) ?? TEAM_PAIRS[0];
}

/** Par da rodada: gira pela lista a partir de uma semente da partida (determinístico, sem repetir em seguida). */
export function pickTeamPair(matchSeed: number, roundId: number): TeamPair {
  const n = TEAM_PAIRS.length;
  return TEAM_PAIRS[(((matchSeed >>> 0) % n) + roundId) % n];
}

// ------------------------------------------------------------ 3. cenário
/**
 * Decoração do mundo. As bandeirinhas e o futuro mural da arara usam tons
 * dessaturados/escuros de propósito: leem como "cenário" e não como tinta.
 */
export const SCENERY_TOKENS = {
  bandeirinhas: ['#c9776b', '#d9b35c', '#6f93b8', '#7faa7a', '#c98fb4'],
  araraAzul: '#48628f',
  araraAmarelo: '#c8a25a',
  araraVerde: '#5f8a63',
  toldo: '#b9674f',
  madeira: '#8a5a3b',
  terracota: '#b0603f',
} as const;

// ------------------------------------------------------------ utilidades de cor
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB (0..1) → OKLab (Björn Ottosson, 2020). */
export function oklab(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** Distância perceptual aproximada (ΔE no OKLab; ~0.02 é o limiar de percepção). */
export function colorDistance(a: string, b: string): number {
  const x = oklab(hexToRgb(a));
  const y = oklab(hexToRgb(b));
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** Simulação de dicromacia (Viénot, Brettel e Mollon, 1999) para checar pares sob daltonismo. */
export function simulateCvd(hex: string, kind: 'protan' | 'deutan' | 'tritan'): string {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const M = {
    protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
    tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
  }[kind];
  const out = [M[0] * r + M[1] * g + M[2] * b, M[3] * r + M[4] * g + M[5] * b, M[6] * r + M[7] * g + M[8] * b].map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, c))))) * 255));
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
