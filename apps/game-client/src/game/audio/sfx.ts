// Receitas dos efeitos sonoros. Cada receita monta um grafo dentro de uma Voice
// e agenda tudo a partir de `t`; `p` multiplica as frequências (pitch/time/variação).

import { Voice, glide, perc, swell } from './synth';

export type SfxId =
  | 'shot_esguicho'
  | 'shot_flick'
  | 'rodo_drag'
  | 'charge_release'
  | 'impact'
  | 'hit_confirm'
  | 'hurt'
  | 'elim_confirm'
  | 'death'
  | 'ink_low'
  | 'refill_done'
  | 'transform_in'
  | 'transform_out'
  | 'jump'
  | 'land'
  | 'throw'
  | 'moringa_tick'
  | 'burst'
  | 'special_ready'
  | 'special_activate'
  | 'wave'
  | 'round_start'
  | 'round_end'
  | 'countdown_tick'
  | 'ui_click'
  | 'ui_hover'
  | 'respawn'
  | 'denied'
  | 'travel_launch'
  | 'travel_land';

export interface SfxMeta {
  /** Ganho base da voz. */
  level: number;
  /** Máximo de vozes simultâneas deste id. */
  cap: number;
  /** Prioridade no limite global (maior = mais importante). */
  priority: number;
  /** Variação aleatória de afinação (±fração). */
  detune: number;
}

const m = (level: number, cap: number, priority: number, detune = 0.02): SfxMeta => ({ level, cap, priority, detune });

export const SFX_META: Record<SfxId, SfxMeta> = {
  shot_esguicho: m(0.5, 6, 1),
  shot_flick: m(0.5, 4, 1),
  rodo_drag: m(0.45, 3, 1),
  charge_release: m(0.5, 4, 1),
  impact: m(0.5, 8, 0, 0.04),
  hit_confirm: m(0.6, 3, 3, 0.006),
  hurt: m(0.65, 2, 3),
  elim_confirm: m(0.6, 2, 3, 0.006),
  death: m(0.6, 3, 2),
  ink_low: m(0.5, 1, 2, 0),
  refill_done: m(0.5, 1, 2, 0),
  transform_in: m(0.45, 3, 1),
  transform_out: m(0.45, 3, 1),
  jump: m(0.45, 3, 1),
  land: m(0.5, 3, 0),
  throw: m(0.5, 3, 1),
  moringa_tick: m(0.5, 4, 2),
  burst: m(0.6, 4, 2),
  special_ready: m(0.5, 1, 3, 0),
  special_activate: m(0.55, 2, 2),
  wave: m(0.55, 2, 2),
  round_start: m(0.55, 1, 4, 0),
  round_end: m(0.55, 1, 4, 0),
  countdown_tick: m(0.55, 1, 4, 0),
  ui_click: m(0.45, 2, 4, 0.006),
  ui_hover: m(0.45, 2, 3, 0.006),
  respawn: m(0.5, 2, 2),
  denied: m(0.5, 1, 3, 0),
  travel_launch: m(0.5, 3, 1),
  travel_land: m(0.55, 3, 1),
};

export const SFX_IDS = Object.keys(SFX_META) as SfxId[];

export type Recipe = (v: Voice, t: number, p: number) => void;

const rnd = Math.random;

// ---------- blocos reutilizados ----------

/** Pop tonal com pequeno "blip" de afinação (confirmações). */
function pop(v: Voice, t: number, f: number, lvl: number): void {
  const g = v.gain(v.out);
  perc(g.gain, t, lvl, 0.002, 0.16);
  const o = v.osc(g, 'sine', f, t, t + 0.19);
  glide(o.frequency, t, f * 1.35, f, 0.018);
  const g2 = v.gain(v.out);
  perc(g2.gain, t, lvl * 0.3, 0.002, 0.08);
  v.osc(g2, 'triangle', f * 2, t, t + 0.1);
}

