import { Color3, Color4, DefaultRenderingPipeline, DirectionalLight, Engine, FreeCamera, HemisphericLight, RenderTargetTexture, Scene, Vector3 } from '@babylonjs/core';
import type { AppearanceId, BuffKind, GameEvent, GameModeId, LobbyPlayer, ObjectiveSnapshot, PaintDeltaWire, PaintSnapshotWire, RoomPhase, SnapshotMessage, TeamId, Vec3 } from '@borrifo/game-contracts';

const BUFF_NAME: Record<BuffKind, string> = { embalo: 'Embalo', folego: 'Fôlego' };
import {
  Buttons,
  FORM_FLOW,
  PFLAG_ALIVE,
  PFLAG_CARRIER,
  PFLAG_EMBALO,
  PFLAG_FOLEGO,
  PFLAG_MUTIRAO,
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
import { settingsStore, teamColorsFor, type Settings } from '../app/settings';
import { AudioEngine, type SfxId } from './audio';
import { CharacterView, type CharacterVisual } from './render/CharacterView';
import { ModeView } from './render/ModeView';
import { LobbyStage, type StageFraming, type StageMode, type StagePlayer } from './render/LobbyStage';
import { stageStore } from './stage';
import { setToonLight } from './render/ToonMaterial';
import { CameraRig } from './render/CameraRig';
import { Environment } from './render/Environment';
import { LevelRenderer } from './render/LevelRenderer';
import { Effects } from './effects/Effects';
import { InputManager } from './input/InputManager';
import { AIM_ASSIST_TUNING, NO_ASSIST, aimAssist, type AimAssistResult, type AimTarget } from './input/aimAssist';
import { RUMBLE, RumbleGate, gamepadHub, type RumbleKind } from './input/gamepad';
import { deviceStore } from './input/device';
import { tutorialTick } from '../app/tutorial';
import { NAMEPLATE, nameplateVisible } from './nameplates';
import { LocalPredictor } from './prediction/LocalPredictor';
import { RemoteInterpolator } from './prediction/RemoteInterpolator';
import { hudDom, hudStore, type HudState, type KillfeedEntry } from './hud';

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

export interface RuntimeHooks {
  sendInput(wire: ReturnType<typeof encodeInput>): void;
  onMapToggle(open: boolean): void;
  onMenuRequested(): void;
  onPointerLock(locked: boolean): void;
  onUserGesture(): void;
  playerName(id: number): string;
  requestPaintResync(roundId: number, reason: string): void;
  /** Aviso curto de modo (buff, Mutirão, cápsula) para a interface. */
  onModeNotice?(text: string, kind: 'info' | 'warn' | 'good'): void;
  /** Estado de voz (da chamada do host) de um userId, se ele estiver na chamada. */
  voiceOf(userId: string): { speaking: boolean; muted: boolean } | undefined;
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
  modeView!: ModeView;
  private mode: GameModeId = 'territorio';
  private lastObj: ObjectiveSnapshot | null = null;
  /** Buff/Mutirão do jogador local (do snapshot próprio). */
  private myMode: { bf: BuffKind | null; bt: number; mt: number; mc: number } = { bf: null, bt: 0, mt: 0, mc: 0 };
  rig!: CameraRig;
  /** Palco do lobby (personagens de quem está na sala, dentro da arena). */
  stage!: LobbyStage;
  /** Transição cinematográfica até o spawn: pose de onde a câmera saiu e o instante. */
  private cineFrom: { pos: Vector3; rot: Vector3; fov: number } | null = null;
  private cineAt = 0;
  private roundLoadAt = 0;
  private flyA0 = 0;
  private stagePubAt = 0;
  input: InputManager;
  audio: AudioEngine;
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
  /** Relógio da previsão local (s), avança um passo fixo por passo previsto. */
  private predClock = 0;
  private lastShotSimAt = -Infinity;
  pendingTravelTarget: number | null = null;
  /** Câmera de inspeção (somente testes/diagnóstico em dev): segue um ponto fixo em vez do jogador. */
  debugView: { pos: Vec3; yaw: number; pitch: number } | null = null;
  private impactBudget = 0;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly map: MapSpec,
    hooks: RuntimeHooks,
    audio: AudioEngine,
  ) {
    this.hooks = hooks;
    this.audio = audio;
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
    this.input.onMenuRequested = () => this.hooks.onMenuRequested();
    this.resizeObs = new ResizeObserver(() => this.engine.resize());
    this.resizeObs.observe(canvas);
    this.settingsUnsub = settingsStore.subscribe(() => this.applySettings(settingsStore.get()));
  }

  /**
   * Cria o runtime de um mapa. Na troca de mapa entre rodadas, o AudioEngine anterior é
   * reaproveitado (o contexto de áudio já desbloqueado pelo gesto do jogador continua valendo).
   */
  static async create(canvas: HTMLCanvasElement, map: MapSpec, hooks: RuntimeHooks, onProgress: (p: number, label: string) => void, audio?: AudioEngine): Promise<GameRuntime> {
    onProgress(0.05, 'Acordando a física…');
    await initPhysics();
    const rt = new GameRuntime(canvas, map, hooks, audio ?? new AudioEngine({ baseUrl: import.meta.env.BASE_URL }));
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
    rt.modeView = new ModeView(rt.scene, map, colors);
    rt.rig = new CameraRig(rt.scene, rt.physics);
    rt.scene.activeCamera = rt.rig.camera;
    rt.stage = new LobbyStage(rt.scene, rt.physics, map, colors);
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

  /** Par de apresentação da rodada (escolhido pelo servidor). */
  private teamPairId: string | null = null;

  teamColors(): [Color3, Color3] {
    const p = teamColorsFor(settingsStore.get().palette, this.teamPairId);
    return [Color3.FromHexString(p[0]), Color3.FromHexString(p[1])];
  }

  /** Troca o par de cores (nova rodada ou reconexão): tinta, roupa, efeitos e marcadores juntos. */
  setTeamPair(id: string) {
    if (id === this.teamPairId) return;
    this.teamPairId = id;
    this.applySettings(settingsStore.get());
  }

  private applySettings(s: Settings) {
    if (this.disposed) return;
    const colors = this.teamColors();
    this.level?.setTeamColors(colors[0], colors[1]);
    this.level?.setPatterns(s.paintPatterns);
    this.effects?.setTeamColors(colors);
    this.modeView?.setTeamColors(colors);
    this.stage?.setColors(colors);
    if (this.stage) this.stage.perTeam = s.quality === 'baixa' ? 3 : 5;
    if (this.effects) {
      this.effects.reduceFlashes = s.reduceFlashes;
      this.effects.particleScale = s.particles === 'reduzidas' ? 0.5 : 1;
    }
    for (const v of this.views.values()) v.setTeamColor(colors[v.team]);
    if (this.rig) {
      this.rig.setFov(s.fov);
      this.rig.shoulder = s.shoulder;
      this.rig.reduceShake = s.reduceShake;
    }
    this.audio.setVolumes({ master: s.volumeMaster, sfx: s.volumeSfx, music: s.volumeMusic });
    this.audio.setMuted(s.muted);
    this.frameBudgetMs = s.fpsCap > 0 ? 1000 / s.fpsCap - 0.5 : 0;
    // resolução interna: automática pela qualidade, ou fração explícita da nativa (1 = nativa)
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const scaling = s.resolution > 0 ? 1 / (s.resolution * dpr) : s.quality === 'baixa' ? 1.6 : s.quality === 'media' ? 1.15 : 1 / dpr;
    this.engine.setHardwareScalingLevel(scaling);
    this.env?.setSimplified(s.quality === 'baixa');
    if (s.quality === 'baixa' || s.reduceFlashes || !s.postFx) {
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
    // a interface recolhe; a câmera sai do palco num sobrevoo até o spawn
    const from = this.rig.camera;
    this.cineFrom = { pos: from.position.clone(), rot: from.rotation.clone(), fov: from.fov };
    this.roundLoadAt = performance.now();
    this.cineAt = 0;
    {
      const { min, max } = this.map.bounds;
      this.flyA0 = Math.atan2(from.position.x - (min[0] + max[0]) / 2, from.position.z - (min[2] + max[2]) / 2);
    }
    this.stage.hide();
    stageStore.set({ tags: [], intro: false });
    this.replica.expectRound(roundId, contextTag);
    this.level.atlas.setAll(this.replica.state.owner);
    this.effects.clearAll();
    this.interp.clear();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.roundWinner = null;
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
    this.audio.stopAllLoops();
    this.wheelLoops.clear();
    this.remoteLoops.clear();
    this.chargeLoopOn = this.swimLoopOn = this.enemyLoopOn = this.dragLoopOn = false;
  }

  /** De volta ao lobby: some com os bonecos da rodada e o palco reaparece. */
  private backToLobby() {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.interp.clear();
    this.predictor?.dispose();
    this.predictor = null;
    this.lastSnapshot = null;
    this.cineFrom = null;
    this.roundLoadAt = 0;
    this.stage.show();
  }

  /* ------------------------------ palco do lobby ------------------------------ */

  setStagePlayers(players: StagePlayer[], myId: number) {
    this.stage.setPlayers(players, myId);
    stageStore.set({ hidden: [...this.stage.hidden] as [number, number] });
  }
  setStageMode(mode: StageMode) {
    this.stage.setMode(mode);
  }
  setStageFraming(f: StageFraming) {
    this.stage.framing = f;
  }
  rotateStage(delta: number) {
    this.stage.rotate(delta);
  }
  playIntro() {
    this.stage.playIntro();
    stageStore.set({ intro: true });
  }
  skipIntro() {
    this.stage.skipIntro();
    stageStore.set({ intro: false });
  }

  /**
   * Retratos do PRÓPRIO modelo 3D (cabeça e ombros), para as miniaturas de cabelo e
   * visual: cada aparência é montada longe do mapa, desenhada numa textura só com as
   * malhas dela e lida de volta como imagem. Nenhum desenho 2D à parte.
   */
  async portraits(appearances: AppearanceId[], team: TeamId, size = 112): Promise<string[]> {
    if (this.disposed) return [];
    const scene = this.scene;
    const Y = -240;
    // a projeção segue a proporção da tela: a textura tem a mesma proporção e o
    // retrato é o quadrado central (sem esticar em tela larga ou celular em pé)
    const aspect = this.engine.getAspectRatio(this.rig.camera);
    const rw = Math.round(aspect >= 1 ? size * aspect : size);
    const rh = Math.round(aspect >= 1 ? size : size / aspect);
    const rtt = new RenderTargetTexture('retrato', { width: rw, height: rh }, scene, false);
    rtt.clearColor = new Color4(0, 0, 0, 0);
    const cam = new FreeCamera('camera-retrato', new Vector3(0.44, Y + 1.58, 1.3), scene);
    cam.setTarget(new Vector3(0, Y + 1.42, 0));
    // FOV vertical; em tela em pé, abre para o quadrado central ter o mesmo enquadramento
    cam.fov = aspect >= 1 ? 0.62 : 2 * Math.atan(Math.tan(0.31) / aspect);
    cam.minZ = 0.05;
    rtt.activeCamera = cam;
    const colors = this.teamColors();
    const views = appearances.map((a, i) => {
      const v = new CharacterView(scene, 7000 + i, team, 'esguicho', colors[team], false, false, a);
      v.hideMarker();
      const vis: CharacterVisual = { pos: [0, Y, 0], yaw: 0, pitch: 0, speed: 0, vy: 0, grounded: true, form: 0, submerged: false, climbing: false, firing: false, charging: false, charge: 0, dragging: false, swinging: false, alive: true, protected: false, hp: 100, ink: 80, inEnemyInk: false, travel: 0 };
      v.camDist = 1.2;
      v.update(0.016, vis, Y, 1);
      v.root.setEnabled(false);
      return v;
    });
    const out: string[] = [];
    try {
      await scene.whenReadyAsync();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      for (const v of views) {
        if (this.disposed) break;
        v.root.setEnabled(true);
        for (const n of v.root.getDescendants(false)) (n as unknown as { computeWorldMatrix?: (f: boolean) => void }).computeWorldMatrix?.(true);
        rtt.renderList = v.root.getChildMeshes(false).filter((m) => m.isEnabled() && m.isVisible && !m.name.startsWith('sombra'));
        rtt.render();
        const px = (await rtt.readPixels()) as Uint8Array | null;
        v.root.setEnabled(false);
        if (!px) {
          out.push('');
          continue;
        }
        // WebGL devolve de baixo para cima; recorta o quadrado central
        const img = ctx.createImageData(size, size);
        const ox = Math.floor((rw - size) / 2);
        const oy = Math.floor((rh - size) / 2);
        for (let y = 0; y < size; y++) {
          const row = rh - 1 - (oy + y);
          img.data.set(px.subarray((row * rw + ox) * 4, (row * rw + ox + size) * 4), y * size * 4);
        }
        ctx.putImageData(img, 0, 0);
        out.push(canvas.toDataURL('image/png'));
      }
    } finally {
      for (const v of views) v.dispose();
      rtt.dispose();
      cam.dispose();
    }
    return out;
  }

  onPaintSnapshot(s: PaintSnapshotWire) {
    this.replica.receiveSnapshot(s);
  }

  onPaintDelta(d: PaintDeltaWire) {
    this.replica.receiveDelta(d);
  }

  /** Modo da rodada (vem do round.loading): liga cápsula/estações e o HUD do objetivo. */
  setMode(mode: GameModeId) {
    this.mode = mode;
    this.lastObj = null;
    this.myMode = { bf: null, bt: 0, mt: 0, mc: 0 };
    this.modeView.setSnapshot(undefined, undefined);
    hudStore.set({ mode, objective: null, buff: null, buffLeft: 0, mutirao: 0, mutiraoCooldown: 0 });
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
    if (phase === 'lobby' && prev !== 'lobby') this.backToLobby();
    if (phase === 'finishing' && prev !== 'finishing') {
      this.play('round_end');
      this.roundEndAt = performance.now();
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
    this.syncWheelAudio(m.ob);
    this.lastObj = m.obj ?? null;
    this.modeView.setSnapshot(m.obj, m.pk);
    if (m.me) this.myMode = { bf: m.me.bf ?? null, bt: m.me.bt ?? 0, mt: m.me.mt ?? 0, mc: m.me.mc ?? 0 };
    for (const e of m.ev) this.handleEvent(e);
  }

  private handleEvent(e: GameEvent) {
    const teamOf = (pid: number): TeamId => this.roster.get(pid)?.team ?? 0;
    switch (e.k) {
      case 'shot': {
        const kind = e.w === 'flick' ? 'shot_flick' : 'shot_esguicho';
        if (e.pid === this.myId) {
          // normalmente a previsão já soou; só um disparo que ela perdeu (quadro travado) soa aqui
          const gap = kind === 'shot_flick' ? 0.6 : 0.25;
          if (performance.now() - (this.lastLocalShotAt.get(kind) ?? -1e9) < gap * 1000) return;
          this.effects.shot(e.p, e.v, e.gd, e.g, e.life, teamOf(e.pid));
          this.play(kind, undefined, teamOf(e.pid), kind === 'shot_flick' ? 1 : 0.7);
          this.lastLocalShotAt.set(kind, performance.now());
          return;
        }
        this.effects.shot(e.p, e.v, e.gd, e.g, e.life, teamOf(e.pid));
        this.play(kind, e.p, teamOf(e.pid), 0.8);
        return;
      }
      case 'beam':
        if (e.pid !== this.myId) {
          this.effects.beam(e.from, e.to, e.team, e.charge);
          this.play('charge_release', e.from, e.team);
        } else if (performance.now() - this.lastLocalReleaseAt > 400) {
          // disparo próprio que a previsão não tocou (ex.: quadro travado e o servidor
          // soltou a carga): feixe e som vêm do evento autoritativo, uma única vez
          this.effects.beam(e.from, e.to, e.team, e.charge);
          this.play('charge_release', undefined, e.team);
          this.lastLocalReleaseAt = performance.now();
        }
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
          this.rumble('dano');
        }
        return;
      case 'elim': {
        const vp = this.lastPos.get(e.victim);
        if (vp) this.effects.elimination(vp, teamOf(e.victim));
        if (e.killer === this.myId) {
          this.play('elim_confirm');
          this.rumble('eliminou');
        }
        if (e.victim === this.myId) {
          this.play('death');
          this.rig.shake(0.18);
          this.rumble('eliminado');
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
      case 'buff': {
        const p = this.lastPos.get(e.pid);
        if (e.pid === this.myId) {
          this.tutorialCounters.buffs++;
          this.play('refill_done');
          this.hooks.onModeNotice?.(e.replaced ? `${BUFF_NAME[e.kind]} substituiu ${BUFF_NAME[e.replaced]}` : `${BUFF_NAME[e.kind]}!`, 'good');
        } else if (p) this.play('refill_done', p, teamOf(e.pid), 0.4);
        if (p) this.effects.respawn(p, teamOf(e.pid));
        return;
      }
      case 'buffEnd':
        if (e.pid === this.myId) this.hooks.onModeNotice?.(`${BUFF_NAME[e.kind]} acabou`, 'info');
        return;
      case 'pickupSpawn': {
        const pk = this.map.objectives.pickups[e.pickup];
        if (pk) this.play('ui_confirm', pk.pos, undefined, 0.5);
        return;
      }
      case 'mutirao': {
        this.effects.wave(e.p, e.team, 3);
        if (e.a === this.myId || e.b === this.myId) {
          this.play('special_ready');
          const other = this.hooks.playerName(e.a === this.myId ? e.b : e.a);
          this.hooks.onModeNotice?.(`Mutirão! com ${other}`, 'good');
          this.tutorialCounters.mutiroes++;
        }
        return;
      }
      case 'capsule': {
        const who = e.pid !== null ? this.hooks.playerName(e.pid) : null;
        const mine = e.team === this.myTeam;
        if (e.st === 'carregada' && who) {
          this.play('ui_confirm', undefined, undefined, 0.7);
          this.hooks.onModeNotice?.(e.pid === this.myId ? 'Você está com a cápsula: leve até a estação!' : `${who} pegou a cápsula`, mine ? 'good' : 'warn');
          if (e.pid === this.myId) this.tutorialCounters.capsules++;
        } else if (e.st === 'caida') this.hooks.onModeNotice?.('A cápsula caiu!', 'warn');
        else if (e.st === 'entregue' && who) {
          this.play(mine ? 'special_activate' : 'denied');
          this.hooks.onModeNotice?.(`Entrega de ${who}!`, mine ? 'good' : 'warn');
          if (e.pid === this.myId) this.tutorialCounters.deliveries++;
        } else if (e.st === 'retornando') this.hooks.onModeNotice?.('A cápsula voltou para o centro', 'info');
        return;
      }
      case 'respawn': {
        const p = this.lastPos.get(e.pid);
        if (p) this.effects.respawn(p, teamOf(e.pid));
        if (e.pid === this.myId) this.play('respawn');
        return;
      }
      case 'throw':
        // o próprio arremesso já soou na hora (intenção local / evento 'special')
        if (e.pid === this.myId) return;
        this.play(e.kind === 'wheel' ? 'special_activate' : 'throw', e.p, e.team);
        return;
      case 'burst':
        this.effects.burst(e.p, e.team, e.r);
        this.play('burst', e.p, e.team);
        if (this.predictor && dist3(this.predictor.state.pos, e.p) < 6) {
          this.rig.shake(0.1);
          this.rumble('moringa');
        }
        return;
      case 'wave':
        this.effects.wave(e.p, e.team, e.r);
        this.play('wave', e.p, e.team);
        return;
      case 'special':
        if (e.pid === this.myId) {
          this.tutorialCounters.specials++;
          this.play('special_activate');
          this.rumble('especial');
        }
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

  private play(id: SfxId, pos?: Vec3, team?: TeamId, volume?: number, delay = 0) {
    this.audio.play(id, { ...(pos ? { pos } : {}), ...(team !== undefined ? { team } : {}), ...(volume !== undefined ? { volume } : {}), delay });
  }
  /** Deslocamento do passo de previsão atual dentro do quadro (s). */
  private stepDelay = 0;

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
    const inRound = this.phase === 'countdown' || this.phase === 'running';
    const pred = this.predictor;
    this.input.consumeLook(dt, this.aimAssistStep(dt, inRound));

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
        // passos atrasados de um quadro lento soam espaçados pela cadência real
        this.stepDelay = (steps - 1) * TICK_DT;
        this.predClock += TICK_DT;
        this.localCosmetics(pred, res.intents, aim.dir);
      }
      this.stepDelay = 0;
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
      if (!this.debugView) {
        this.rig.update(dt, rp, this.input.yaw, this.input.pitch, s.form === FORM_FLOW);
        this.blendCine(dt);
      }
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
        carrier: this.lastObj?.c === this.myId,
        embalo: this.myMode.bf === 'embalo' && this.myMode.bt > 0,
        folego: this.myMode.bf === 'folego' && this.myMode.bt > 0,
        mutirao: this.myMode.mt > 0,
      }, dt);
      this.localAudio(pred);
      this.emptyTankAudio(pred, dt);
    } else if (!this.debugView) {
      if (this.stage.active) {
        this.stage.update(dt, this.rig.camera, this.engine.getAspectRatio(this.rig.camera), (p) => {
          const g = this.physics.raycast([p[0], p[1] + 0.3, p[2]], [0, -1, 0], 3);
          return g ? g.point[1] : null;
        });
        if (this.stage.introPlaying !== stageStore.get().intro) stageStore.set({ intro: this.stage.introPlaying });
      } else this.mapFlyover(now, dt);
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
        carrier: (f & PFLAG_CARRIER) !== 0,
        embalo: (f & PFLAG_EMBALO) !== 0,
        folego: (f & PFLAG_FOLEGO) !== 0,
        mutirao: (f & PFLAG_MUTIRAO) !== 0,
      };
      this.updateView(id, vis, dt);
      this.remoteCosmetics(id, vis, dt);
    }

    this.effects.cameraPos = [this.rig.camera.position.x, this.rig.camera.position.y, this.rig.camera.position.z];
    this.effects.update(dt);
    const modeActive = this.phase === 'countdown' || this.phase === 'running' || this.phase === 'finishing';
    this.modeView.update(
      dt,
      modeActive,
      (id) => {
        const v = this.views.get(id);
        return v ? [v.root.position.x, v.root.position.y, v.root.position.z] : null;
      },
      (id) => this.roster.get(id)?.team ?? null,
    );
    this.env.update(dt);
    this.level.setTime(now / 1000);
    this.level.flushTexture();
    const cp = this.rig.camera.position;
    const cf = this.rig.camera.getDirection(Vector3.Forward());
    this.audio.setListener([cp.x, cp.y, cp.z], [cf.x, cf.y, cf.z]);
    this.updateDomHud(dt);
    this.updateNameplates();
    this.publishStage(now);
    this.hudTimer += dt;
    if (this.hudTimer >= 1 / 15) {
      this.hudTimer = 0;
      this.publishHud();
    }
    if (this.visible) this.scene.render();
  }

  /**
   * Assistência de mira do controle (leve, configurável). Só considera
   * adversários que o jogador já vê: vivos, fora da tinta, sem proteção e com
   * linha de visão livre a partir da câmera.
   */
  private aimAssistStep(dt: number, inRound: boolean): AimAssistResult {
    const g = settingsStore.get().gamepad;
    const pred = this.predictor;
    if (!g.aimAssist || g.aimAssistStrength <= 0 || !inRound || this.phase !== 'running' || !pred || deviceStore.get().device !== 'controle') return NO_ASSIST;
    const s = pred.state;
    if (!s.alive || s.form !== 0 || s.travelPhase !== 0) return NO_ASSIST;
    const mag = this.input.padMagnitudes();
    const camPos = this.rig.position();
    const rTick = this.interp.renderTick(performance.now());
    const targets: AimTarget[] = [];
    for (const id of this.interp.ids()) {
      if (this.roster.get(id)?.team === this.myTeam) continue;
      const smp = this.interp.sample(id, rTick);
      if (!smp) continue;
      const f = smp.flags;
      if (!(f & PFLAG_ALIVE) || f & PFLAG_SUBMERGED || f & PFLAG_PROTECTED) continue;
      const c: Vec3 = [smp.pos[0], smp.pos[1] + MOVEMENT.combatHitHeight * 0.55, smp.pos[2]];
      const d: Vec3 = [c[0] - camPos[0], c[1] - camPos[1], c[2] - camPos[2]];
      const dist = Math.hypot(d[0], d[1], d[2]);
      if (dist > AIM_ASSIST_TUNING.range || dist < 0.5) continue;
      const dir: Vec3 = [d[0] / dist, d[1] / dist, d[2] / dist];
      const wall = this.physics.raycast(camPos, dir, dist - 0.4);
      if (wall) continue;
      targets.push({ yaw: yawFromDir(dir), pitch: pitchFromDir(dir), dist });
    }
    return aimAssist(this.input.yaw, this.input.pitch, targets, Math.max(mag.look, mag.move), g.aimAssistStrength, dt);
  }

  private rumbleGate = new RumbleGate();
  /** Vibração curta no controle, só quando ele é o dispositivo em uso. */
  private rumble(kind: RumbleKind) {
    const g = settingsStore.get().gamepad;
    if (!g.vibration || g.vibrationIntensity <= 0 || deviceStore.get().device !== 'controle' || !this.visible) return;
    if (!this.rumbleGate.allow(kind, performance.now())) return;
    const p = RUMBLE[kind];
    gamepadHub.rumble(p.ms, p.weak * g.vibrationIntensity, p.strong * g.vibrationIntensity);
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
      this.play('shot_esguicho', undefined, team, 0.7, this.stepDelay + i * w.fireInterval);
      // rajada contínua: vibra só no começo, nunca a cada gota. A pausa é medida no tempo
      // SIMULADO (passos previstos), não no relógio: um quadro travado não "reinicia" a rajada
      if (this.predClock - this.lastShotSimAt > 0.26) this.rumble('disparo');
      this.lastShotSimAt = this.predClock;
      this.lastLocalShotAt.set('shot_esguicho', performance.now());
    }
    if (intents.flick && w.kind === 'contact') {
      for (let i = 0; i < w.flickCount; i++) {
        const t = i / (w.flickCount - 1) - 0.5;
        const d = aimDirection(s.yaw + (t * w.flickSpreadDeg * 2 * Math.PI) / 180, Math.min(s.pitch, 0.25) - 0.12);
        this.effects.shot(muzzle, [d[0] * w.flickSpeed, d[1] * w.flickSpeed + w.flickUp, d[2] * w.flickSpeed], 0, w.flickGravity, w.flickLife, team);
      }
      this.play('shot_flick', undefined, team, undefined, this.stepDelay);
      this.rumble('disparo');
      this.lastLocalShotAt.set('shot_flick', performance.now());
    }
    if (intents.chargeRelease > 0) {
      const range = lerp(ESTILINGUE.minRange, ESTILINGUE.maxRange, intents.chargeRelease);
      const hit = this.physics.raycast(muzzle, dir, range);
      const end: Vec3 = hit ? hit.point : [muzzle[0] + dir[0] * range, muzzle[1] + dir[1] * range, muzzle[2] + dir[2] * range];
      this.effects.beam(muzzle, end, team, intents.chargeRelease);
      this.play('charge_release', undefined, team, undefined, this.stepDelay);
      this.rumble('disparo');
      this.lastLocalReleaseAt = performance.now();
      this.rig.shake(0.03);
    }
    if (intents.throwSecondary) {
      this.tutorialCounters.thrown++;
      this.play('throw');
      this.rumble('moringa');
    }
    if (intents.jumped) this.play('jump', undefined, team, 0.8, this.stepDelay);
  }

  /** Tanque vazio: ao apertar o disparo sem pigmento (e, segurando, a cada 1,2 s). */
  private emptyTankAudio(pred: LocalPredictor, dt: number) {
    const s = pred.state;
    const w = WEAPONS[pred.weaponId];
    const cost = w.kind === 'automatic' ? w.inkCost : w.kind === 'contact' ? w.flickCost : w.minCost;
    const trying = (this.input.buttons() & Buttons.FIRE) !== 0 && s.alive && s.form === 0 && s.ink < cost;
    if (!trying) {
      this.emptyTimer = 0;
      return;
    }
    this.emptyTimer -= dt;
    if (this.emptyTimer <= 0) {
      this.play('ink_empty');
      this.emptyTimer = 1.2;
    }
  }
  private emptyTimer = 0;

  /** Passos e aterrissagens pela animação (o som cai quando o pé apoia). */
  private footAudio(id: number, view: CharacterView, v: CharacterVisual) {
    const { step, landed } = view.foot;
    if (!step && landed < 0.25) return;
    const me = id === this.myId;
    const cp = this.rig.camera.position;
    // passos de outros só por perto: informam aproximação sem competir com o combate
    if (!me && Math.hypot(v.pos[0] - cp.x, v.pos[1] - cp.y, v.pos[2] - cp.z) > 15) return;
    const kind = this.surfaceStep(v.pos);
    const pos = me ? undefined : v.pos;
    if (landed >= 0.25) {
      const hard = Math.min(1.2, 0.6 + landed * 0.8);
      if (me && landed >= 0.6) this.rumble('aterrissagem');
      if (kind === 'step_ink') this.play('step_ink', pos, undefined, hard * 1.3);
      else this.play('land', pos, undefined, hard);
    } else this.play(kind, pos, undefined, me ? 0.8 : 0.65);
  }

  private surfaceStep(p: Vec3): 'step_stone' | 'step_wood' | 'step_ink' {
    const hit = this.layout.floorAt([p[0], p[1] + 0.05, p[2]], 0.35, 0.2);
    if (!hit) return 'step_stone';
    if (this.replica.state.owner[hit.cell] >= 0) return 'step_ink';
    return this.blockMaterial.get(hit.surface.blockId) === 'madeira' ? 'step_wood' : 'step_stone';
  }
  private blockMaterialCache: Map<string, string> | null = null;
  private get blockMaterial(): Map<string, string> {
    if (!this.blockMaterialCache) this.blockMaterialCache = new Map(this.map.blocks.map((b) => [b.id, b.material]));
    return this.blockMaterialCache;
  }

  /** Zumbido posicional da Roda de Oleiro enquanto ela gira no chão. */
  private wheelLoops = new Set<number>();
  private syncWheelAudio(list: SnapshotMessage['ob']) {
    const seen = new Set<number>();
    const inRound = this.phase === 'countdown' || this.phase === 'running';
    for (const o of list) {
      if (o.kind !== 'wheel' || !inRound) continue;
      seen.add(o.id);
      this.wheelLoops.add(o.id);
      this.audio.setLoop(`roda-${o.id}`, 'wheel_hum', true, { pos: o.p });
    }
    for (const id of this.wheelLoops)
      if (!seen.has(id)) {
        this.audio.setLoop(`roda-${id}`, 'wheel_hum', false);
        this.wheelLoops.delete(id);
      }
  }

  private chargeLoopOn = false;
  private lastLocalReleaseAt = -1e9;
  private lastLocalShotAt = new Map<string, number>();
  private dragLoopOn = false;
  private remoteLoops = new Set<string>();
  private swimLoopOn = false;
  private enemyLoopOn = false;
  private lastForm = 0;

  private localAudio(pred: LocalPredictor) {
    const s = pred.state;
    // só durante a rodada: no resultado/lobby nenhum loop ou aviso local volta a tocar
    if (this.phase !== 'countdown' && this.phase !== 'running') {
      if (this.swimLoopOn || this.chargeLoopOn || this.enemyLoopOn || this.dragLoopOn) {
        for (const k of ['swim', 'charge', 'enemy_ink', 'rodo']) this.audio.setLoop(k, 'swim', false);
        this.swimLoopOn = this.chargeLoopOn = this.enemyLoopOn = this.dragLoopOn = false;
      }
      this.lastForm = s.form;
      this.prevInk = s.ink;
      this.prevSpecial = s.special;
      return;
    }
    if (s.form !== this.lastForm) {
      this.play(s.form === FORM_FLOW ? 'transform_in' : 'transform_out');
      this.lastForm = s.form;
    }
    const swim = s.submerged && Math.hypot(s.vel[0], s.vel[2]) > 0.5;
    if (swim !== this.swimLoopOn || swim) this.audio.setLoop('swim', 'swim', swim, { param: Math.min(1, Math.hypot(s.vel[0], s.vel[2]) / 8) });
    this.swimLoopOn = swim;
    if (s.charging !== this.chargeLoopOn || s.charging) this.audio.setLoop('charge', 'charge', s.charging, { param: s.charge });
    this.chargeLoopOn = s.charging;
    const drag = s.dragging && Math.hypot(s.vel[0], s.vel[2]) > 1;
    if (drag !== this.dragLoopOn || drag) this.audio.setLoop('rodo', 'rodo_drag', drag, { param: Math.min(1, Math.hypot(s.vel[0], s.vel[2]) / 4.4) });
    this.dragLoopOn = drag;
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

  /** Loop posicional de outro jogador (liga/desliga sem repetir nem vazar). */
  private remoteLoop(key: string, id: 'charge' | 'rodo_drag', want: boolean, pos: Vec3, param = 0) {
    // fora da rodada (resultado, lobby) nenhum loop do mundo volta a tocar
    const on = want && (this.phase === 'countdown' || this.phase === 'running');
    if (!on && !this.remoteLoops.has(key)) return;
    this.audio.setLoop(key, id, on, { pos: [pos[0], pos[1] + 1, pos[2]], param });
    if (on) this.remoteLoops.add(key);
    else this.remoteLoops.delete(key);
  }

  /** Fim da rodada: vitória, derrota ou empate do ponto de vista da turma local, depois do sino. */
  playRoundResult(roundId: number, winner: TeamId | 'draw') {
    this.roundWinner = winner;
    if (roundId === this.resultSoundRound) return;
    this.resultSoundRound = roundId;
    const wait = Math.max(0, 1100 - (performance.now() - this.roundEndAt));
    const id: SfxId = winner === 'draw' ? 'draw' : winner === this.myTeam ? 'victory' : 'defeat';
    this.resultTimer = setTimeout(() => {
      this.resultTimer = null;
      if (!this.disposed) this.play(id);
    }, wait);
  }
  private resultSoundRound = -1;
  private roundWinner: TeamId | 'draw' | null = null;
  private roundEndAt = 0;
  private resultTimer: ReturnType<typeof setTimeout> | null = null;

  private remoteCosmetics(id: number, v: CharacterVisual, dt: number) {
    const team = this.roster.get(id)?.team ?? 0;
    if (!v.alive) {
      this.remoteLoop(`carga-${id}`, 'charge', false, v.pos);
      this.remoteLoop(`rodo-${id}`, 'rodo_drag', false, v.pos);
      return;
    }
    if (v.charging) {
      const probe = { pos: v.pos, yaw: v.yaw } as unknown as Parameters<typeof muzzlePosition>[0];
      const m = muzzlePosition(probe);
      const d = aimDirection(v.yaw, v.pitch);
      this.effects.laser(id, new Vector3(...m), new Vector3(...d), lerp(ESTILINGUE.minRange, ESTILINGUE.maxRange, v.charge), team, v.charge);
    }
    if (v.dragging && v.speed > 1) this.dragSpray(v.pos, v.yaw, team);
    this.remoteLoop(`carga-${id}`, 'charge', v.charging, v.pos);
    this.remoteLoop(`rodo-${id}`, 'rodo_drag', v.dragging && v.speed > 1, v.pos, Math.min(1, v.speed / 4.4));
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
      view = new CharacterView(this.scene, id, info.team, info.weaponId, colors[info.team], id === this.myId, info.team !== this.myTeam, info.appearance);
      this.views.set(id, view);
    }
    const ground = this.physics.raycast([v.pos[0], v.pos[1] + 0.3, v.pos[2]], [0, -1, 0], 8);
    const cp = this.rig.camera.position;
    const camDist = Math.hypot(v.pos[0] - cp.x, v.pos[1] + 0.8 - cp.y, v.pos[2] - cp.z);
    view.nearFade = Math.min(1, Math.max(0.2, (camDist - 0.9) / 0.9));
    view.camDist = camDist;
    // fim da rodada: quem venceu comemora, quem perdeu murcha (empate: nada)
    if (this.phase === 'finishing' && this.roundWinner !== null && this.roundWinner !== 'draw' && info) v.celebrate = info.team === this.roundWinner ? 1 : -1;
    view.update(dt, v, ground ? ground.point[1] : null, this.sunAt(v.pos));
    this.footAudio(id, view, v);
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

  private plates = new Map<number, { el: HTMLDivElement; name: HTMLSpanElement; name0: string }>();
  private losCache = new Map<number, { at: number; ok: boolean }>();

  /** Nomes sobre os personagens (DOM projetado), com indicador discreto de fala. */
  private updateNameplates() {
    const root = hudDom.nameplates;
    if (!root) return;
    const now = performance.now();
    const seen = new Set<number>();
    if (this.visible && (this.phase === 'running' || this.phase === 'countdown')) {
      const c = this.rig.camera.position;
      const cam: Vec3 = [c.x, c.y, c.z];
      const rTick = this.interp.renderTick(now);
      for (const id of this.interp.ids()) {
        const lp = this.roster.get(id);
        if (id === this.myId || !lp) continue;
        const smp = this.interp.sample(id, rTick);
        if (!smp) continue;
        const ally = lp.team === this.myTeam;
        const head: Vec3 = [smp.pos[0], smp.pos[1] + (smp.form === FORM_FLOW ? 1.0 : 2.15), smp.pos[2]];
        const d = dist3(cam, head);
        let los = true;
        if (!ally) {
          // linha de visão só para adversários, no máximo 10x por segundo cada
          const cached = this.losCache.get(id);
          if (!cached || now - cached.at > 100) {
            const dir: Vec3 = [(head[0] - cam[0]) / d, (head[1] - cam[1]) / d, (head[2] - cam[2]) / d];
            los = !this.physics.raycast(cam, dir, Math.max(0.1, d - 0.35));
            this.losCache.set(id, { at: now, ok: los });
          } else los = cached.ok;
        }
        if (!nameplateVisible({ ally, alive: (smp.flags & PFLAG_ALIVE) !== 0, submerged: (smp.flags & PFLAG_SUBMERGED) !== 0, dist: d, los })) continue;
        const sp = this.projectToScreen(head);
        if (!sp) continue;
        seen.add(id);
        let pl = this.plates.get(id);
        if (!pl) {
          const el = document.createElement('div');
          el.className = 'nameplate';
          const dot = document.createElement('span');
          dot.className = 'np-voice';
          dot.setAttribute('aria-hidden', 'true');
          const name = document.createElement('span');
          name.className = 'np-name';
          el.append(dot, name);
          root.appendChild(el);
          pl = { el, name, name0: '' };
          this.plates.set(id, pl);
        }
        // sempre texto: textContent nunca interpreta marcação
        if (pl.name0 !== lp.displayName) {
          pl.name.textContent = lp.displayName;
          pl.name0 = lp.displayName;
        }
        pl.el.classList.toggle('enemy', !ally);
        const speaking = lp.userId ? !!this.hooks.voiceOf(lp.userId)?.speaking : false;
        pl.el.classList.toggle('speaking', speaking);
        pl.el.dataset.speaking = speaking ? 'true' : 'false';
        pl.el.dataset.player = String(id);
        pl.el.style.color = `var(--team${lp.team})`;
        pl.el.style.opacity = String(Math.max(0.35, Math.min(1, 1.25 - d / (ally ? NAMEPLATE.allyRange : NAMEPLATE.enemyRange))));
        pl.el.style.transform = `translate(${sp[0].toFixed(1)}px, ${sp[1].toFixed(1)}px) translate(-50%, -100%)`;
        pl.el.style.display = '';
      }
    }
    for (const [id, pl] of this.plates) {
      if (seen.has(id)) continue;
      if (!this.roster.has(id)) {
        pl.el.remove();
        this.plates.delete(id);
        this.losCache.delete(id);
      } else pl.el.style.display = 'none';
    }
  }

  private publishStage(now: number) {
    if (!this.stage.active || now - this.stagePubAt < 50) return;
    this.stagePubAt = now;
    stageStore.set({ tags: this.stage.tags((p) => this.projectToScreen(p), this.rig.camera) });
  }

  /**
   * Sobrevoo do mapa enquanto a rodada carrega: órbita alta que desce em direção ao
   * centro disputado, continuando de onde a câmera do palco estava.
   */
  private mapFlyover(now: number, dt: number) {
    const cam = this.rig.camera;
    const { min, max } = this.map.bounds;
    const mc = new Vector3((min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2);
    const half = Math.max(max[0] - min[0], max[2] - min[2]) / 2;
    if (!this.roundLoadAt) {
      // sem rodada nem palco (resultado antigo, espera): órbita lenta de apresentação
      const t = now * 0.00005;
      cam.position.set(mc.x + Math.cos(t) * half * 0.95, 16, mc.z + Math.sin(t) * half * 0.65);
      cam.setTarget(new Vector3(mc.x, 1, mc.z));
      cam.fov += ((56 * Math.PI) / 180 - cam.fov) * Math.min(1, dt * 2);
      return;
    }
    const t = (now - this.roundLoadAt) / 1000;
    const a = this.flyA0 + t * 0.22;
    const R = half * (0.95 - Math.min(0.35, t * 0.06));
    const h = 17 - Math.min(6, t * 1.2);
    const want = new Vector3(mc.x + Math.sin(a) * R, h, mc.z + Math.cos(a) * R);
    // sai do palco com suavidade e depois acompanha a órbita
    const k = t < 1.5 ? 1 - Math.exp(-dt * (1.5 + t * 3)) : 1;
    cam.position = Vector3.Lerp(cam.position, want, k);
    cam.setTarget(new Vector3(mc.x, 1, mc.z));
    cam.fov += ((56 * Math.PI) / 180 - cam.fov) * Math.min(1, dt * 2);
    // a mistura com a câmera do ombro parte da última pose do sobrevoo
    this.cineFrom = { pos: cam.position.clone(), rot: cam.rotation.clone(), fov: cam.fov };
    this.cineAt = 0;
  }

  /** Mistura a câmera cinematográfica com a do ombro no começo da contagem (~1,4 s). */
  private blendCine(dt: number) {
    if (!this.cineFrom) return;
    const T = 1.4;
    this.cineAt += dt;
    const k = Math.min(1, this.cineAt / T);
    const e = k * k * (3 - 2 * k);
    const cam = this.rig.camera;
    // a pose da última câmera do sobrevoo acompanha o fim da órbita
    cam.position = Vector3.Lerp(this.cineFrom.pos, cam.position, e);
    const r0 = this.cineFrom.rot;
    const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    cam.rotation.set(r0.x + wrap(cam.rotation.x - r0.x) * e, r0.y + wrap(cam.rotation.y - r0.y) * e, 0);
    const fov = (settingsStore.get().fov * Math.PI) / 180;
    cam.fov = this.cineFrom.fov + (fov - this.cineFrom.fov) * e;
    if (k >= 1) this.cineFrom = null;
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

  /** Contadores do próprio jogador para o treino rápido. */
  private tutorialCounters = { thrown: 0, specials: 0, mutiroes: 0, capsules: 0, deliveries: 0, buffs: 0 };

  private publishHud() {
    const pred = this.predictor;
    const s = pred?.state;
    if (s && this.phase === 'running') {
      tutorialTick(
        {
          pos: s.pos,
          yaw: this.input.yaw,
          pitch: this.input.pitch,
          ink: s.ink,
          form: s.form,
          submerged: s.submerged,
          firing: (this.input.buttons() & Buttons.FIRE) !== 0,
          alive: s.alive,
          mapOpen: this.input.mapOpen,
          thrown: this.tutorialCounters.thrown,
          specials: this.tutorialCounters.specials,
          buffs: this.tutorialCounters.buffs,
          mutiroes: this.tutorialCounters.mutiroes,
          capsules: this.tutorialCounters.capsules,
          deliveries: this.tutorialCounters.deliveries,
          mode: this.mode,
        },
        1 / 15,
      );
    }
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
          speaking: p.userId ? !!this.hooks.voiceOf(p.userId)?.speaking : false,
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
      mode: this.mode,
      buff: this.myMode.bt > 0 ? this.myMode.bf : null,
      buffLeft: this.myMode.bt,
      mutirao: this.myMode.mt,
      mutiraoCooldown: this.myMode.mc,
      objective: this.objectiveHud(s?.pos ?? null),
    });
    void w;
  }

  private objectiveHud(me: Vec3 | null): HudState['objective'] {
    const o = this.lastObj;
    if (!o || this.mode !== 'correio') return null;
    const st = this.map.objectives.stations[o.s];
    let bearing = 0,
      distance = 0;
    if (me && st) {
      const dx = st[0] - me[0],
        dz = st[2] - me[2];
      distance = Math.hypot(dx, dz);
      const cam = this.rig.camera;
      const fwd = cam.getDirection(new Vector3(0, 0, 1));
      const a = Math.atan2(dx, dz) - Math.atan2(fwd.x, fwd.z);
      bearing = (((a * 180) / Math.PI + 540) % 360) - 180;
    }
    const carrier = o.c !== null ? { id: o.c, name: this.hooks.playerName(o.c), team: this.roster.get(o.c)?.team ?? 0 } : null;
    return { state: o.st, carrier, iCarry: o.c === this.myId, station: o.s, stationShare: o.sp, progress: o.pr, deliveries: o.d, timer: o.t, stationBearing: bearing, stationDistance: distance };
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

  /** Libera GPU, cena, física e entrada. `keepAudio` preserva o motor de áudio para o próximo mapa. */
  dispose(keepAudio = false) {
    if (this.disposed) return;
    this.disposed = true;
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.settingsUnsub();
    this.resizeObs.disconnect();
    this.engine.stopRenderLoop();
    this.input.dispose();
    for (const pl of this.plates.values()) pl.el.remove();
    this.plates.clear();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.roundWinner = null;
    this.predictor?.dispose();
    this.effects?.dispose();
    this.modeView?.dispose();
    this.stage?.dispose();
    stageStore.set({ tags: [], intro: false });
    this.env?.dispose();
    this.level?.dispose();
    this.pipeline?.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.physics?.dispose();
    if (keepAudio) {
      this.audio.stopMusic(0);
      for (const k of this.remoteLoops) this.audio.setLoop(k, 'charge', false, { pos: [0, 0, 0] });
    } else void this.audio.dispose();
    hudStore.set({ active: false });
  }
}

function dist3(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
