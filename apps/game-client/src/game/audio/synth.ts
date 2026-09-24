// Blocos básicos de áudio: a "voz" descartável (que toca as amostras gravadas dos
// efeitos e as notas da música), espacialização, envelopes, PRNG e ruído. A síntese
// aqui só é usada pela música generativa; os efeitos vêm de arquivos (samples.ts).
// Nada aqui toca em window/AudioContext no import: tudo recebe o contexto por parâmetro.

export type Vec3 = [number, number, number];

/** Piso usado em rampas exponenciais (não aceitam zero). */
export const SILENT = 0.0001;

// Parâmetros de espacialização (metros).
export const SPATIAL = { refDistance: 3, maxDistance: 60, rolloff: 1.2 } as const;

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Número finito ou valor padrão. */
export const finite = (x: number | undefined, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? x : fallback;

export const mtof = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export function validVec3(v: Vec3 | undefined | null): Vec3 | null {
  if (!v || v.length < 3) return null;
  const [x, y, z] = v;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : null;
}

/** PRNG determinístico (mulberry32) para a música generativa. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Um único buffer de ruído branco (1 s) reutilizado por todos os sons. */
export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 1): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rnd = mulberry32(0x5eed1e);
  for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  return buf;
}

// ---------- envelopes ----------

/** Percussivo: ataque linear + queda exponencial. Retorna o instante final. */
export function perc(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  const a = Math.max(0.0005, attack);
  const d = Math.max(0.004, decay);
  p.setValueAtTime(SILENT, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(SILENT, t + a + d);
  return t + a + d;
}

/** Ataque, sustentação e soltura (para sons com corpo). */
export function swell(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): number {
  const a = Math.max(0.001, attack);
  const h = Math.max(0, hold);
  const r = Math.max(0.005, release);
  p.setValueAtTime(SILENT, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + h);
  p.exponentialRampToValueAtTime(SILENT, t + a + h + r);
  return t + a + h + r;
}

/** Glissando exponencial (frequências). */
export function glide(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(from, SILENT), t);
  p.exponentialRampToValueAtTime(Math.max(to, SILENT), t + Math.max(0.001, dur));
}

/** Define um parâmetro de forma instantânea (tc<=0) ou suave. */
export function setParam(p: AudioParam, value: number, t: number, tc: number): void {
  if (tc <= 0) p.setValueAtTime(value, t);
  else p.setTargetAtTime(value, t, tc);
}

// ---------- espacialização ----------
// Babylon é mão-esquerda (+Z à frente); Web Audio é mão-direita (-Z à frente): espelhamos Z.

export function createPanner(ctx: BaseAudioContext, pos: Vec3): PannerNode {
  const p = ctx.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = SPATIAL.refDistance;
  p.maxDistance = SPATIAL.maxDistance;
  p.rolloffFactor = SPATIAL.rolloff;
  setPannerPosition(p, pos, ctx.currentTime, 0);
  return p;
}

export function setPannerPosition(p: PannerNode, pos: Vec3, t: number, tc: number): void {
  const [x, y, z] = pos;
  if (p.positionX) {
    setParam(p.positionX, x, t, tc);
    setParam(p.positionY, y, t, tc);
    setParam(p.positionZ, -z, t, tc);
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, -z);
  }
}

/** Ganho estimado pelo modelo "inverse" (para priorizar vozes próximas). */
export function distanceGain(d: number): number {
  const { refDistance: ref, maxDistance: max, rolloff } = SPATIAL;
  const dd = clamp(d, ref, max);
  return ref / (ref + rolloff * (dd - ref));
}

// ---------- voz ----------

const isNode = (d: AudioNode | AudioParam): d is AudioNode => typeof (d as AudioNode).connect === 'function';

/**
 * Grupo de nós de um som. Tudo que é criado pela voz é registrado e desconectado
 * quando a última fonte termina (onended) — a memória não cresce.
 */
export class Voice {
  readonly out: GainNode;
  readonly born: number;
  /** Instante previsto em que a última fonte para (Infinity para loops). */
  endAt: number;
  /** Peso de audibilidade estimado (volume × distância), usado no roubo de vozes. */
  weight = 1;
  /** Som do próprio jogador (sem posição): tem limite de vozes separado dos sons do mundo. */
  local = false;
  onDone: ((v: Voice) => void) | null = null;

