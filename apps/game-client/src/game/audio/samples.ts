// Manifesto dos efeitos sonoros do Borrifo: cada evento aponta para arquivos
// de áudio GRAVADOS/baixados (CC0, ver AUDIO_CREDITS.md), editados por
// scripts/audio/build_sfx.py. Nada aqui é sintetizado.

/** Arquivos servidos em public/audio/sfx (efeitos em .mp3, loops em .wav). */
export const SAMPLE_DIR = 'audio/sfx/';

export interface SfxDef {
  /** Variações (sorteadas sem repetir a anterior). */
  files: readonly string[];
  /** Ganho de mixagem (0..1). */
  level: number;
  /** Máximo de vozes simultâneas deste efeito. */
  cap: number;
  /** 0 (descartável) .. 4 (nunca roubado por sons comuns). */
  priority: number;
  /** Variação aleatória de afinação (fração, ex.: 0.05 = ±5%). */
  detune: number;
  /** Variação aleatória de volume (fração). */
  volVar: number;
  /** Intervalo mínimo entre dois disparos do mesmo efeito (s). Evita duplicação. */
  minGap: number;
}

const fx = (files: readonly string[], level: number, cap: number, priority: number, detune = 0.04, volVar = 0.1, minGap = 0.02): SfxDef => ({
  files,
  level,
  cap,
  priority,
  detune,
  volVar,
  minGap,
});

const n = (base: string, count: number): string[] => Array.from({ length: count }, (_, i) => `${base}-${i + 1}`);

export const SFX = {
  // ---- combate com tinta
  shot_esguicho: fx(n('esguicho', 4), 0.32, 4, 1, 0.06, 0.15, 0.03),
  shot_flick: fx(n('rodo', 2), 0.5, 3, 1, 0.05),
  charge_release: fx(n('estilingue', 2), 0.55, 3, 2, 0.04),
  impact: fx(n('impacto', 5), 0.42, 6, 0, 0.1, 0.2, 0.012),
  hit_confirm: fx(['acerto'], 0.5, 3, 3, 0.03, 0.05, 0.05),
  hurt: fx(n('dano', 2), 0.9, 2, 3, 0.04, 0.05, 0.08),
  elim_confirm: fx(['eliminou'], 0.65, 2, 4, 0.02, 0),
  death: fx(n('splat', 2), 0.62, 3, 2, 0.05),
  // ---- movimentação
  step_stone: fx(n('passo-pedra', 5), 0.42, 4, 0, 0.06, 0.15, 0.06),
  step_wood: fx(n('passo-madeira', 5), 0.5, 4, 0, 0.06, 0.15, 0.06),
  step_ink: fx(n('passo-tinta', 4), 0.3, 4, 0, 0.08, 0.2, 0.06),
  jump: fx(n('pulo', 2), 0.35, 2, 1, 0.06),
  land: fx(n('aterrissa', 3), 0.55, 3, 1, 0.05, 0.1, 0.1),
  transform_in: fx(['mergulho'], 0.4, 2, 1, 0.05, 0.1, 0.08),
  transform_out: fx(['emerge'], 0.4, 2, 1, 0.05, 0.1, 0.08),
  // ---- equipamentos e habilidades
  ink_low: fx(['tanque-baixo'], 0.5, 1, 3, 0, 0, 0.5),
  ink_empty: fx(['tanque-vazio'], 0.45, 1, 3, 0.03, 0, 0.4),
  refill_done: fx(['recarga-cheia'], 0.5, 1, 2, 0, 0, 0.5),
  throw: fx(['moringa-lanca'], 0.45, 3, 1, 0.05),
  burst: fx(['moringa-estoura'], 0.7, 3, 2, 0.05),
  special_ready: fx(['especial-pronto'], 0.5, 1, 3, 0, 0, 1),
  special_activate: fx(['roda-lanca'], 0.55, 2, 2, 0.03),
  wave: fx(n('roda-onda', 2), 0.6, 3, 2, 0.05),
  travel_launch: fx(['piao-lanca'], 0.45, 2, 1, 0.03),
  travel_land: fx(['piao-pousa'], 0.55, 2, 1, 0.04),
  respawn: fx(['reaparece'], 0.5, 2, 2, 0.02),
  // ---- interface e partida (não posicionais)
  ui_confirm: fx(['ui-confirma'], 0.42, 2, 4, 0, 0, 0.05),
  ui_back: fx(['ui-volta'], 0.5, 2, 4, 0, 0, 0.05),
  denied: fx(['negado'], 0.45, 1, 3, 0, 0, 0.25),
  countdown_tick: fx(['contagem'], 0.5, 1, 4, 0, 0, 0.3),
  round_start: fx(['inicio'], 0.55, 1, 4, 0, 0, 1),
  round_end: fx(['fim-sino'], 0.6, 1, 4, 0, 0, 1),
  victory: fx(['vitoria'], 0.6, 1, 4, 0, 0, 1),
  defeat: fx(['derrota'], 0.6, 1, 4, 0, 0, 1),
  draw: fx(['empate'], 0.55, 1, 4, 0, 0, 1),
} as const satisfies Record<string, SfxDef>;

export type SfxId = keyof typeof SFX;
export const SFX_IDS = Object.keys(SFX) as SfxId[];

export interface LoopDef {
  file: string;
  level: number;
  /** false: toca uma vez e pode ser interrompido (ex.: elástico carregando). */
  loop: boolean;
  /** Ganho e velocidade de reprodução conforme o parâmetro 0..1 do jogo. */
  gain: readonly [number, number];
  rate: readonly [number, number];
  /** Máximo simultâneo deste loop. */
  cap: number;
}

export const LOOPS = {
  swim: { file: 'loop-nado', level: 0.4, loop: true, gain: [0.45, 1], rate: [0.9, 1.1], cap: 2 },
  enemy_ink: { file: 'loop-tinta-inimiga', level: 0.34, loop: true, gain: [1, 1], rate: [1, 1], cap: 2 },
  rodo_drag: { file: 'loop-rodo', level: 0.5, loop: true, gain: [0.5, 1], rate: [0.92, 1.08], cap: 4 },
  wheel_hum: { file: 'loop-roda', level: 0.5, loop: true, gain: [1, 1], rate: [1, 1], cap: 4 },
  charge: { file: 'carga', level: 0.5, loop: false, gain: [1, 1], rate: [1, 1], cap: 3 },
} as const satisfies Record<string, LoopDef>;

export type LoopId = keyof typeof LOOPS;
export const LOOP_IDS = Object.keys(LOOPS) as LoopId[];

/** Todos os arquivos que o jogo carrega (nome → URL relativa). */
export function sampleFiles(): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of Object.values(SFX) as SfxDef[]) for (const f of d.files) m.set(f, `${SAMPLE_DIR}${f}.mp3`);
  for (const d of Object.values(LOOPS) as LoopDef[]) m.set(d.file, `${SAMPLE_DIR}${d.file}.${d.loop ? 'wav' : 'mp3'}`);
  return m;
}