/** Pião girando: serra num passa-baixa que varre, com trêmolo acelerando (transformação). */
function whirr(v: Voice, t: number, p: number, up: boolean): void {
  const d = 0.18;
  const [f0, f1] = up ? [85, 270] : [270, 85];
  const [c0, c1] = up ? [380, 3200] : [3200, 380];
  const [r0, r1] = up ? [18, 46] : [46, 18];
  const g = v.gain(v.out);
  swell(g.gain, t, 0.55, 0.025, d - 0.07, 0.06);
  const am = v.gain(g, 0.6);
  const l = v.lfo(am.gain, 'sine', r0, 0.4, t, t + d + 0.02);
  glide(l.osc.frequency, t, r0, r1, d);
  const lp = v.filter(am, 'lowpass', c0 * p, 4);
  glide(lp.frequency, t, c0 * p, c1 * p, d);
  const mix = v.gain(lp, 0.5);
  const o1 = v.osc(mix, 'sawtooth', f0 * p, t, t + d + 0.02);
  glide(o1.frequency, t, f0 * p, f1 * p, d);
  const o2 = v.osc(mix, 'sawtooth', f0 * p * 1.5, t, t + d + 0.02);
  glide(o2.frequency, t, f0 * p * 1.5, f1 * p * 1.5, d);
}

/** Tom de apito com vibrato e sopro. */
function whistle(v: Voice, t: number, f: number, dur: number): void {
  const g = v.gain(v.out);
  swell(g.gain, t, 0.32, 0.015, dur, 0.05);
  const o = v.osc(g, 'sine', f, t, t + dur + 0.08);
  v.lfo(o.frequency, 'sine', 7, f * 0.012, t, t + dur + 0.08);
  const h = v.gain(v.out);
  swell(h.gain, t, 0.05, 0.015, dur, 0.05);
  v.osc(h, 'sine', f * 2, t, t + dur + 0.08);
  const ng = v.gain(v.out);
  swell(ng.gain, t, 0.12, 0.015, dur, 0.05);
  const bp = v.filter(ng, 'bandpass', f, 6);
  v.noise(bp, t, dur + 0.08);
}

// ---------- receitas ----------