  private readonly nodes: AudioNode[] = [];
  private readonly srcs: AudioScheduledSourceNode[] = [];
  private live = 0;
  private _done = false;
  private _releasing = false;

  constructor(
    readonly ctx: BaseAudioContext,
    private readonly noiseBuf: AudioBuffer,
    dest: AudioNode,
    readonly id: string,
    readonly priority: number,
    level: number,
  ) {
    this.born = ctx.currentTime;
    this.endAt = this.born;
    this.out = ctx.createGain();
    this.out.gain.value = level;
    this.out.connect(dest);
    this.nodes.push(this.out);
  }

  get done(): boolean {
    return this._done;
  }
  get releasing(): boolean {
    return this._releasing;
  }
  get sourceCount(): number {
    return this.srcs.length;
  }

  /** Registra um nó externo (ex.: panner) para ser liberado junto. */
  adopt<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  /** Ganho ligado a um nó ou a um AudioParam (profundidade de modulação). */
  gain(dest: AudioNode | AudioParam, value = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (isNode(dest)) g.connect(dest);
    else g.connect(dest);
    return this.adopt(g);
  }

  filter(dest: AudioNode, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return this.adopt(f);
  }

  /** Oscilador; sem t1 fica tocando até release() (loops). */
  osc(dest: AudioNode, type: OscillatorType, freq: number, t0: number, t1?: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(dest);
    o.start(t0);
    this.register(o, t1);
    return o;
  }

  /** Ruído do buffer compartilhado, com ponto de partida aleatório. */
  noise(dest: AudioNode, t0: number, dur?: number, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(t0, Math.random() * this.noiseBuf.duration);
    this.register(s, dur === undefined ? undefined : t0 + dur);
    return s;
  }

  /** Fonte de um buffer qualquer (sinais de controle dos loops). */
  buffer(dest: AudioNode, buf: AudioBuffer, t0: number, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(t0, Math.random() * buf.duration);
    this.register(s);
    return s;
  }

  /** Reprodução de uma amostra gravada (efeito ou loop), a partir de `offset` segundos. */
  sample(dest: AudioNode, buf: AudioBuffer, t0: number, rate = 1, loop = false, offset = 0): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(t0, Math.max(0, Math.min(offset, buf.duration - 0.001)));
    this.register(s, loop ? undefined : t0 + (buf.duration - offset) / rate + 0.02);
    return s;
  }

  /** LFO somado a um ou mais AudioParams. */
  lfo(
    target: AudioParam | AudioParam[],
    type: OscillatorType,
    rate: number,
    depth: number,
    t0: number,
    t1?: number,
  ): { osc: OscillatorNode; depth: GainNode } {
    const d = this.ctx.createGain();
    d.gain.value = depth;
    for (const p of Array.isArray(target) ? target : [target]) d.connect(p);
    this.adopt(d);
    const o = this.osc(d, type, rate, t0, t1);
    return { osc: o, depth: d };
  }

  /** Fade curto e parada de todas as fontes (roubo de voz / fim de loop). */
  release(fade = 0.02): void {
    if (this._done || this._releasing) return;
    this._releasing = true;
    const now = this.ctx.currentTime;
    const end = now + Math.max(0.005, fade);
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, end);
    for (const s of this.srcs) {
      try {
        s.stop(end + 0.01);
      } catch {
        /* fonte já parada */
      }
    }
    this.endAt = end + 0.01;
  }

  /** Corte imediato (dispose / rede de segurança). */
  kill(): void {
    if (this._done) return;
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        /* ignorado */
      }
    }
    this.finish();
  }

  private register(s: AudioScheduledSourceNode, t1?: number): void {
    this.nodes.push(s);
    this.srcs.push(s);
    this.live++;
    s.onended = () => {
      this.live--;
      if (this.live <= 0) this.finish();
    };
    if (t1 !== undefined) {
      s.stop(t1);
      if (this.endAt !== Infinity) this.endAt = Math.max(this.endAt, t1);
    } else {
      this.endAt = Infinity;
    }
  }

  private finish(): void {
    if (this._done) return;
    this._done = true;
    for (const s of this.srcs) s.onended = null;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* já desconectado */
      }
    }
    this.nodes.length = 0;
    this.srcs.length = 0;
    const cb = this.onDone;
    this.onDone = null;
    cb?.(this);
  }
}
