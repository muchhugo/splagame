import { Color3, Color4, DefaultRenderingPipeline, DirectionalLight, Engine, HemisphericLight, Scene, Vector3 } from '@babylonjs/core';
import type { GameEvent, LobbyPlayer, PaintDeltaWire, PaintSnapshotWire, RoomPhase, SnapshotMessage, TeamId, Vec3 } from '@borrifo/game-contracts';
import {
  FORM_FLOW,
  PFLAG_ALIVE,
  PFLAG_CHARGING,
  PFLAG_CLIMBING,
  PFLAG_DRAGGING,
  PFLAG_FIRING,
  PFLAG_GROUNDED,
  PFLAG_IN_ENEMY_INK,
  PFLAG_PROTECTED,
  PFLAG_SPECIAL_READY,
  PFLAG_SUBMERGED,
  PFLAG_SWINGING,
  PFLAG_TRAVEL_FLY,
  PFLAG_TRAVEL_PREP,
  TICK_DT,
  encodeInput,
  GROUND_ENEMY,
} from '@borrifo/game-contracts';
import { ESTILINGUE, INK, MORINGA, MOVEMENT, RODA_DE_OLEIRO, WEAPONS, type MapSpec } from '@borrifo/game-content';
import { PaintLayout, PaintReplica, PhysicsWorld, aimDirection, buildFaces, initPhysics, lerp, muzzlePosition, pitchFromDir, segmentCapsuleHit, yawFromDir, type MapFace } from '@borrifo/game-simulation';
import { PALETTES, settingsStore, type Settings } from '../app/settings';
import { AudioEngine, type SfxId } from './audio';
import { CharacterView, type CharacterVisual } from './render/CharacterView';
import { setToonLight } from './render/ToonMaterial';
import { CameraRig } from './render/CameraRig';
import { Environment } from './render/Environment';
import { LevelRenderer } from './render/LevelRenderer';
import { Effects } from './effects/Effects';
import { InputManager } from './input/InputManager';
import { LocalPredictor } from './prediction/LocalPredictor';
import { RemoteInterpolator } from './prediction/RemoteInterpolator';
import { hudDom, hudStore, type KillfeedEntry } from './hud';

export class WebGL2UnavailableError extends Error {}

