// Motor de áudio procedural do Borrifo: barramentos, limite de vozes, loops
// com chave, espacialização e música generativa. Todo som é sintetizado.
// Nada é criado no import; o AudioContext só nasce em unlock().

import { LOOP_CAPS, LoopInstance, MAX_LOOPS, type LoopId } from './loops';
import { MusicPlayer } from './music';
import { SFX_META, SFX_RECIPES, type SfxId, type SfxMeta } from './sfx';
import {
  SPATIAL,
  Voice,
  clamp,
  createNoiseBuffer,
  createPanner,
  distanceGain,
  finite,
  validVec3,
  type Vec3,
} from './synth';

export type { Vec3 } from './synth';

export interface AudioVolumes {
  master: number;
  sfx: number;
  music: number;
}

export type AudioEngineState = 'locked' | 'running' | 'suspended' | 'closed' | 'unsupported';

export interface PlayOptions {
  pos?: Vec3;
  volume?: number;
  pitch?: number;
  team?: 0 | 1;
}

export interface LoopOptions {
  pos?: Vec3;
  volume?: number;
  param?: number;
}

/** Teto global de vozes vivas (soando + em fade de roubo). */
export const MAX_VOICES = 24;
/** Vozes roubadas ainda em fade; reservadas dentro do teto global. */
const MAX_RELEASING = 4;
const SOUNDING_CAP = MAX_VOICES - MAX_RELEASING;
/** Voz mais nova que isso não é roubada (evita churn numa rajada no mesmo frame). */
const MIN_STEAL_AGE = 0.03;
const STEAL_FADE = 0.02;
const LOOP_FADE = 0.15;
const START_OFFSET = 0.005;
// Música fica abaixo dos efeitos por padrão.
const MUSIC_TRIM = 0.8;

type Ctor = new (opts?: AudioContextOptions) => AudioContext;

function audioCtor(): Ctor | null {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

// Lê o estado sem o estreitamento de tipo do TS (o estado muda entre awaits).
const isRunning = (c: BaseAudioContext): boolean => (c.state as string) === 'running';

/** Curva perceptual simples para volumes 0..1. */
const curve = (x: number): number => x * x;

function withTimeout(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const id = setTimeout(() => resolve(false), ms);
    p.then(
      () => {
        clearTimeout(id);
        resolve(true);
      },
      () => {
        clearTimeout(id);
        resolve(false);
      },
    );
  });
}

