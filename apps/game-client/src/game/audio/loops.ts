// Loops contínuos com chave: reutilizam os mesmos nós enquanto ativos e só
// ajustam parâmetros (param 0..1, volume, posição) de forma suave.

import { Voice, clamp, createPanner, mulberry32, setPannerPosition, setParam, type Vec3 } from './synth';

export type LoopId = 'swim' | 'charge' | 'enemy_ink' | 'wheel_hum';

export const LOOP_IDS: readonly LoopId[] = ['swim', 'charge', 'enemy_ink', 'wheel_hum'];

/** Máximo simultâneo por tipo e total. */
export const LOOP_CAPS: Record<LoopId, number> = { swim: 2, charge: 2, enemy_ink: 6, wheel_hum: 4 };
export const MAX_LOOPS = 12;

// Constante de tempo das atualizações (s).
const SMOOTH = 0.06;

interface LoopPatch {
  /** Ajusta o timbre conforme param (0..1). tc<=0 aplica na hora. */
  apply(param: number, t: number, tc: number): void;
  /** Nível de saída para o param atual. */
  level(param: number): number;
}

type LoopBuilder = (v: Voice, t: number, cb: ControlBuffers) => LoopPatch;

// ---------- sinais de controle pré-calculados (um por contexto) ----------

interface ControlBuffers {
  /** canal 0: forma do glissando da bolha (0..1); canal 1: envelope da bolha (0..1). */
  bubbles: AudioBuffer;
  /** estalos esparsos (0..1) para o chiado. */
  crackle: AudioBuffer;
}

const CTL_RATE = 22050;
const ctlCache = new WeakMap<BaseAudioContext, ControlBuffers>();

function controlBuffers(ctx: BaseAudioContext): ControlBuffers {
  const hit = ctlCache.get(ctx);
  if (hit) return hit;
  const rnd = mulberry32(0xb0b1e5);

  // bolhas: passos de duração aleatória, cada um com um "blup" subindo
  const bl = CTL_RATE * 2;
  const bubbles = ctx.createBuffer(2, bl, CTL_RATE);
  const fr = bubbles.getChannelData(0);
  const gt = bubbles.getChannelData(1);
  let i = 0;
  while (i < bl) {
    const stepLen = Math.floor(CTL_RATE * (0.045 + rnd() * 0.09));
    if (i + stepLen > bl) break; // resto fica em silêncio: emenda do loop sem clique
    const base = rnd() * 0.6;
    const amp = rnd() < 0.22 ? 0 : 0.35 + rnd() * 0.65;
    const stepDur = stepLen / CTL_RATE;
    const tau = stepDur / 4.5;
    for (let k = 0; k < stepLen; k++, i++) {
      const ts = k / CTL_RATE;
      fr[i] = base + Math.min(1, ts / (stepDur * 0.6)) * 0.4;
      gt[i] = amp * (1 - Math.exp(-ts / 0.002)) * Math.exp(-ts / tau);
    }
  }

  // chiado: impulsos com decaimento curto (~35/s)
  const cl = Math.floor(CTL_RATE * 1.5);
  const crackle = ctx.createBuffer(1, cl, CTL_RATE);
  const c = crackle.getChannelData(0);
  const fadeLen = Math.floor(CTL_RATE * 0.02);
  let pos = 0;
  while (true) {
    pos += Math.floor(CTL_RATE * (-Math.log(1 - rnd() * 0.999) / 35));
    if (pos >= cl - fadeLen) break;
    const a = 0.2 + rnd() * rnd() * 0.8;
    const tau = CTL_RATE * (0.002 + rnd() * 0.004);
    for (let k = 0; k < tau * 5 && pos + k < cl; k++) c[pos + k] = Math.min(1, c[pos + k] + a * Math.exp(-k / tau));
  }
  for (let k = 0; k < fadeLen; k++) c[cl - 1 - k] *= k / fadeLen;

  const out = { bubbles, crackle };
  ctlCache.set(ctx, out);
  return out;
}

// ---------- receitas dos loops ----------