export function detectWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ok = !!gl;
    (gl as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

interface RuntimeHooks {
  sendInput(wire: ReturnType<typeof encodeInput>): void;
  onMapToggle(open: boolean): void;
  onMenuRequested(): void;
  onPointerLock(locked: boolean): void;
  onUserGesture(): void;
  playerName(id: number): string;
  requestPaintResync(roundId: number, reason: string): void;
}

/**
 * Runtime 3D (Babylon.js, WebGL2). A engine controla a cena; React só mostra
 * menus/HUD a partir de stores atualizadas em baixa frequência.
 */
export class GameRuntime {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly faces: MapFace[];
  readonly layout: PaintLayout;
  physics!: PhysicsWorld;
  level!: LevelRenderer;
  env!: Environment;
  effects!: Effects;
  rig!: CameraRig;
  input: InputManager;
  audio = new AudioEngine();
  replica: PaintReplica;
  private pipeline: DefaultRenderingPipeline | null = null;
  private interp = new RemoteInterpolator();
  private views = new Map<number, CharacterView>();
  private predictor: LocalPredictor | null = null;
  private roster = new Map<number, LobbyPlayer>();
  myId = 0;
  myTeam: TeamId = 0;
  private phase: RoomPhase = 'lobby';
  private timeLeftMs = 0;
  private timeLeftAt = 0;
  private roundId = 0;
  private acc = 0;
  private lastFrame = performance.now();
  private hudTimer = 0;
  private killfeed: KillfeedEntry[] = [];
  private kfId = 1;
  private lastSnapshot: SnapshotMessage | null = null;
  private deniedMsg: string | null = null;
  private deniedTimer = 0;
  private lastCountdownSec = -1;
  private rippleTimers = new Map<number, number>();
  private fps = 0;
  private frames = 0;
  private fpsTimer = 0;
  private hitmarkerT = 0;
  private hitmarkerLethal = false;
  private damageT = 0;
  private prevInk = 100;
  private prevSpecial = 0;
  private visible = true;
  private disposed = false;
  private settingsUnsub: () => void;
  private resizeObs: ResizeObserver;
  private frameBudgetMs = 0;
  private lastRenderAt = 0;
  private hooks: RuntimeHooks;
  private lastPos = new Map<number, Vec3>();
  pendingTravelTarget: number | null = null;
  /** Câmera de inspeção (somente testes/diagnóstico em dev): segue um ponto fixo em vez do jogador. */
  debugView: { pos: Vec3; yaw: number; pitch: number } | null = null;
  private impactBudget = 0;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly map: MapSpec,
    hooks: RuntimeHooks,
  ) {
    this.hooks = hooks;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, powerPreference: 'high-performance', antialias: true }, true);
    if (this.engine.webGLVersion < 2) {
      this.engine.dispose();
      throw new WebGL2UnavailableError('WebGL2 indisponível');
    }
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(...map.lighting.fogColor, 1);
    this.scene.skipPointerMovePicking = true;
    this.faces = buildFaces(map);
    this.layout = PaintLayout.build(map, this.faces);
    this.replica = new PaintReplica(this.layout, {
      onCellsChanged: (cells) => {
        const o = this.replica.state.owner;
        for (const c of cells) this.level?.atlas.setCell(c, o[c]);
      },
      onFullReset: () => this.level?.atlas.setAll(this.replica.state.owner),
      requestResync: (roundId, reason) => this.hooks.requestPaintResync(roundId, reason),
    });
    this.input = new InputManager(canvas);
    this.input.onMapChanged = (o) => this.hooks.onMapToggle(o);
    this.input.onPointerLockChange = (l) => this.hooks.onPointerLock(l);
    this.input.onUserGesture = () => this.hooks.onUserGesture();
    this.resizeObs = new ResizeObserver(() => this.engine.resize());
    this.resizeObs.observe(canvas);
    this.settingsUnsub = settingsStore.subscribe(() => this.applySettings(settingsStore.get()));
  }

  static async create(canvas: HTMLCanvasElement, map: MapSpec, hooks: RuntimeHooks, onProgress: (p: number, label: string) => void): Promise<GameRuntime> {
    onProgress(0.05, 'Acordando a física…');
    await initPhysics();
    const rt = new GameRuntime(canvas, map, hooks);
    onProgress(0.15, 'Montando o pátio…');
    rt.physics = new PhysicsWorld(map);
    const Lt = map.lighting;
    setToonLight({
      sunDir: new Vector3(...Lt.sunDirection).normalize(),
      sunColor: new Color3(...Lt.sunColor),
      skyColor: Color3.Lerp(new Color3(...Lt.skyTop), new Color3(1, 1, 1), 0.45),
      groundColor: new Color3(...Lt.ambient),
      shadowTint: new Color3(...Lt.shadowTint),
    });
    const colors = rt.teamColors();
    rt.level = new LevelRenderer(rt.scene, map, rt.faces, rt.layout);
    rt.level.setTeamColors(colors[0], colors[1]);
    rt.env = new Environment(rt.scene, map);
    rt.effects = new Effects(rt.scene, rt.physics, colors);
    rt.rig = new CameraRig(rt.scene, rt.physics);
    rt.scene.activeCamera = rt.rig.camera;
    // luzes para personagens e objetos (o cenário usa shader próprio com a mesma luz)
    const hemi = new HemisphericLight('ceu', new Vector3(0, 1, 0), rt.scene);
    hemi.diffuse = new Color3(...map.lighting.skyTop).scale(0.55).add(new Color3(0.3, 0.3, 0.3));
    hemi.groundColor = new Color3(...map.lighting.ambient).scale(0.6);
    hemi.intensity = 0.85;
    const sun = new DirectionalLight('sol', new Vector3(...map.lighting.sunDirection), rt.scene);
    sun.diffuse = new Color3(...map.lighting.sunColor);
    sun.intensity = 1.05;
    rt.rig.camera.position.set(-40, 18, -26);
    rt.rig.camera.setTarget(Vector3.Zero());
    onProgress(0.3, 'Assando luz e sombras…');
    await rt.level.atlas.bakeLighting(rt.physics, map.lighting.sunDirection, (p) => onProgress(0.3 + p * 0.6, 'Assando luz e sombras…'));
    rt.level.flushTexture();
    rt.applySettings(settingsStore.get());
    onProgress(0.95, 'Aquecendo os shaders…');
    await rt.scene.whenReadyAsync();
    rt.engine.runRenderLoop(() => rt.frame());
    onProgress(1, 'Pronto');
    return rt;
  }

  teamColors(): [Color3, Color3] {
    const p = PALETTES[settingsStore.get().palette].team;
    return [Color3.FromHexString(p[0]), Color3.FromHexString(p[1])];
  }

  private applySettings(s: Settings) {
    if (this.disposed) return;
    const colors = this.teamColors();
    this.level?.setTeamColors(colors[0], colors[1]);
    this.level?.setPatterns(s.paintPatterns);
    this.effects?.setTeamColors(colors);
    if (this.effects) this.effects.reduceFlashes = s.reduceFlashes;
    for (const v of this.views.values()) v.setTeamColor(colors[v.team]);
    if (this.rig) {
      this.rig.setFov(s.fov);
      this.rig.shoulder = s.shoulder;
      this.rig.reduceShake = s.reduceShake;
    }
    this.audio.setVolumes({ master: s.volumeMaster, sfx: s.volumeSfx, music: s.volumeMusic });
    this.audio.setMuted(s.muted);
    this.frameBudgetMs = s.fpsCap > 0 ? 1000 / s.fpsCap - 0.5 : 0;
    const scaling = s.quality === 'baixa' ? 1.6 : s.quality === 'media' ? 1.15 : 1 / Math.min(1.5, window.devicePixelRatio || 1);
    this.engine.setHardwareScalingLevel(scaling);
    if (s.quality === 'baixa' || s.reduceFlashes) {
      this.pipeline?.dispose();
      this.pipeline = null;
    } else if (!this.pipeline && this.rig) {
      this.pipeline = new DefaultRenderingPipeline('pos', false, this.scene, [this.rig.camera]);
      this.pipeline.fxaaEnabled = true;
      this.pipeline.bloomEnabled = s.quality === 'alta';
      this.pipeline.bloomThreshold = 0.85;
      this.pipeline.bloomWeight = 0.18;
      this.pipeline.bloomKernel = 48;
    } else if (this.pipeline) {
      this.pipeline.bloomEnabled = s.quality === 'alta';
    }
  }

  /* ------------------------------ rodada ------------------------------ */

  setRoster(players: LobbyPlayer[], myId: number) {
    this.myId = myId;
    this.roster = new Map(players.map((p) => [p.playerId, p]));
    const me = this.roster.get(myId);
    if (me) this.myTeam = me.team;
  }

  beginRound(roundId: number, contextTag: number) {
    this.roundId = roundId;
    this.replica.expectRound(roundId, contextTag);
    this.level.atlas.setAll(this.replica.state.owner);
    this.effects.clearAll();
    this.interp.clear();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.predictor?.dispose();
    this.predictor = null;
    this.lastSnapshot = null;
    this.killfeed = [];
    this.lastCountdownSec = -1;
    hudStore.set({ active: true, killfeed: [], phase: 'loading' });
  }

  endRound() {
    this.input.releaseAll();
    this.input.releaseLock();
    for (const k of ['swim', 'charge', 'enemy_ink']) this.audio.setLoop(k, k as 'swim', false);
  }

  onPaintSnapshot(s: PaintSnapshotWire) {
    this.replica.receiveSnapshot(s);
  }

  onPaintDelta(d: PaintDeltaWire) {
    this.replica.receiveDelta(d);
  }

  setPhase(phase: RoomPhase, remainingMs: number | null) {
    const prev = this.phase;
    this.phase = phase;
    if (remainingMs !== null) {
      this.timeLeftMs = remainingMs;
      this.timeLeftAt = performance.now();
    }
    if (phase === 'running' && prev !== 'running') {
      this.play('round_start');
      this.audio.startMusic();
    }
    if (phase === 'finishing' && prev !== 'finishing') {
      this.play('round_end');
      this.audio.stopMusic(2);
      this.endRound();
    }
  }

  /* ------------------------------ rede ------------------------------ */

  onSnapshot(m: SnapshotMessage, receivedAt: number) {
    if (this.disposed) return;
    this.lastSnapshot = m;
    this.interp.push(m.t, receivedAt, m.pl.filter((t) => t[0] !== this.myId));
    for (const t of m.pl) this.lastPos.set(t[0], [t[1] / 100, t[2] / 100, t[3] / 100]);
    if (m.ph !== this.phase) this.setPhase(m.ph, m.tl);
    else {
      this.timeLeftMs = m.tl;
      this.timeLeftAt = receivedAt;
    }
    if (m.me) {
      if (!this.predictor) {
        const me = this.roster.get(this.myId);
        this.predictor = new LocalPredictor(this.physics, { layout: this.layout, owner: this.replica.state.owner }, this.myTeam, me?.weaponId ?? 'esguicho', m.me.p, this.myTeam === 0 ? Math.PI / 2 : -Math.PI / 2);
        this.input.yaw = this.myTeam === 0 ? Math.PI / 2 : -Math.PI / 2;
        this.input.pitch = 0.12;
      }
      const wasAlive = this.predictor.state.alive;
      this.predictor.reconcile(m.me, m.ack);
      if (!wasAlive && this.predictor.state.alive) {
        // reaparecimento: câmera volta a olhar para o centro
        this.input.yaw = this.myTeam === 0 ? Math.PI / 2 : -Math.PI / 2;
        this.predictor.prevPos = [...this.predictor.state.pos] as Vec3;
      }
    }
    this.effects.syncObjects(m.ob);
    for (const e of m.ev) this.handleEvent(e);
  }

  private handleEvent(e: GameEvent) {
    const teamOf = (pid: number): TeamId => this.roster.get(pid)?.team ?? 0;
    switch (e.k) {
      case 'shot':
        if (e.pid === this.myId) return;
        this.effects.shot(e.p, e.v, e.gd, e.g, e.life, teamOf(e.pid));
        this.play(e.w === 'flick' ? 'shot_flick' : 'shot_esguicho', e.p, teamOf(e.pid), 0.8);
        return;
      case 'beam':
        if (e.pid !== this.myId) this.effects.beam(e.from, e.to, e.team, e.charge);
        if (e.pid !== this.myId) this.play('charge_release', e.from, e.team);
        return;
      case 'impact':
        this.effects.impact(e.p, e.n, e.team, e.s);
        if (this.impactBudget < 6) {
          this.impactBudget++;
          this.play('impact', e.p, e.team, 0.6);
        }
        return;
      case 'hit':
        this.views.get(e.dst)?.hitReaction();
        if (e.src === this.myId) {
          this.hitmarkerT = e.lethal ? 0.35 : 0.18;
          this.hitmarkerLethal = !!e.lethal;
          this.play('hit_confirm', undefined, undefined, e.lethal ? 1 : 0.8);
        }
        if (e.dst === this.myId) {
          this.damageT = 0.4;
          this.rig.shake(0.08 + e.dmg * 0.001);
          this.play('hurt');
        }
        return;
      case 'elim': {
        const vp = this.lastPos.get(e.victim);
        if (vp) this.effects.elimination(vp, teamOf(e.victim));
        if (e.killer === this.myId) this.play('elim_confirm');
        if (e.victim === this.myId) {
          this.play('death');
          this.rig.shake(0.18);
        } else if (vp) this.play('death', vp, teamOf(e.victim), 0.6);
        const causeName: Record<string, string> = { esguicho: 'Esguicho', rodo: 'Rodo', estilingue: 'Estilingue', moringa: 'Moringa', wheel: 'Roda de Oleiro', contact: 'Rodo' };
        this.killfeed = [
          ...this.killfeed.slice(-4),
          {
            id: this.kfId++,
            killer: e.killer !== null ? this.hooks.playerName(e.killer) : null,
            killerTeam: e.killer !== null ? teamOf(e.killer) : null,
            victim: this.hooks.playerName(e.victim),
            victimTeam: teamOf(e.victim),
            cause: causeName[e.cause] ?? e.cause,
            mine: e.killer === this.myId || e.victim === this.myId,
          },
        ];
        const id = this.kfId - 1;
        setTimeout(() => (this.killfeed = this.killfeed.filter((k) => k.id !== id)), 5000);
        return;
      }
      case 'respawn': {
        const p = this.lastPos.get(e.pid);
        if (p) this.effects.respawn(p, teamOf(e.pid));
        if (e.pid === this.myId) this.play('respawn');
        return;
      }
      case 'throw':
        this.play(e.kind === 'wheel' ? 'special_activate' : 'throw', e.p, e.team);
        return;
      case 'burst':
        this.effects.burst(e.p, e.team, e.r);
        this.play('burst', e.p, e.team);
        if (this.predictor && dist3(this.predictor.state.pos, e.p) < 6) this.rig.shake(0.1);
        return;
      case 'wave':
        this.effects.wave(e.p, e.team, e.r);
        this.play('wave', e.p, e.team);
        return;
      case 'special':
        if (e.pid === this.myId) this.play('special_activate');
        return;
      case 'travel':
        if (e.phase === 'launch') {
          this.effects.landingMarker(e.pid, e.to, teamOf(e.pid));
          this.play('travel_launch', this.lastPos.get(e.pid), teamOf(e.pid));
        } else if (e.phase === 'land') {
          this.effects.clearLandingMarker(e.pid);
          this.play('travel_land', e.to, teamOf(e.pid));
        } else if (e.phase === 'cancel') {
          this.effects.clearLandingMarker(e.pid);
          if (e.pid === this.myId) this.showDenied('Deslocamento cancelado');
        }
        return;
      case 'denied': {
        const msgs: Record<string, string> = {
          secondary_ink: 'Pigmento insuficiente para a Moringa',
          secondary_form: 'Saia da Forma Pião para arremessar',
          secondary_cooldown: 'Moringa recarregando',
          special_unavailable: 'Roda de Oleiro ainda não está pronta',
          charge_low: 'Carga insuficiente',
          travel_invalid_target: 'Companheiro inválido',
          travel_target_unavailable: 'Companheiro indisponível',
          travel_state: 'Não dá para se deslocar agora',
        };
        this.showDenied(msgs[e.reason] ?? 'Ação indisponível');
        return;
      }
      default:
        return;
    }
  }

  private showDenied(msg: string) {
    this.deniedMsg = msg;
    this.deniedTimer = 1.6;
    this.play('denied');
  }

  private play(id: SfxId, pos?: Vec3, team?: TeamId, volume?: number) {
    this.audio.play(id, { ...(pos ? { pos } : {}), ...(team !== undefined ? { team } : {}), ...(volume !== undefined ? { volume } : {}) });
  }

  /* ------------------------------ frame ------------------------------ */

  setVisible(v: boolean) {
    this.visible = v;
    if (!v) {
      this.input.releaseAll();
      void this.audio.suspend();
    } else void this.audio.resume();
  }

  requestTravel(targetId: number) {
    this.pendingTravelTarget = targetId;
  }

  private frame() {
    if (this.disposed) return;
    const now = performance.now();
    // suspensa/oculta: mantém rede e estado em ritmo baixo, sem desenhar a cena
    const budget = this.visible ? this.frameBudgetMs : 250;
    if (budget > 0 && now - this.lastRenderAt < budget) return;
    this.lastRenderAt = now;
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 1) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
    this.impactBudget = Math.max(0, this.impactBudget - dt * 20);
    this.input.consumeLook();
    const inRound = this.phase === 'countdown' || this.phase === 'running';
    const pred = this.predictor;

    // ---------- previsão em passo fixo (30 Hz) + envio de entradas ----------
    if (pred && inRound) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK_DT && steps < 4) {
        this.acc -= TICK_DT;
        steps++;
        const aim = this.computeAim(pred);
        const actions = this.input.takeActions();
        let travel: number | undefined;
        if (this.pendingTravelTarget !== null) {
          actions.push('tacticalTravel');
          travel = this.pendingTravelTarget;
          this.pendingTravelTarget = null;
        }
        pred.frozen = this.phase === 'countdown';
        const move = this.input.moveAxes();
        const res = pred.step(move, aim.yaw, aim.pitch, this.input.buttons(), actions, travel);
        this.hooks.sendInput(encodeInput(res.input));
        this.localCosmetics(pred, res.intents, aim.dir);
      }
      if (steps === 4) this.acc = 0;
    }

    // ---------- câmera e personagens ----------
    const alpha = this.acc / TICK_DT;
    if (this.debugView) {
      this.rig.update(dt, this.debugView.pos, this.debugView.yaw, this.debugView.pitch, false);
    }
    if (pred) {
      const rp = pred.renderPos(alpha, dt);
      const s = pred.state;
      if (!this.debugView) this.rig.update(dt, rp, this.input.yaw, this.input.pitch, s.form === FORM_FLOW);
      this.updateView(this.myId, {
        pos: rp,
        yaw: s.yaw,
        pitch: s.pitch,
        speed: Math.hypot(s.vel[0], s.vel[2]),
        vy: s.vel[1],
        grounded: s.grounded,
        form: s.form,
        submerged: s.submerged,
        climbing: s.climbSurface >= 0,
        firing: s.firingTimer > 0,
        charging: s.charging,
        charge: s.charge,
        dragging: s.dragging,
        swinging: s.swingPhase === 1,
        alive: s.alive,
        protected: s.spawnProtect > 0,
        hp: s.hp,
        ink: s.ink,
        inEnemyInk: s.groundState === GROUND_ENEMY,
        travel: s.travelPhase,
      }, dt);
      this.localAudio(pred);
    } else {
      // órbita lenta de apresentação antes da rodada
      const t = now * 0.00005;
      this.rig.camera.position.set(Math.cos(t) * 38, 16, Math.sin(t) * 26);
      this.rig.camera.setTarget(new Vector3(0, 1, 0));
    }
    const rTick = this.interp.renderTick(now);
    for (const id of this.interp.ids()) {
      const smp = this.interp.sample(id, rTick);
      if (!smp) continue;
      const f = smp.flags;
      const vis: CharacterVisual = {
        pos: smp.pos,
        yaw: smp.yaw,
        pitch: smp.pitch,
        speed: Math.hypot(smp.vel[0], smp.vel[1]),
        vy: 0,
        grounded: (f & PFLAG_GROUNDED) !== 0,
        form: smp.form,
        submerged: (f & PFLAG_SUBMERGED) !== 0,
        climbing: (f & PFLAG_CLIMBING) !== 0,
        firing: (f & PFLAG_FIRING) !== 0,
        charging: (f & PFLAG_CHARGING) !== 0,
        charge: smp.charge,
        dragging: (f & PFLAG_DRAGGING) !== 0,
        swinging: (f & PFLAG_SWINGING) !== 0,
        alive: (f & PFLAG_ALIVE) !== 0,
        protected: (f & PFLAG_PROTECTED) !== 0,
        hp: smp.hp,
        ink: 100,
        inEnemyInk: (f & PFLAG_IN_ENEMY_INK) !== 0,
        travel: f & PFLAG_TRAVEL_FLY ? 2 : f & PFLAG_TRAVEL_PREP ? 1 : 0,
      };
      this.updateView(id, vis, dt);
      this.remoteCosmetics(id, vis, dt);
    }

    this.effects.cameraPos = [this.rig.camera.position.x, this.rig.camera.position.y, this.rig.camera.position.z];
    this.effects.update(dt);
    this.env.update(dt);
    this.level.setTime(now / 1000);
    this.level.flushTexture();
    const cp = this.rig.camera.position;
    const cf = this.rig.camera.getDirection(Vector3.Forward());
    this.audio.setListener([cp.x, cp.y, cp.z], [cf.x, cf.y, cf.z]);
    this.updateDomHud(dt);
    this.hudTimer += dt;
    if (this.hudTimer >= 1 / 15) {
      this.hudTimer = 0;
      this.publishHud();
    }
    if (this.visible) this.scene.render();
  }

  /** Mira em duas etapas: alvo visual pela câmera, trajetória validada a partir do cano. */
  private computeAim(pred: LocalPredictor): { yaw: number; pitch: number; dir: Vec3; blocked: Vec3 | null; target: Vec3 } {
    const camPos = this.rig.position();
    const camFwd = aimDirection(this.input.yaw, this.input.pitch);
    let tDist = 80;
    const hit = this.physics.raycast(camPos, camFwd, 80);
    if (hit) tDist = hit.toi;
    // considera inimigos visíveis como alvo da câmera
    const end: Vec3 = [camPos[0] + camFwd[0] * tDist, camPos[1] + camFwd[1] * tDist, camPos[2] + camFwd[2] * tDist];
    const rTick = this.interp.renderTick(performance.now());
    for (const id of this.interp.ids()) {
      const smp = this.interp.sample(id, rTick);
      if (!smp || !(smp.flags & PFLAG_ALIVE) || this.roster.get(id)?.team === this.myTeam) continue;
      const t = segmentCapsuleHit(camPos, end, smp.pos, smp.form === 1 ? MOVEMENT.flowHitHeight : MOVEMENT.combatHitHeight, MOVEMENT.hitRadius);
      if (t >= 0 && t * tDist < tDist) tDist = t * tDist;
    }
    const target: Vec3 = [camPos[0] + camFwd[0] * tDist, camPos[1] + camFwd[1] * tDist, camPos[2] + camFwd[2] * tDist];
    const probe = { ...pred.state, yaw: this.input.yaw };
    const muzzle = muzzlePosition(probe);
    let dir: Vec3 = [target[0] - muzzle[0], target[1] - muzzle[1], target[2] - muzzle[2]];
    const dl = Math.hypot(dir[0], dir[1], dir[2]);
    if (dl < 2.2 || tDist < 2) dir = camFwd;
    else dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    let blocked: Vec3 | null = null;
    const block = this.physics.raycast(muzzle, dir, Math.max(0.1, dl - 0.3));
    if (block && dl > 1 && block.toi < dl - 0.5) blocked = block.point;
    this.aimBlocked = blocked;
    return { yaw: yawFromDir(dir), pitch: pitchFromDir(dir), dir, blocked, target };
  }
  private aimBlocked: Vec3 | null = null;

  /** Efeitos imediatos do próprio jogador (visuais, sem autoridade). */
  private localCosmetics(pred: LocalPredictor, intents: import('@borrifo/game-simulation').StepIntents, dir: Vec3) {
    const s = pred.state;
    const team = this.myTeam;
    const w = WEAPONS[pred.weaponId];
    const muzzle = muzzlePosition(s);
    for (let i = 0; i < intents.shots; i++) {
      if (w.kind !== 'automatic') break;
      const sp = ((w.spreadDeg * Math.PI) / 180) * 0.5;
      const d = aimDirection(yawFromDir(dir) + (Math.random() - 0.5) * sp, pitchFromDir(dir) + (Math.random() - 0.5) * sp * 0.5);
      this.effects.shot(muzzle, [d[0] * w.projectileSpeed, d[1] * w.projectileSpeed, d[2] * w.projectileSpeed], w.straightTime, w.gravity, w.maxLife, team);
      this.play('shot_esguicho', undefined, team, 0.7);
    }
    if (intents.flick && w.kind === 'contact') {
      for (let i = 0; i < w.flickCount; i++) {
        const t = i / (w.flickCount - 1) - 0.5;
        const d = aimDirection(s.yaw + (t * w.flickSpreadDeg * 2 * Math.PI) / 180, Math.min(s.pitch, 0.25) - 0.12);
        this.effects.shot(muzzle, [d[0] * w.flickSpeed, d[1] * w.flickSpeed + w.flickUp, d[2] * w.flickSpeed], 0, w.flickGravity, w.flickLife, team);
      }
      this.play('shot_flick', undefined, team);
    }
    if (intents.chargeRelease > 0) {
      const range = lerp(ESTILINGUE.minRange, ESTILINGUE.maxRange, intents.chargeRelease);
      const hit = this.physics.raycast(muzzle, dir, range);
      const end: Vec3 = hit ? hit.point : [muzzle[0] + dir[0] * range, muzzle[1] + dir[1] * range, muzzle[2] + dir[2] * range];
      this.effects.beam(muzzle, end, team, intents.chargeRelease);
      this.play('charge_release', undefined, team);
      this.rig.shake(0.03);
    }
    if (intents.throwSecondary) this.play('throw');
    if (intents.jumped) this.play('jump', undefined, team, 0.6);
  }

  private chargeLoopOn = false;
  private swimLoopOn = false;
  private enemyLoopOn = false;
  private lastForm = 0;

  private localAudio(pred: LocalPredictor) {
    const s = pred.state;
    if (s.form !== this.lastForm) {
      this.play(s.form === FORM_FLOW ? 'transform_in' : 'transform_out');
      this.lastForm = s.form;
    }
    const swim = s.submerged && Math.hypot(s.vel[0], s.vel[2]) > 0.5;
    if (swim !== this.swimLoopOn || swim) this.audio.setLoop('swim', 'swim', swim, { param: Math.min(1, Math.hypot(s.vel[0], s.vel[2]) / 8) });
    this.swimLoopOn = swim;
    if (s.charging !== this.chargeLoopOn || s.charging) this.audio.setLoop('charge', 'charge', s.charging, { param: s.charge });
    this.chargeLoopOn = s.charging;
    const enemy = s.groundState === GROUND_ENEMY && s.grounded;
    if (enemy !== this.enemyLoopOn) this.audio.setLoop('enemy_ink', 'enemy_ink', enemy);
    this.enemyLoopOn = enemy;
    if (s.ink < INK.lowThreshold && this.prevInk >= INK.lowThreshold) this.play('ink_low');
    if (s.ink >= INK.capacity - 0.01 && this.prevInk < INK.capacity - 0.01 && s.submerged) this.play('refill_done');
    this.prevInk = s.ink;
    if (s.special >= RODA_DE_OLEIRO.pointsRequired && this.prevSpecial < RODA_DE_OLEIRO.pointsRequired) this.play('special_ready');
    this.prevSpecial = s.special;
    // laser do Estilingue do próprio jogador
    if (s.charging) {
      const m = muzzlePosition(s);
      const d = aimDirection(s.yaw, s.pitch);
      this.effects.laser(this.myId, new Vector3(...m), new Vector3(...d), lerp(ESTILINGUE.minRange, ESTILINGUE.maxRange, s.charge), this.myTeam, s.charge);
    }
    if (s.dragging && Math.hypot(s.vel[0], s.vel[2]) > 1) this.dragSpray(s.pos, s.yaw, this.myTeam);
    if (s.submerged && Math.hypot(s.vel[0], s.vel[2]) > 1) this.maybeRipple(this.myId, s.pos, this.myTeam, 0.18);
  }

  private remoteCosmetics(id: number, v: CharacterVisual, dt: number) {
    const team = this.roster.get(id)?.team ?? 0;
    if (!v.alive) return;
    if (v.charging) {
      const probe = { pos: v.pos, yaw: v.yaw } as unknown as Parameters<typeof muzzlePosition>[0];
      const m = muzzlePosition(probe);
      const d = aimDirection(v.yaw, v.pitch);
      this.effects.laser(id, new Vector3(...m), new Vector3(...d), lerp(ESTILINGUE.minRange, ESTILINGUE.maxRange, v.charge), team, v.charge);
    }
    if (v.dragging && v.speed > 1) this.dragSpray(v.pos, v.yaw, team);
    // imersos em movimento deixam ondulações sutis (inclusive inimigos)
    if (v.submerged && v.speed > 1.5) this.maybeRipple(id, v.pos, team, 0.3);
    void dt;
  }

  private dragSpray(pos: Vec3, yaw: number, team: TeamId) {
    if (Math.random() > 0.5) return;
    const f = [Math.sin(yaw), Math.cos(yaw)];
    const r = [Math.cos(yaw), -Math.sin(yaw)];
    const lat = (Math.random() - 0.5) * 2;
    this.effects.impact([pos[0] + f[0] * 0.7 + r[0] * lat, pos[1] + 0.05, pos[2] + f[1] * 0.7 + r[1] * lat], [0, 1, 0], team, 0.3);
  }

  private maybeRipple(id: number, pos: Vec3, team: TeamId, interval: number) {
    const now = performance.now() / 1000;
    const last = this.rippleTimers.get(id) ?? 0;
    if (now - last < interval) return;
    this.rippleTimers.set(id, now);
    this.effects.ripple(pos, team, 0.9);
  }

  private updateView(id: number, v: CharacterVisual, dt: number) {
    let view = this.views.get(id);
    const info = this.roster.get(id);
    if (!view) {
      if (!info) return;
      const colors = this.teamColors();
      view = new CharacterView(this.scene, id, info.team, info.weaponId, colors[info.team], id === this.myId, info.team !== this.myTeam);
      this.views.set(id, view);
    }
    const ground = this.physics.raycast([v.pos[0], v.pos[1] + 0.3, v.pos[2]], [0, -1, 0], 8);
    const cp = this.rig.camera.position;
    const camDist = Math.hypot(v.pos[0] - cp.x, v.pos[1] + 0.8 - cp.y, v.pos[2] - cp.z);
    view.nearFade = Math.min(1, Math.max(0.2, (camDist - 0.9) / 0.9));
    view.update(dt, v, ground ? ground.point[1] : null, this.sunAt(v.pos));
  }

  /** Luz do sol pré-calculada no chão sob o personagem (personagem escurece na sombra do cenário). */
  private sunAt(p: Vec3): number {
    const hit = this.layout.floorAt([p[0], p[1] + 0.05, p[2]], 1.2, 0.2);
    if (!hit) return 1;
    const r = this.level.atlas.rectBySurface[hit.surface.index];
    if (!r) return 1;
    const i = Math.min(r.w - 1, Math.floor(hit.u / r.texel));
    const j = Math.min(r.h - 1, Math.floor(hit.v / r.texel));
    const b = this.level.atlas.data[((r.y + j) * this.level.atlas.width + r.x + i) * 4 + 2] / 255;
    return Math.min(1, Math.max(0, (b - 0.3) / 0.32));
  }

  private updateDomHud(dt: number) {
    this.hitmarkerT = Math.max(0, this.hitmarkerT - dt);
    this.damageT = Math.max(0, this.damageT - dt);
    const { hitmarker, blocked, damage } = hudDom;
    if (hitmarker) {
      hitmarker.style.opacity = String(Math.min(1, this.hitmarkerT * 6));
      // "pop" curto: começa um pouco maior e assenta (sem cobrir a mira)
      const t = this.hitmarkerLethal ? this.hitmarkerT / 0.35 : this.hitmarkerT / 0.18;
      hitmarker.style.transform = `scale(${(1 + Math.max(0, t - 0.5) * 0.5).toFixed(3)})`;
      hitmarker.classList.toggle('lethal', this.hitmarkerLethal);
    }
    if (damage) damage.style.opacity = String(Math.min(0.8, this.damageT * 2));
    if (blocked) {
      if (this.aimBlocked && this.predictor) {
        const sp = this.projectToScreen(this.aimBlocked);
        if (sp) {
          blocked.style.display = 'block';
          blocked.style.transform = `translate(${sp[0]}px, ${sp[1]}px)`;
        } else blocked.style.display = 'none';
      } else blocked.style.display = 'none';
    }
  }

  private projectToScreen(p: Vec3): [number, number] | null {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const m = this.scene.getTransformMatrix();
    const out = Vector3.TransformCoordinates(new Vector3(...p), m);
    if (out.z < 0 || out.z > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return [((out.x + 1) / 2) * rect.width, ((1 - out.y) / 2) * rect.height];
  }

  private publishHud() {
    const pred = this.predictor;
    const s = pred?.state;
    const snap = this.lastSnapshot;
    const tl = this.phase === 'running' || this.phase === 'countdown' ? Math.max(0, this.timeLeftMs - (performance.now() - this.timeLeftAt)) : this.timeLeftMs;
    if (this.phase === 'countdown') {
      const sec = Math.ceil(tl / 1000);
      if (sec !== this.lastCountdownSec && sec > 0) this.play('countdown_tick');
      this.lastCountdownSec = sec;
    }
    this.deniedTimer = Math.max(0, this.deniedTimer - 1 / 15);
    const roster = [...this.roster.values()]
      .filter((p) => p.inRound)
      .map((p) => {
        const last = p.playerId === this.myId ? null : this.interp.latest(p.playerId);
        return {
          playerId: p.playerId,
          name: p.displayName,
          team: p.team,
          alive: p.playerId === this.myId ? (s?.alive ?? true) : last ? (last.flags & PFLAG_ALIVE) !== 0 : true,
          isMe: p.playerId === this.myId,
          specialReady: last ? (last.flags & PFLAG_SPECIAL_READY) !== 0 : false,
        };
      });
    const w = s ? WEAPONS[pred!.weaponId] : null;
    hudStore.set({
      phase: this.phase,
      timeLeftMs: tl,
      myTeam: this.myTeam,
      weaponId: pred?.weaponId ?? 'esguicho',
      hp: s?.hp ?? 100,
      ink: s?.ink ?? 100,
      special: s ? Math.min(100, (s.special / RODA_DE_OLEIRO.pointsRequired) * 100) : 0,
      specialActive: s?.specialActive ?? false,
      alive: s?.alive ?? true,
      respawnIn: s?.respawnTimer ?? 0,
      protectedFor: s?.spawnProtect ?? 0,
      form: s?.form ?? 0,
      submerged: s?.submerged ?? false,
      inEnemyInk: s ? s.groundState === GROUND_ENEMY : false,
      charging: s?.charging ?? false,
      charge: s?.charge ?? 0,
      secondaryReady: s ? s.ink >= MORINGA.inkCost && s.secondaryCooldown <= 0 : false,
      territory: snap ? [(snap.sc[0] / snap.sc[2]) * 100, (snap.sc[1] / snap.sc[2]) * 100] : [0, 0],
      roster,
      killfeed: [...this.killfeed],
      denied: this.deniedTimer > 0 ? this.deniedMsg : null,
      travelPhase: s?.travelPhase ?? 0,
      fps: this.fps,
      corrections: pred?.corrections ?? 0,
      pendingInputs: pred?.pendingInputs ?? 0,
    });
    void w;
  }

  /** Dados para o mapa tático: aliados (nunca adversários) e minha posição. */
  tacticalAllies(): Array<{ playerId: number; name: string; pos: Vec3; alive: boolean; isMe: boolean }> {
    const out: Array<{ playerId: number; name: string; pos: Vec3; alive: boolean; isMe: boolean }> = [];
    for (const p of this.roster.values()) {
      if (p.team !== this.myTeam || !p.inRound) continue;
      if (p.playerId === this.myId) {
        if (this.predictor) out.push({ playerId: p.playerId, name: p.displayName, pos: this.predictor.state.pos, alive: this.predictor.state.alive, isMe: true });
        continue;
      }
      const l = this.interp.latest(p.playerId);
      if (l) out.push({ playerId: p.playerId, name: p.displayName, pos: l.pos, alive: (l.flags & PFLAG_ALIVE) !== 0, isMe: false });
    }
    return out;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.settingsUnsub();
    this.resizeObs.disconnect();
    this.engine.stopRenderLoop();
    this.input.dispose();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.predictor?.dispose();
    this.effects?.dispose();
    this.env?.dispose();
    this.level?.dispose();
    this.pipeline?.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.physics?.dispose();
    void this.audio.dispose();
    hudStore.set({ active: false });
  }
}

function dist3(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