function normalize(v: Vec3): Vec3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : null;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private _state: AudioEngineState;
  private _unlocked = false;
  private _muted = false;
  private disposed = false;
  private _lastError: string | null = null;
  private unlocking: Promise<boolean> | null = null;

  private vol: AudioVolumes = { master: 0.9, sfx: 1, music: 0.7 };
  private lis: { pos: Vec3; fwd: Vec3; up: Vec3 } = { pos: [0, 0, 0], fwd: [0, 0, 1], up: [0, 1, 0] };

  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;

  private readonly voices: Voice[] = []; // soando, em ordem de criação
  private readonly releasing = new Set<Voice>(); // roubadas, em fade
  private readonly loops = new Map<string, LoopInstance>();
  private readonly fadingLoops = new Set<LoopInstance>();

  private music: MusicPlayer | null = null;
  private musicWanted = false;
  private musicIntensity = 0;

  constructor() {
    this._state = audioCtor() ? 'locked' : 'unsupported';
  }

  // ---------- estado ----------

  get state(): AudioEngineState {
    return this._state;
  }
  get unlocked(): boolean {
    return this._unlocked && !this.disposed;
  }
  get muted(): boolean {
    return this._muted;
  }
  /** Diagnóstico: vozes de efeito vivas (inclui as em fade de roubo; não inclui loops e música). */
  get activeVoices(): number {
    if (this.ctx) this.sweep(this.ctx.currentTime);
    return this.voices.length + this.releasing.size;
  }
  /** Diagnóstico: loops vivos (ativos + em fade-out). */
  get activeLoops(): number {
    return this.loops.size + this.fadingLoops.size;
  }
  /** Diagnóstico: última falha de áudio (ex.: autoplay bloqueado). */
  get lastError(): string | null {
    return this._lastError;
  }

  // ---------- ciclo de vida ----------

  /** Chamar a partir de um gesto do usuário. Nunca lança; retorna se o contexto está tocando. */
  unlock(): Promise<boolean> {
    if (this.disposed || this._state === 'unsupported') return Promise.resolve(false);
    if (this.ctx && this.ctx.state === 'running') {
      this.markRunning();
      return Promise.resolve(true);
    }
    if (!this.unlocking) {
      this.unlocking = this.doUnlock().finally(() => {
        this.unlocking = null;
      });
    }
    return this.unlocking;
  }

  async suspend(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.disposed || ctx.state !== 'running') return;
    try {
      await ctx.suspend();
    } catch (e) {
      this.fail('suspend', e);
    }
    this.syncState();
  }

  async resume(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.disposed || ctx.state === 'running' || ctx.state === 'closed') return;
    const ok = await withTimeout(ctx.resume(), 800);
    if (!ok) this.fail('resume', 'o navegador não retomou o AudioContext');
    this.syncState();
    if (isRunning(ctx)) this.markRunning();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.musicWanted = false;
    this.music?.dispose();
    this.music = null;
    for (const l of [...this.loops.values(), ...this.fadingLoops]) l.voice.kill();
    this.loops.clear();
    this.fadingLoops.clear();
    for (const v of [...this.voices, ...this.releasing]) v.kill();
    this.voices.length = 0;
    this.releasing.clear();
    for (const n of [this.sfxBus, this.musicBus, this.master, this.comp]) {
      try {
        n?.disconnect();
      } catch {
        /* ignorado */
      }
    }
    this.sfxBus = this.musicBus = this.master = null;
    this.comp = null;
    this.noise = null;
    const ctx = this.ctx;
    this.ctx = null;
    this._unlocked = false;
    if (this._state !== 'unsupported') this._state = 'closed';
    if (ctx) {
      ctx.onstatechange = null;
      try {
        if (ctx.state !== 'closed') await ctx.close();
      } catch (e) {
        this.fail('close', e);
      }
    }
  }

  // ---------- mixagem ----------

  setVolumes(v: Partial<AudioVolumes>): void {
    if (this.disposed) return;
    for (const k of ['master', 'sfx', 'music'] as const) {
      const x = v[k];
      if (typeof x === 'number' && Number.isFinite(x)) this.vol[k] = clamp(x, 0, 1);
    }
    this.applyVolumes(false);
  }

  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this._muted = !!muted;
    this.applyVolumes(false);
  }

  setListener(pos: Vec3, forward: Vec3, up: Vec3 = [0, 1, 0]): void {
    if (this.disposed) return;
    const p = validVec3(pos);
    const f = validVec3(forward);
    const u = validVec3(up);
    if (p) this.lis.pos = p;
    const fn = f && normalize(f);
    if (fn) this.lis.fwd = fn;
    const un = u && normalize(u);
    if (un) this.lis.up = un;
    this.applyListener();
  }

  // ---------- efeitos ----------

  play(id: SfxId, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (this.disposed || !ctx || ctx.state !== 'running' || !this.sfxBus || !this.noise) return;
    const meta: SfxMeta | undefined = SFX_META[id];
    const recipe = SFX_RECIPES[id];
    if (!meta || !recipe) return;
    const volume = clamp(finite(opts.volume, 1), 0, 2);
    if (volume < 0.001) return;
    const pos = validVec3(opts.pos);
    let weight = volume * meta.level;
    if (pos) {
      const d = Math.hypot(pos[0] - this.lis.pos[0], pos[1] - this.lis.pos[1], pos[2] - this.lis.pos[2]);
      // além do alcance: descarta sons comuns (os importantes seguem no mínimo do modelo)
      if (d > SPATIAL.maxDistance && meta.priority < 3) return;
      weight *= distanceGain(d);
    }
    const now = ctx.currentTime;
    this.sweep(now);
    if (!this.admit(id, meta, weight, now)) return;

    let pitch = clamp(finite(opts.pitch, 1), 0.25, 4);
    if (opts.team === 0) pitch *= 0.97;
    else if (opts.team === 1) pitch *= 1.03;
    pitch *= 1 + (Math.random() * 2 - 1) * meta.detune;

    let dest: AudioNode = this.sfxBus;
    let panner: PannerNode | null = null;
    if (pos) {
      panner = createPanner(ctx, pos);
      panner.connect(this.sfxBus);
      dest = panner;
    }
    const v = new Voice(ctx, this.noise, dest, id, meta.priority, meta.level * volume);
    if (panner) v.adopt(panner);
    v.weight = weight;
    try {
      recipe(v, now + START_OFFSET, pitch);
    } catch (e) {
      this.fail(`sfx ${id}`, e);
      v.kill();
      return;
    }
    if (v.sourceCount === 0) {
      v.kill();
      return;
    }
    v.onDone = (x) => this.forget(x);
    this.voices.push(v);
  }

  // ---------- loops ----------

  setLoop(key: string, id: LoopId, on: boolean, opts: LoopOptions = {}): void {
    if (this.disposed) return;
    const cur = this.loops.get(key);
    if (!on) {
      if (cur) this.releaseLoop(key, cur, LOOP_FADE);
      return;
    }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.sfxBus || !this.noise || !(id in LOOP_CAPS)) return;
    const param = clamp(finite(opts.param, 0), 0, 1);
    const volume = clamp(finite(opts.volume, 1), 0, 2);
    const pos = validVec3(opts.pos);
    if (cur && cur.id === id && cur.spatial === (pos !== null)) {
      cur.update(param, volume, pos);
      return;
    }
    if (cur) this.releaseLoop(key, cur, 0.06);
    let same = 0;
    for (const l of this.loops.values()) if (l.id === id) same++;
    if (same >= LOOP_CAPS[id] || this.loops.size >= MAX_LOOPS) return;
    try {
      this.loops.set(key, LoopInstance.create(ctx, this.noise, this.sfxBus, id, pos, param, volume));
    } catch (e) {
      this.fail(`loop ${id}`, e);
    }
  }

  // ---------- música ----------

  startMusic(): void {
    if (this.disposed || this._state === 'unsupported') return;
    this.musicWanted = true; // lembrado até o unlock
    if (this.ctx && this.ctx.state === 'running') this.startMusicNow();
  }

  stopMusic(fadeSeconds = 1.5): void {
    if (this.disposed) return;
    this.musicWanted = false;
    this.music?.stop(clamp(finite(fadeSeconds, 1.5), 0, 30));
  }

  setMusicIntensity(x: number): void {
    if (this.disposed) return;
    this.musicIntensity = clamp(finite(x, 0), 0, 1);
    this.music?.setIntensity(this.musicIntensity);
  }

  // ---------- interno ----------

  private async doUnlock(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const C = audioCtor();
        if (!C) {
          this._state = 'unsupported';
          return false;
        }
        let ctx: AudioContext;
        try {
          ctx = new C({ latencyHint: 'interactive' });
        } catch {
          ctx = new C();
        }
        this.ctx = ctx;
        this.buildGraph(ctx);
        ctx.onstatechange = () => {
          this.syncState();
          if (ctx.state === 'running') this.markRunning();
        };
      }
      const ctx = this.ctx;
      if (ctx.state !== 'running') {
        // alguns navegadores deixam a promessa pendente sem gesto: não travar
        const ok = await withTimeout(ctx.resume(), 800);
        if (!ok && !isRunning(ctx)) this.fail('unlock', 'AudioContext não pôde iniciar (autoplay bloqueado?)');
      }
      if (this.disposed) return false;
      if (isRunning(ctx)) {
        this.primeOutput(ctx);
        this.markRunning();
      }
    } catch (e) {
      this.fail('unlock', e);
    }
    if (this.disposed) return false;
    this.syncState();
    return this.ctx?.state === 'running';
  }

  private markRunning(): void {
    if (this.disposed) return;
    if (!this._unlocked) this._lastError = null;
    this._unlocked = true;
    this.syncState();
    if (this.musicWanted && !this.music?.playing) this.startMusicNow();
  }

  private syncState(): void {
    if (this.disposed) {
      if (this._state !== 'unsupported') this._state = 'closed';
      return;
    }
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.state as string;
    if (s === 'running') this._state = 'running';
    else if (s === 'closed') this._state = 'closed';
    else this._state = this._unlocked ? 'suspended' : 'locked'; // 'suspended' ou 'interrupted' (Safari)
  }

  private buildGraph(ctx: AudioContext): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const master = ctx.createGain();
    const sfx = ctx.createGain();
    const music = ctx.createGain();
    sfx.connect(master);
    music.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    this.comp = comp;
    this.master = master;
    this.sfxBus = sfx;
    this.musicBus = music;
    this.noise = createNoiseBuffer(ctx, 1);
    this.applyVolumes(true);
    this.applyListener();
  }

  private applyVolumes(instant: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sfxBus || !this.musicBus) return;
    const t = ctx.currentTime;
    const set = (g: GainNode, v: number): void => {
      if (instant) g.gain.setValueAtTime(v, t);
      else g.gain.setTargetAtTime(v, t, 0.02);
    };
    set(this.master, this._muted ? 0 : curve(this.vol.master));
    set(this.sfxBus, curve(this.vol.sfx));
    set(this.musicBus, curve(this.vol.music) * MUSIC_TRIM);
  }

  /** Valores diretos: rampas contínuas no listener forçam todos os panners a calcular por amostra. */
  private applyListener(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    const t = ctx.currentTime;
    // Babylon (mão-esquerda, +Z à frente) → Web Audio (mão-direita): espelha Z
    const [px, py, pz] = this.lis.pos;
    const [fx, fy, fz] = this.lis.fwd;
    const [ux, uy, uz] = this.lis.up;
    if (L.positionX) {
      const set = (p: AudioParam, v: number): void => {
        p.setValueAtTime(v, t);
      };
      set(L.positionX, px);
      set(L.positionY, py);
      set(L.positionZ, -pz);
      set(L.forwardX, fx);
      set(L.forwardY, fy);
      set(L.forwardZ, -fz);
      set(L.upX, ux);
      set(L.upY, uy);
      set(L.upZ, -uz);
    } else {
      const legacy = L as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(px, py, -pz);
      legacy.setOrientation(fx, fy, -fz, ux, uy, -uz);
    }
  }

  /** Buffer silencioso de 1 amostra: destrava a saída em iOS. */
  private primeOutput(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.onended = () => src.disconnect();
      src.start();
    } catch {
      /* opcional */
    }
  }

  private startMusicNow(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.noise || this.disposed) return;
    if (!this.music) this.music = new MusicPlayer(ctx, this.musicBus, this.noise);
    this.music.setIntensity(this.musicIntensity);
    this.music.start();
  }

  /** Audibilidade atual estimada de uma voz (cai com a idade). */
  private score(v: Voice, now: number): number {
    const dur = Math.max(0.05, v.endAt - v.born);
    return v.weight * Math.max(0.05, 1 - (now - v.born) / dur);
  }

  /**
   * Admissão com limite por id e global. Quando cheio, rouba a voz menos audível
   * (e de prioridade <= à nova); se não houver candidata, descarta o som novo.
   */
  private admit(id: SfxId, meta: SfxMeta, weight: number, now: number): boolean {
    let same = 0;
    let victim: Voice | null = null;
    let vs = Infinity;
    for (const v of this.voices) {
      if (v.id !== id) continue;
      same++;
      if (now - v.born < MIN_STEAL_AGE) continue;
      const s = this.score(v, now);
      if (s < vs) {
        vs = s;
        victim = v;
      }
    }
    if (same >= meta.cap) {
      if (!victim || vs > weight || this.releasing.size >= MAX_RELEASING) return false;
      this.steal(victim);
    }
    if (this.voices.length >= SOUNDING_CAP) {
      victim = null;
      let vp = Infinity;
      vs = Infinity;
      for (const v of this.voices) {
        if (v.priority > meta.priority || now - v.born < MIN_STEAL_AGE) continue;
        const s = this.score(v, now);
        if (v.priority < vp || (v.priority === vp && s < vs)) {
          vp = v.priority;
          vs = s;
          victim = v;
        }
      }
      if (!victim || this.releasing.size >= MAX_RELEASING) return false;
      this.steal(victim);
    }
    return true;
  }

  private steal(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    this.releasing.add(v);
    v.release(STEAL_FADE);
  }

  private forget(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    this.releasing.delete(v);
  }

  private releaseLoop(key: string, l: LoopInstance, fade: number): void {
    if (this.loops.get(key) === l) this.loops.delete(key);
    this.fadingLoops.add(l);
    l.voice.onDone = () => this.fadingLoops.delete(l);
    l.voice.release(fade);
  }

  /** Rede de segurança: libera vozes cujo onended não chegou (ex.: parada antes do início). */
  private sweep(now: number): void {
    const stale: Voice[] = [];
    for (const v of this.voices) if (now > v.endAt + 0.5) stale.push(v);
    for (const v of this.releasing) if (now > v.endAt + 0.5) stale.push(v);
    for (const l of this.fadingLoops) if (now > l.voice.endAt + 0.5) stale.push(l.voice);
    for (const v of stale) v.kill();
  }

  private fail(where: string, e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    this._lastError = `${where}: ${msg}`;
    console.warn(`[audio] ${where}:`, e);
  }
}
