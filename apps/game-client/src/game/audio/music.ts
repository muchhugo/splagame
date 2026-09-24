// Trilha generativa original: groove de inspiração nordestina (baião/maracatu)
// em Sol mixolídio, ~106–111 BPM. Agendador com antecedência (lookahead):
// um setTimeout de 25 ms agenda as notas que caem nos próximos 120 ms.

import { Voice, clamp, glide, mtof, mulberry32, perc, swell } from './synth';

const LOOKAHEAD = 0.12;
const TICK_MS = 25;
const BPM_BASE = 106;
const BPM_BOOST = 5; // intensidade 1 → 111 BPM
const SWING = 0.1; // atraso das semicolcheias ímpares (fração do passo)
const THEME_SEED = 0x0b0441f0;

// Sol mixolídio: graus em semitons a partir de Sol.
const SCALE = [0, 2, 4, 5, 7, 9, 10];
const MEL_ROOT = 67; // Sol4 = grau 0 da melodia
const PAD_ROOT = 55; // Sol3

interface Chord {
  root: number; // semitons acima de Sol
  third: number; // 4 maior, 3 menor
  tones: readonly number[]; // graus da escala (0..6) do acorde
}

const CH = {
  I: { root: 0, third: 4, tones: [0, 2, 4] },
  bVII: { root: 10, third: 4, tones: [6, 1, 3] },
  IV: { root: 5, third: 4, tones: [3, 5, 0] },
  ii: { root: 2, third: 3, tones: [1, 3, 5] },
  v: { root: 7, third: 3, tones: [4, 6, 1] },
} satisfies Record<string, Chord>;

// Quatro frases de 4 compassos formam o ciclo (A B C D).
const FORMS: readonly (readonly Chord[])[] = [
  [CH.I, CH.I, CH.bVII, CH.IV],
  [CH.I, CH.bVII, CH.IV, CH.I],
  [CH.IV, CH.IV, CH.I, CH.bVII],
  [CH.ii, CH.v, CH.bVII, CH.I],
];