export const SFX_RECIPES: Record<SfxId, Recipe> = {
  // "pssht" pressurizado: ruído em banda descendo + clique tonal curtinho
  shot_esguicho: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.9, 0.003, 0.065);
    const bp = v.filter(g, 'bandpass', 2600 * p, 1.1);
    glide(bp.frequency, t, 3400 * p, 1500 * p, 0.07);
    const hp = v.filter(bp, 'highpass', 700, 0.7);
    v.noise(hp, t, 0.09);
    const cg = v.gain(v.out);
    perc(cg.gain, t, 0.22, 0.001, 0.018);
    const o = v.osc(cg, 'sine', 1900 * p, t, t + 0.03);
    glide(o.frequency, t, 1900 * p, 950 * p, 0.018);
  },

  // varrida molhada: banda sobe e desce, com uma gotinha no fim
  shot_flick: (v, t, p) => {
    const g = v.gain(v.out);
    swell(g.gain, t, 0.95, 0.035, 0.02, 0.14);
    const bp = v.filter(g, 'bandpass', 500 * p, 2.2);
    bp.frequency.setValueAtTime(500 * p, t);
    bp.frequency.exponentialRampToValueAtTime(2600 * p, t + 0.08);
    bp.frequency.exponentialRampToValueAtTime(900 * p, t + 0.2);
    v.noise(bp, t, 0.22);
    const tt = t + 0.07;
    const dg = v.gain(v.out);
    perc(dg.gain, tt, 0.25, 0.002, 0.07);
    const o = v.osc(dg, 'sine', 380 * p, tt, tt + 0.09);
    glide(o.frequency, tt, 380 * p, 900 * p, 0.06);
  },

  // rangido de borracha: serra filtrada com vibrato rápido + arrasto molhado
  rodo_drag: (v, t, p) => {
    const d = 0.2;
    const g = v.gain(v.out);
    swell(g.gain, t, 0.6, 0.02, 0.1, 0.08);
    const bp = v.filter(g, 'bandpass', 1500 * p, 4);
    const o = v.osc(bp, 'sawtooth', 560 * p, t, t + d + 0.02);
    o.frequency.setValueAtTime(560 * p, t);
    o.frequency.linearRampToValueAtTime(760 * p, t + 0.08);
    o.frequency.linearRampToValueAtTime(640 * p, t + d);
    v.lfo(o.frequency, 'sine', 34, 40 * p, t, t + d + 0.02);
    const ng = v.gain(v.out);
    swell(ng.gain, t, 0.2, 0.03, 0.08, 0.08);
    const lp = v.filter(ng, 'lowpass', 900, 0.7);
    v.noise(lp, t, d + 0.02);
  },

  // "thwang" elástico: queda de afinação com vibrato que morre + estalo
  charge_release: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.6, 0.004, 0.32);
    const lp = v.filter(g, 'lowpass', 3200, 3);
    glide(lp.frequency, t, 3200, 480, 0.3);
    const mix = v.gain(lp, 0.55);
    const o1 = v.osc(mix, 'sawtooth', 560 * p, t, t + 0.36);
    glide(o1.frequency, t, 560 * p, 120 * p, 0.28);
    const o2 = v.osc(mix, 'triangle', 280 * p, t, t + 0.36);
    glide(o2.frequency, t, 280 * p, 60 * p, 0.28);
    const vib = v.lfo([o1.frequency, o2.frequency], 'sine', 16, 0, t, t + 0.36);
    perc(vib.depth.gain, t, 28 * p, 0.002, 0.3);
    const ng = v.gain(v.out);
    perc(ng.gain, t, 0.35, 0.001, 0.025);
    const hp = v.filter(ng, 'highpass', 2500, 0.7);
    v.noise(hp, t, 0.03);
  },

  // splat macio: ruído em passa-baixa fechando rápido + "plop" grave
  impact: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.85, 0.002, 0.14);
    const lp = v.filter(g, 'lowpass', 2200 * p, 0.9);
    glide(lp.frequency, t, 2200 * p, 280 * p, 0.13);
    v.noise(lp, t, 0.16, 0.8);
    const bg = v.gain(v.out);
    perc(bg.gain, t, 0.35, 0.002, 0.09);
    const o = v.osc(bg, 'sine', 200 * p, t, t + 0.12);
    glide(o.frequency, t, 200 * p, 70 * p, 0.09);
  },

  // "tink" cerâmico: dois parciais inarmônicos (1,48 k / 2,23 k) + transiente
  hit_confirm: (v, t, p) => {
    const g1 = v.gain(v.out);
    perc(g1.gain, t, 0.45, 0.001, 0.2);
    v.osc(g1, 'sine', 1480 * p, t, t + 0.22);
    const g2 = v.gain(v.out);
    perc(g2.gain, t, 0.28, 0.001, 0.12);
    v.osc(g2, 'sine', 2230 * p, t, t + 0.14);
    const ng = v.gain(v.out);
    perc(ng.gain, t, 0.15, 0.0005, 0.008);
    const hp = v.filter(ng, 'highpass', 5000, 0.7);
    v.noise(hp, t, 0.012);
  },

  // baque abafado + seno grave
  hurt: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.7, 0.003, 0.09);
    const lp = v.filter(g, 'lowpass', 420 * p, 1);
    v.noise(lp, t, 0.11);
    const sg = v.gain(v.out);
    perc(sg.gain, t, 0.6, 0.004, 0.26);
    const o = v.osc(sg, 'sine', 130 * p, t, t + 0.3);
    glide(o.frequency, t, 130 * p, 52 * p, 0.22);
  },

  // dois pops alegres em quinta justa
  elim_confirm: (v, t, p) => {
    pop(v, t, 660 * p, 0.42);
    pop(v, t + 0.085, 990 * p, 0.45);
  },

  // rachadura cerâmica (micro-estalos + parciais) seguida de pop grave
  death: (v, t, p) => {
    let tt = t;
    for (let i = 0; i < 4; i++) {
      const g = v.gain(v.out);
      perc(g.gain, tt, 0.5 - i * 0.08, 0.0008, 0.018 + rnd() * 0.012);
      const bp = v.filter(g, 'bandpass', (2600 + rnd() * 2400) * p, 1.5);
      v.noise(bp, tt, 0.04);
      tt += 0.012 + rnd() * 0.02;
    }
    [1730, 2890, 4120].forEach((f, i) => {
      const g = v.gain(v.out);
      perc(g.gain, t, 0.12 / (i + 1), 0.001, 0.12 - i * 0.025);
      v.osc(g, 'sine', f * p, t, t + 0.14);
    });
    const tp = t + 0.09;
    const g = v.gain(v.out);
    perc(g.gain, tp, 0.55, 0.003, 0.16);
    const o = v.osc(g, 'sine', 460 * p, tp, tp + 0.2);
    glide(o.frequency, tp, 460 * p, 110 * p, 0.13);
    const pg = v.gain(v.out);
    perc(pg.gain, tp, 0.3, 0.004, 0.2);
    const lp = v.filter(pg, 'lowpass', 900 * p, 0.8);
    v.noise(lp, tp, 0.22);
  },

  // bipe duplo suave, descendente ("acabando")
  ink_low: (v, t, p) => {
    const beep = (tt: number, f: number): void => {
      const g = v.gain(v.out);
      swell(g.gain, tt, 0.3, 0.006, 0.04, 0.05);
      const lp = v.filter(g, 'lowpass', 2200, 0.7);
      v.osc(lp, 'triangle', f, tt, tt + 0.11);
    };
    beep(t, 740 * p);
    beep(t + 0.13, 622 * p);
  },

  // arpejo rápido subindo (Sol maior)
  refill_done: (v, t, p) => {
    [784, 988, 1175].forEach((f, i) => {
      const tt = t + i * 0.055;
      const g = v.gain(v.out);
      perc(g.gain, tt, 0.3, 0.003, 0.16);
      v.osc(g, 'triangle', f * p, tt, tt + 0.18);
      const g2 = v.gain(v.out);
      perc(g2.gain, tt, 0.1, 0.002, 0.08);
      v.osc(g2, 'sine', f * 2 * p, tt, tt + 0.1);
    });
  },

  transform_in: (v, t, p) => whirr(v, t, p, true),
  transform_out: (v, t, p) => whirr(v, t, p, false),

  // "boing" de mola
  jump: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.42, 0.004, 0.16);
    const o = v.osc(g, 'triangle', 190 * p, t, t + 0.19);
    glide(o.frequency, t, 190 * p, 480 * p, 0.1);
    const l = v.lfo(o.frequency, 'sine', 26, 0, t, t + 0.19);
    perc(l.depth.gain, t, 40 * p, 0.02, 0.15);
  },

  // toque macio no chão
  land: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.5, 0.002, 0.05);
    const lp = v.filter(g, 'lowpass', 700 * p, 0.8);
    v.noise(lp, t, 0.07);
    const sg = v.gain(v.out);
    perc(sg.gain, t, 0.32, 0.002, 0.07);
    const o = v.osc(sg, 'sine', 150 * p, t, t + 0.09);
    glide(o.frequency, t, 150 * p, 75 * p, 0.06);
  },

  // "fuuu" de arremesso
  throw: (v, t, p) => {
    const g = v.gain(v.out);
    swell(g.gain, t, 0.85, 0.06, 0.03, 0.15);
    const bp = v.filter(g, 'bandpass', 350 * p, 1.6);
    bp.frequency.setValueAtTime(350 * p, t);
    bp.frequency.exponentialRampToValueAtTime(1900 * p, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(1100 * p, t + 0.25);
    v.noise(bp, t, 0.26);
  },

  // "tok" de barro oco (pavio da moringa)
  moringa_tick: (v, t, p) => {
    const g1 = v.gain(v.out);
    perc(g1.gain, t, 0.42, 0.001, 0.07);
    const o1 = v.osc(g1, 'sine', 780 * p, t, t + 0.08);
    glide(o1.frequency, t, 780 * p, 680 * p, 0.03);
    const g2 = v.gain(v.out);
    perc(g2.gain, t, 0.16, 0.001, 0.035);
    v.osc(g2, 'sine', 1130 * p, t, t + 0.045);
    const ng = v.gain(v.out);
    perc(ng.gain, t, 0.25, 0.0005, 0.012);
    const bp = v.filter(ng, 'bandpass', 1600 * p, 3);
    v.noise(bp, t, 0.02);
  },

  // splash grande com corpo grave e gotas espalhadas
  burst: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.8, 0.003, 0.42);
    const lp = v.filter(g, 'lowpass', 3400 * p, 0.8);
    glide(lp.frequency, t, 3400 * p, 320 * p, 0.4);
    v.noise(lp, t, 0.46, 0.7);
    const bg = v.gain(v.out);
    perc(bg.gain, t, 0.7, 0.004, 0.32);
    const o = v.osc(bg, 'sine', 110 * p, t, t + 0.36);
    glide(o.frequency, t, 110 * p, 38 * p, 0.3);
    for (let i = 0; i < 4; i++) {
      const tt = t + 0.06 + rnd() * 0.22;
      const dg = v.gain(v.out);
      perc(dg.gain, tt, 0.12 + rnd() * 0.1, 0.001, 0.03);
      const bp = v.filter(dg, 'bandpass', (900 + rnd() * 1400) * p, 2.5);
      v.noise(bp, tt, 0.04);
    }
  },

  // acorde quente (Sol add9) abrindo o filtro
  special_ready: (v, t, p) => {
    const g = v.gain(v.out);
    swell(g.gain, t, 0.55, 0.28, 0.25, 0.6);
    const lp = v.filter(g, 'lowpass', 600, 0.7);
    glide(lp.frequency, t, 600, 2600, 0.35);
    const mix = v.gain(lp, 0.12);
    for (const f of [392, 494, 587, 880]) {
      v.osc(mix, 'triangle', f * p, t, t + 1.2);
      v.osc(mix, 'sawtooth', f * p * 1.004, t, t + 1.2);
    }
  },

  // torno de oleiro acelerando: zumbido com trêmolo rotativo cada vez mais rápido
  special_activate: (v, t, p) => {
    const d = 0.85;
    const g = v.gain(v.out);
    swell(g.gain, t, 0.6, 0.15, d - 0.35, 0.2);
    const am = v.gain(g, 0.65);
    const l = v.lfo(am.gain, 'sine', 3, 0.35, t, t + d);
    glide(l.osc.frequency, t, 3, 22, d * 0.8);
    const lp = v.filter(am, 'lowpass', 250 * p, 5);
    glide(lp.frequency, t, 250 * p, 2400 * p, d * 0.8);
    const mix = v.gain(lp, 0.4);
    const o1 = v.osc(mix, 'sawtooth', 48 * p, t, t + d);
    glide(o1.frequency, t, 48 * p, 190 * p, d * 0.8);
    const o2 = v.osc(mix, 'square', 72 * p, t, t + d);
    glide(o2.frequency, t, 72 * p, 285 * p, d * 0.8);
    const ng = v.gain(v.out);
    swell(ng.gain, t, 0.2, 0.4, 0.2, 0.2);
    const bp = v.filter(ng, 'bandpass', 400 * p, 2);
    glide(bp.frequency, t, 400 * p, 3000 * p, d * 0.8);
    v.noise(bp, t, d);
  },

  // "whoomp" grave em varredura
  wave: (v, t, p) => {
    const g = v.gain(v.out);
    swell(g.gain, t, 0.6, 0.08, 0.08, 0.35);
    const o = v.osc(g, 'sine', 48 * p, t, t + 0.55);
    o.frequency.setValueAtTime(48 * p, t);
    o.frequency.exponentialRampToValueAtTime(120 * p, t + 0.14);
    o.frequency.exponentialRampToValueAtTime(42 * p, t + 0.5);
    const ng = v.gain(v.out);
    swell(ng.gain, t, 0.4, 0.1, 0.05, 0.3);
    const lp = v.filter(ng, 'lowpass', 180, 2);
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.exponentialRampToValueAtTime(1400 * p, t + 0.14);
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.5);
    v.noise(lp, t, 0.52);
  },

  // apito de dois tons (curto, longo)
  round_start: (v, t, p) => {
    whistle(v, t, 1175 * p, 0.14);
    whistle(v, t + 0.2, 1568 * p, 0.32);
  },

  // sino: parciais aditivos com decaimento longo (Sol)
  round_end: (v, t, p) => {
    const f = 392 * p;
    const partials: Array<[number, number, number]> = [
      [0.5, 0.16, 2.6],
      [1, 0.22, 2.2],
      [1.19, 0.09, 1.6],
      [1.5, 0.08, 1.3],
      [2, 0.1, 1.1],
      [2.52, 0.05, 0.8],
      [3, 0.04, 0.6],
      [4.07, 0.03, 0.4],
    ];
    for (const [r, a, d] of partials) {
      const g = v.gain(v.out);
      perc(g.gain, t, a, 0.002, d);
      v.osc(g, 'sine', f * r, t, t + d + 0.05);
    }
    const ng = v.gain(v.out);
    perc(ng.gain, t, 0.12, 0.001, 0.02);
    const bp = v.filter(ng, 'bandpass', f * 4, 2);
    v.noise(bp, t, 0.03);
  },

  // bloco de madeira
  countdown_tick: (v, t, p) => {
    const f = 1050 * p;
    const g = v.gain(v.out);
    perc(g.gain, t, 0.45, 0.0008, 0.055);
    v.osc(g, 'sine', f, t, t + 0.07);
    const g2 = v.gain(v.out);
    perc(g2.gain, t, 0.15, 0.0008, 0.03);
    v.osc(g2, 'triangle', f * 2.3, t, t + 0.04);
    const ng = v.gain(v.out);
    perc(ng.gain, t, 0.3, 0.0005, 0.01);
    const bp = v.filter(ng, 'bandpass', f * 1.5, 6);
    v.noise(bp, t, 0.015);
  },

  ui_click: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.32, 0.001, 0.028);
    const o = v.osc(g, 'sine', 2300 * p, t, t + 0.035);
    glide(o.frequency, t, 2300 * p, 1500 * p, 0.02);
  },

  ui_hover: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.12, 0.002, 0.02);
    v.osc(g, 'sine', 1760 * p, t, t + 0.03);
  },

  // subida cintilante (pentatônica de Sol) + glissando e brilho de ruído
  respawn: (v, t, p) => {
    [392, 440, 587, 659, 784, 880, 1175, 1319].forEach((f, i) => {
      const tt = t + i * 0.045;
      const g = v.gain(v.out);
      perc(g.gain, tt, 0.13, 0.004, 0.25);
      v.osc(g, 'sine', f * p, tt, tt + 0.28);
    });
    const gg = v.gain(v.out);
    swell(gg.gain, t, 0.12, 0.3, 0.1, 0.3);
    const o = v.osc(gg, 'triangle', 280 * p, t, t + 0.72);
    glide(o.frequency, t, 280 * p, 1100 * p, 0.5);
    const ng = v.gain(v.out);
    swell(ng.gain, t, 0.06, 0.35, 0.05, 0.25);
    const hp = v.filter(ng, 'highpass', 5000, 0.7);
    v.noise(hp, t, 0.66);
  },

  // zumbido grave curto (batimento entre dois quadrados)
  denied: (v, t, p) => {
    const g = v.gain(v.out);
    swell(g.gain, t, 0.4, 0.008, 0.12, 0.04);
    const lp = v.filter(g, 'lowpass', 900, 0.8);
    const mix = v.gain(lp, 0.5);
    v.osc(mix, 'square', 110 * p, t, t + 0.18);
    v.osc(mix, 'square', 116.5 * p, t, t + 0.18);
  },

  // lançamento de mola: boing subindo + vento
  travel_launch: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.42, 0.005, 0.35);
    const o = v.osc(g, 'triangle', 130 * p, t, t + 0.38);
    glide(o.frequency, t, 130 * p, 620 * p, 0.25);
    const l = v.lfo(o.frequency, 'sine', 22, 0, t, t + 0.38);
    perc(l.depth.gain, t, 45 * p, 0.01, 0.3);
    const ng = v.gain(v.out);
    swell(ng.gain, t, 0.3, 0.08, 0.06, 0.28);
    const bp = v.filter(ng, 'bandpass', 450 * p, 1.4);
    glide(bp.frequency, t, 450 * p, 2600 * p, 0.35);
    v.noise(bp, t, 0.45);
  },

  // pouso: baque grave + mola amortecendo
  travel_land: (v, t, p) => {
    const g = v.gain(v.out);
    perc(g.gain, t, 0.65, 0.003, 0.22);
    const o = v.osc(g, 'sine', 130 * p, t, t + 0.25);
    glide(o.frequency, t, 130 * p, 42 * p, 0.16);
    const ng = v.gain(v.out);
    perc(ng.gain, t, 0.45, 0.002, 0.13);
    const lp = v.filter(ng, 'lowpass', 520 * p, 0.9);
    v.noise(lp, t, 0.15);
    const ts = t + 0.03;
    const sg = v.gain(v.out);
    perc(sg.gain, ts, 0.12, 0.005, 0.2);
    const so = v.osc(sg, 'triangle', 260 * p, ts, ts + 0.22);
    v.lfo(so.frequency, 'sine', 18, 30 * p, ts, ts + 0.22);
  },
};