const BUILDERS: Record<LoopId, LoopBuilder> = {
  // nado na tinta: lavagem de ruído + bolhas tonais; param = velocidade
  swim: (v, t, cb) => {
    const washG = v.gain(v.out, 0);
    const washLp = v.filter(washG, 'lowpass', 400, 0.8);
    v.noise(washLp, t);
    const bubG = v.gain(v.out, 0);
    const bubO = v.osc(bubG, 'sine', 300, t);
    const split = v.adopt(v.ctx.createChannelSplitter(2));
    const ctl = v.buffer(split, cb.bubbles, t);
    const freqDepth = v.gain(bubO.frequency, 520);
    const gateDepth = v.gain(bubG.gain, 0.1);
    split.connect(freqDepth, 0);
    split.connect(gateDepth, 1);
    return {
      apply(p, tt, tc) {
        setParam(washG.gain, 0.05 + 0.22 * p, tt, tc);
        setParam(washLp.frequency, 320 + 1500 * p, tt, tc);
        setParam(ctl.playbackRate, 0.55 + 0.95 * p, tt, tc);
        setParam(gateDepth.gain, 0.1 + 0.3 * p, tt, tc);
        setParam(bubO.frequency, 280 + 180 * p, tt, tc);
      },
      level: (p) => 0.45 + 0.35 * p,
    };
  },

  // carga: tom subindo com o nível, vibrato acelerando e filtro abrindo
  charge: (v, t) => {
    const lp = v.filter(v.out, 'lowpass', 900, 2);
    const mix = v.gain(lp, 0.4);
    const o1 = v.osc(mix, 'triangle', 180, t);
    const sawG = v.gain(mix, 0.35);
    const o2 = v.osc(sawG, 'sawtooth', 270, t);
    const vib = v.lfo([o1.frequency, o2.frequency], 'sine', 5, 3, t);
    return {
      apply(p, tt, tc) {
        const f = 180 * Math.pow(2, p * 1.6);
        setParam(o1.frequency, f, tt, tc);
        setParam(o2.frequency, f * 1.5, tt, tc);
        setParam(lp.frequency, 700 + 3000 * p, tt, tc);
        setParam(vib.osc.frequency, 5 + 9 * p, tt, tc);
        setParam(vib.depth.gain, f * 0.015, tt, tc);
      },
      level: (p) => 0.16 + 0.12 * p,
    };
  },

  // tinta inimiga: chiado sutil com estalos
  enemy_ink: (v, t, cb) => {
    const g = v.gain(v.out, 0.04);
    const bp = v.filter(g, 'bandpass', 5200, 0.8);
    const hp = v.filter(bp, 'highpass', 2600, 0.7);
    v.noise(hp, t);
    const crack = v.buffer(v.gain(g.gain, 0.5), cb.crackle, t);
    return {
      apply(p, tt, tc) {
        setParam(crack.playbackRate, 0.6 + 0.8 * p, tt, tc);
        setParam(bp.frequency, 4200 + 2000 * p, tt, tc);
      },
      level: (p) => 0.35 + 0.4 * p,
    };
  },

  // zumbido do torno: graves com trêmolo/filtro "girando"; param = rotação
  wheel_hum: (v, t) => {
    const am = v.gain(v.out, 0.7);
    const lp = v.filter(am, 'lowpass', 320, 3);
    const mix = v.gain(lp, 0.3);
    const o1 = v.osc(mix, 'sawtooth', 55, t);
    const o2 = v.osc(mix, 'sine', 110.6, t);
    const o3 = v.osc(mix, 'triangle', 82.5, t);
    const rot = v.lfo(am.gain, 'sine', 2.2, 0.3, t);
    const sweep = v.gain(lp.frequency, 140);
    rot.osc.connect(sweep);
    return {
      apply(p, tt, tc) {
        setParam(rot.osc.frequency, 1.5 + 4 * p, tt, tc);
        setParam(o1.frequency, 50 + 12 * p, tt, tc);
        setParam(o2.frequency, (50 + 12 * p) * 2.01, tt, tc);
        setParam(o3.frequency, (50 + 12 * p) * 1.5, tt, tc);
        setParam(lp.frequency, 260 + 320 * p, tt, tc);
      },
      level: (p) => 0.25 + 0.15 * p,
    };
  },
};

/** Instância viva de um loop (nós reutilizados até o release). */
export class LoopInstance {
  private lastParam = -1;
  private lastVolume = -1;
  private lastPos: Vec3 | null = null;

  private constructor(
    readonly id: LoopId,
    readonly voice: Voice,
    private readonly panner: PannerNode | null,
    private readonly patch: LoopPatch,
  ) {}

  get spatial(): boolean {
    return this.panner !== null;
  }

  static create(
    ctx: BaseAudioContext,
    noise: AudioBuffer,
    bus: AudioNode,
    id: LoopId,
    pos: Vec3 | null,
    param: number,
    volume: number,
  ): LoopInstance {
    let dest: AudioNode = bus;
    let panner: PannerNode | null = null;
    if (pos) {
      panner = createPanner(ctx, pos);
      panner.connect(bus);
      dest = panner;
    }
    const v = new Voice(ctx, noise, dest, `loop:${id}`, 0, 0);
    if (panner) v.adopt(panner);
    const t = ctx.currentTime + 0.01;
    const patch = BUILDERS[id](v, t, controlBuffers(ctx));
    const inst = new LoopInstance(id, v, panner, patch);
    const p = clamp(param, 0, 1);
    patch.apply(p, t, 0);
    inst.voice.out.gain.setTargetAtTime(patch.level(p) * volume, t, SMOOTH);
    inst.lastParam = p;
    inst.lastVolume = volume;
    inst.lastPos = pos;
    return inst;
  }

  update(param: number, volume: number, pos: Vec3 | null): void {
    const t = this.voice.ctx.currentTime;
    const p = clamp(param, 0, 1);
    // chamado todo frame: só mexe no grafo quando algo mudou de fato
    if (Math.abs(p - this.lastParam) > 0.004 || Math.abs(volume - this.lastVolume) > 0.004) {
      this.lastParam = p;
      this.lastVolume = volume;
      this.patch.apply(p, t, SMOOTH);
      this.voice.out.gain.setTargetAtTime(this.patch.level(p) * volume, t, SMOOTH);
    }
    if (pos && this.panner) {
      const q = this.lastPos;
      if (!q || Math.abs(q[0] - pos[0]) + Math.abs(q[1] - pos[1]) + Math.abs(q[2] - pos[2]) > 0.02) {
        this.lastPos = pos;
        // valor direto (sem rampa) mantém o PannerNode no caminho barato (k-rate) do navegador
        setPannerPosition(this.panner, pos, t, 0);
      }
    }
  }
}