// Percussão por semicolcheia (16 passos): zabumba 3+3+2, aro no 2 e 4, fantasmas.
const KICK = [1, 0, 0, 0.7, 0, 0, 0, 0, 0.9, 0, 0, 0.65, 0, 0, 0, 0];
const KICK_HOT = [0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.5, 0];
const RIM = [0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
const RIM_GHOST = [0, 0, 0.25, 0, 0, 0, 0, 0.3, 0, 0, 0.35, 0, 0, 0, 0, 0.3];
const TOM_FILL = [196, 175, 147, 131]; // virada de alfaia (passos 12..15 do 4º compasso)

// Baixo: [passo, papel, duração em passos, intensidade]; papel 0=tônica 1=quinta 2=oitava 3=terça 4=aproximação
type BassHit = readonly [number, number, number, number];
const BASS_PATTERNS: readonly (readonly BassHit[])[] = [
  [[0, 0, 3, 1], [3, 1, 3, 0.8], [8, 2, 2, 0.85], [11, 1, 2, 0.75], [14, 4, 2, 0.7]],
  [[0, 0, 5, 1], [6, 0, 2, 0.7], [8, 1, 3, 0.85], [11, 3, 2, 0.7], [14, 4, 2, 0.7]],
  [[0, 0, 3, 1], [3, 0, 3, 0.75], [6, 1, 2, 0.7], [8, 2, 3, 0.85], [11, 1, 3, 0.75], [14, 4, 2, 0.65]],
];

// Células rítmicas sincopadas da melodia (passos dentro do compasso).
const CELLS = [
  [0, 3, 6, 8, 10],
  [0, 3, 6, 10, 12],
  [2, 4, 6, 8, 11, 14],
  [0, 2, 3, 6, 8, 12],
  [3, 6, 8, 11, 14],
  [0, 6, 8, 10, 12, 14],
];
const ENDINGS = [
  [0, 3, 6],
  [0, 2, 4, 8],
  [2, 4, 6, 8],
  [0, 3, 8],
];
const MOVES = [-2, -1, -1, 1, 1, 2, 0, 3, -3];

interface MelNote {
  idx: number;
  vel: number;
  long: boolean;
}
interface BassNote {
  midi: number;
  len: number;
  vel: number;
}
interface PhrasePlan {
  phrase: number;
  chords: readonly Chord[];
  mel: (MelNote | undefined)[]; // 64 passos
  bass: (BassNote | undefined)[];
}

const mod7 = (i: number): number => ((i % 7) + 7) % 7;
const idxToMidi = (idx: number): number => MEL_ROOT + 12 * Math.floor(idx / 7) + SCALE[mod7(idx)];
const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

/** Grau mais próximo que pertence ao acorde. */
function snap(idx: number, ch: Chord): number {
  for (let d = 0; d < 4; d++) {
    if (ch.tones.includes(mod7(idx - d))) return idx - d;
    if (ch.tones.includes(mod7(idx + d))) return idx + d;
  }
  return idx;
}

function bassRoot(ch: Chord): number {
  const m = 43 + ch.root; // Sol2
  return ch.root > 5 ? m - 12 : m;
}

/** Motivo: 3 compassos de "pergunta" (mesma célula, adaptada ao acorde) + resposta que resolve. */
function makeMelody(rng: () => number, chords: readonly Chord[]): (MelNote | undefined)[] {
  const out: (MelNote | undefined)[] = new Array(64);
  const cell = pick(rng, CELLS);
  const moves = cell.map((_, i) => (i === 0 ? 0 : pick(rng, MOVES)));
  let anchor = 2 + Math.floor(rng() * 4);
  let cur = anchor;
  for (let bar = 0; bar < 3; bar++) {
    const ch = chords[bar];
    anchor = snap(anchor, ch);
    cur = anchor;
    for (let i = 0; i < cell.length; i++) {
      if (i > 0) cur += moves[i] + (bar === 2 && rng() < 0.35 ? (rng() < 0.5 ? -1 : 1) : 0);
      cur = clamp(cur, -2, 9);
      const step = cell[i];
      const strong = step === 0 || step === 6 || step === 8;
      if (strong) cur = snap(cur, ch);
      if (bar === 1 && i === cell.length - 1 && rng() < 0.5) continue; // respiro
      out[bar * 16 + step] = { idx: cur, vel: strong ? 1 : 0.72, long: false };
    }
  }
  const last = chords[3];
  const end = pick(rng, ENDINGS);
  const r = last.tones[0];
  let target = r;
  for (let k = -1; k <= 1; k++) if (Math.abs(r + 7 * k - cur) < Math.abs(target - cur)) target = r + 7 * k;
  target = clamp(target, -2, 9);
  for (let i = 0; i < end.length; i++) {
    const fin = i === end.length - 1;
    if (fin) cur = target;
    else {
      const dir = Math.sign(target - cur) || (rng() < 0.5 ? 1 : -1);
      cur = clamp(cur + dir * (rng() < 0.7 ? 1 : 2), -2, 9);
    }
    out[48 + end[i]] = { idx: cur, vel: fin ? 0.95 : 0.8, long: fin };
  }
  return out;
}

function makeBass(rng: () => number, chords: readonly Chord[], nextChord: Chord): (BassNote | undefined)[] {
  const out: (BassNote | undefined)[] = new Array(64);
  const main = pick(rng, BASS_PATTERNS);
  const turn = pick(rng, BASS_PATTERNS);
  for (let bar = 0; bar < 4; bar++) {
    const ch = chords[bar];
    const nx = bar < 3 ? chords[bar + 1] : nextChord;
    const root = bassRoot(ch);
    const nroot = bassRoot(nx);
    for (const [step, role, len, vel] of bar === 3 ? turn : main) {
      let midi = root;
      if (role === 1) midi = root + 7;
      else if (role === 2) midi = root + 12;
      else if (role === 3) midi = root + ch.third;
      else if (role === 4) midi = nroot === root ? root - 5 : nroot - 1;
      out[bar * 16 + step] = { midi, len, vel };
    }
  }
  return out;
}

export class MusicPlayer {
  private readonly fader: GainNode;
  private readonly melBus: GainNode;
  private readonly fixed: AudioNode[] = [];
  private readonly voices = new Set<Voice>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopAt = Infinity;
  private step = 0;
  private nextTime = 0;
  private intensity = 0;
  private target = 0;
  private plan: PhrasePlan | null = null;
  private disposed = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly noise: AudioBuffer,
    private readonly seed = THEME_SEED,
  ) {
    this.fader = ctx.createGain();
    this.fader.gain.value = 0;
    this.fader.connect(dest);
    this.melBus = ctx.createGain();
    this.melBus.connect(this.fader);
    // eco pontuado na melodia (colcheia pontuada)
    const delay = ctx.createDelay(1);
    delay.delayTime.value = (60 / 108) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.melBus.connect(delay);
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);
    damp.connect(wet);
    wet.connect(this.fader);
    this.fixed.push(this.fader, this.melBus, delay, fb, damp, wet);
  }

  get playing(): boolean {
    return this.running;
  }
  get voiceCount(): number {
    return this.voices.size;
  }

  /** Inicia (ou cancela um fade-out em andamento). `auto=false` não liga o timer (render offline). */
  start(auto = true): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    const g = this.fader.gain;
    g.cancelScheduledValues(now);
    if (!this.running) {
      g.setValueAtTime(0, now);
      this.step = 0;
      this.plan = null;
      this.nextTime = now + 0.06;
      this.running = true;
    } else {
      g.setValueAtTime(g.value, now);
    }
    g.linearRampToValueAtTime(1, now + 0.3);
    this.stopAt = Infinity;
    if (auto) this.ensureTimer();
  }

  stop(fade = 1.5): void {
    if (!this.running || this.disposed) return;
    const now = this.ctx.currentTime;
    const f = Math.max(0.02, Number.isFinite(fade) ? fade : 1.5);
    const g = this.fader.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + f);
    this.stopAt = Math.min(this.stopAt, now + f);
  }

  setIntensity(x: number): void {
    this.target = clamp(Number.isFinite(x) ? x : 0, 0, 1);
  }

  /** Agenda todos os passos até `horizon` (segundos do contexto). */
  scheduleUntil(horizon: number): void {
    if (!this.running || this.disposed) return;
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.05) this.nextTime = now + 0.02; // ficou para trás: pula, sem rajada
    while (this.nextTime < horizon && this.nextTime < this.stopAt) {
      this.intensity += (this.target - this.intensity) * 0.06;
      const sd = 60 / (BPM_BASE + BPM_BOOST * this.intensity) / 4;
      const swing = this.step % 2 === 1 ? sd * SWING : 0;
      this.scheduleStep(this.step, this.nextTime + swing, sd);
      this.nextTime += sd;
      this.step++;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const v of [...this.voices]) v.kill();
    this.voices.clear();
    for (const n of this.fixed) {
      try {
        n.disconnect();
      } catch {
        /* ignorado */
      }
    }
  }

  // ---------- agendador ----------

  private ensureTimer(): void {
    if (this.timer === null && !this.disposed) this.timer = setTimeout(this.tick, TICK_MS);
  }

  private readonly tick = (): void => {
    this.timer = null;
    if (this.disposed || !this.running) return;
    const ctx = this.ctx;
    if (ctx.state === 'closed') {
      this.running = false;
      return;
    }
    if (ctx.state === 'running') {
      this.scheduleUntil(ctx.currentTime + LOOKAHEAD);
      if (ctx.currentTime >= this.stopAt) {
        this.running = false; // fade concluído
        return;
      }
    }
    this.ensureTimer();
  };

  private planFor(phrase: number): PhrasePlan {
    if (this.plan && this.plan.phrase === phrase) return this.plan;
    const form = phrase % 4;
    const cycle = Math.floor(phrase / 4);
    const chords = FORMS[form];
    // Frase A é sempre o tema (reconhecível); as demais variam por ciclo e repetem a cada 4 ciclos.
    const variant = form === 0 ? 0 : (cycle % 4) + 1;
    const seed = (this.seed ^ Math.imul(form + 1, 0x9e3779b1) ^ Math.imul(variant, 0x85ebca6b)) >>> 0;
    const rng = mulberry32(seed);
    const mel = makeMelody(rng, chords);
    const bass = makeBass(rng, chords, FORMS[(form + 1) % 4][0]);
    this.plan = { phrase, chords, mel, bass };
    return this.plan;
  }

  private scheduleStep(n: number, t: number, sd: number): void {
    const s = n % 16;
    const bar = Math.floor(n / 16);
    const bip = bar % 4;
    const phrase = Math.floor(bar / 4);
    const P = this.planFor(phrase);
    const ch = P.chords[bip];
    const I = this.intensity;
    const k = bip * 16 + s;

    if (s === 0) this.pad(t, ch, sd * 16);

    // zabumba
    const kv = KICK[s] || (I > 0.5 ? KICK_HOT[s] : 0);
    if (kv) this.kick(t, kv * (0.85 + 0.15 * I));
    // virada de alfaia no fim da frase (maracatu) com intensidade alta
    if (bip === 3 && s >= 12 && I > 0.55) this.tom(t, TOM_FILL[s - 12], 0.5 + 0.4 * I);
    // aro / "bacalhau"
    const rv = RIM[s] || (I > 0.25 ? RIM_GHOST[s] : 0);
    if (rv) this.rim(t, rv * (0.8 + 0.3 * I));
    // ganzá: acentos nos contratempos
    if (s % 2 === 0 || I > 0.3) {
      const acc = s % 4 === 2 ? 1 : s % 2 === 0 ? 0.6 : 0.42;
      this.shaker(t, acc * (0.55 + 0.6 * I));
    }
    // triângulo (aberto no contratempo) quando esquenta
    if (I > 0.35) {
      if (s % 4 === 2) this.triangulo(t, true, 0.6 + 0.4 * I);
      else if (s % 4 !== 3 || I > 0.7) this.triangulo(t, false, 0.5);
    }
    const b = P.bass[k];
    if (b) this.bass(t, mtof(b.midi), b.len * sd, b.vel);
    // introdução: dois compassos só com ritmo e baixo
    const m = P.mel[k];
    if (m && !(phrase === 0 && bip < 2)) this.pluck(t, mtof(idxToMidi(m.idx)), m.vel, m.long);
  }

  // ---------- instrumentos ----------

  private voice(level: number, dest: AudioNode = this.fader): Voice {
    const v = new Voice(this.ctx, this.noise, dest, 'music', 0, level);
    this.voices.add(v);
    v.onDone = (x) => this.voices.delete(x);
    return v;
  }

  // zabumba: seno com queda de afinação + clique
  private kick(t: number, vel: number): void {
    const v = this.voice(0.6 * vel);
    const g = v.gain(v.out);
    perc(g.gain, t, 1, 0.003, 0.3);
    const o = v.osc(g, 'sine', 150, t, t + 0.34);
    glide(o.frequency, t, 150, 47, 0.11);
    const cg = v.gain(v.out);
    perc(cg.gain, t, 0.25, 0.001, 0.012);
    v.noise(v.filter(cg, 'lowpass', 1500, 0.7), t, 0.02);
  }

  // alfaia: tom grave com ataque de pele
  private tom(t: number, f: number, vel: number): void {
    const v = this.voice(0.42 * vel);
    const g = v.gain(v.out);
    perc(g.gain, t, 1, 0.002, 0.22);
    const o = v.osc(g, 'sine', f, t, t + 0.25);
    glide(o.frequency, t, f * 1.5, f, 0.05);
    const ng = v.gain(v.out);
    perc(ng.gain, t, 0.3, 0.001, 0.03);
    v.noise(v.filter(ng, 'lowpass', 900, 0.7), t, 0.04);
  }

  // aro: ruído em banda + tom curto
  private rim(t: number, vel: number): void {
    const v = this.voice(0.22 * vel);
    const g = v.gain(v.out);
    perc(g.gain, t, 0.9, 0.001, 0.055);
    v.noise(v.filter(g, 'bandpass', 2100, 1.4), t, 0.07);
    const tg = v.gain(v.out);
    perc(tg.gain, t, 0.5, 0.001, 0.035);
    const o = v.osc(tg, 'triangle', 420, t, t + 0.045);
    glide(o.frequency, t, 420, 330, 0.03);
  }

  // ganzá: ruído agudo com ataque macio
  private shaker(t: number, vel: number): void {
    const v = this.voice(0.09 * vel);
    const g = v.gain(v.out);
    swell(g.gain, t, 1, 0.006, 0, 0.045);
    v.noise(v.filter(g, 'highpass', 6500, 0.7), t, 0.06);
  }

  // triângulo: parciais metálicos, aberto (soa) ou abafado
  private triangulo(t: number, open: boolean, vel: number): void {
    const v = this.voice(0.035 * vel);
    const d = open ? 0.38 : 0.035;
    [3150, 4370, 5810].forEach((f, i) => {
      const g = v.gain(v.out);
      perc(g.gain, t, 1 / (i + 1.5), 0.001, d / (1 + i * 0.4));
      v.osc(g, 'sine', f, t, t + d + 0.02);
    });
  }

  private bass(t: number, f: number, len: number, vel: number): void {
    const v = this.voice(0.34 * vel);
    const g = v.gain(v.out);
    const end = swell(g.gain, t, 0.9, 0.006, Math.max(0.02, len * 0.55), 0.09);
    const lp = v.filter(g, 'lowpass', 650, 1.2);
    v.osc(lp, 'sine', f, t, end + 0.01);
    v.osc(v.gain(lp, 0.5), 'triangle', f, t, end + 0.01);
  }

  // dedilhado: triângulo + um pouco de serra com filtro fechando (vai para o eco)
  private pluck(t: number, f: number, vel: number, long: boolean): void {
    const v = this.voice(0.2 * vel, this.melBus);
    const g = v.gain(v.out);
    const end = perc(g.gain, t, 1, 0.003, long ? 0.9 : 0.34);
    const lp = v.filter(g, 'lowpass', 3400, 1);
    glide(lp.frequency, t, 3400, 700, 0.15);
    v.osc(lp, 'triangle', f, t, end + 0.01);
    v.osc(v.gain(lp, 0.18), 'sawtooth', f * 1.002, t, end + 0.01);
  }

  // cama harmônica discreta, um acorde por compasso
  private pad(t: number, ch: Chord, dur: number): void {
    const v = this.voice(0.045);
    const g = v.gain(v.out);
    const end = swell(g.gain, t, 1, 0.35, Math.max(0.1, dur - 0.35), 0.45);
    const lp = v.filter(g, 'lowpass', 1100, 0.7);
    for (const tone of ch.tones) v.osc(lp, 'triangle', mtof(PAD_ROOT + SCALE[tone]), t, end + 0.01);
  }
}
