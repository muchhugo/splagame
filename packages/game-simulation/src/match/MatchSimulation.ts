import type { GameEvent, GameModeId, ObjectiveSnapshot, PickupSnapshot, PlayerInput, PlayerRoundStats, RoundResult, TeamId, Vec3, WeaponId } from '@borrifo/game-contracts';
import { FORM_FLOW, GROUND_ENEMY, INPUT_QUEUE_MAX, INPUT_STALE_TICKS, TICK_DT, neutralInput, otherTeam, Buttons } from '@borrifo/game-contracts';
import type { ChargeWeaponDefinition, ContactWeaponDefinition, AutomaticWeaponDefinition, MapSpec } from '@borrifo/game-content';
import { HEALTH, MODES, MORINGA, MOVEMENT, PIAO_GUIA, RODA_DE_OLEIRO, WEAPONS } from '@borrifo/game-content';
import { BuffPickups, CorreioMode, MutiraoTracker, applyModifiers, freshModeState, type ModeHost } from './modes';
import { add, addScaled, aimDirection, clamp, dist, forwardFromYaw, lerp, normalize, rightFromYaw, Rng, segmentCapsuleHit, sub } from '../math';
import type { PaintLayout } from '../paint/PaintLayout';
import { PaintState, type PaintChangeSink } from '../paint/PaintState';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createPlayerState, type PlayerSimState } from '../player/PlayerState';
import { stepPlayer, type StepContext } from '../player/stepPlayer';
import type { AddressedEvent, MoringaObject, Projectile, SimPlayer, WheelObject, WorldObject } from './types';

export type SimPhase = 'countdown' | 'running' | 'finished';

export interface MatchSimulationOptions {
  map: MapSpec;
  layout: PaintLayout;
  physics: PhysicsWorld;
  matchId: string;
  roundId: number;
  contextTag: number;
  seed: number;
  durationSeconds: number;
  countdownSeconds: number;
  /** Modo da rodada (padrão: território). */
  mode?: GameModeId;
}

/** Posição do cano da ferramenta a partir do estado do personagem. */
export function muzzlePosition(s: PlayerSimState): Vec3 {
  const f = forwardFromYaw(s.yaw);
  const r = rightFromYaw(s.yaw);
  const T = MOVEMENT;
  return [
    s.pos[0] + f[0] * T.muzzleForward + r[0] * T.muzzleRight,
    s.pos[1] + T.muzzleHeight,
    s.pos[2] + f[2] * T.muzzleForward + r[2] * T.muzzleRight,
  ];
}

export function hitHeight(s: PlayerSimState): number {
  return s.form === FORM_FLOW && s.formTimer <= 0 ? MOVEMENT.flowHitHeight : MOVEMENT.combatHitHeight;
}

/**
 * Simulação autoritativa de uma rodada. Sem DOM, sem renderer: roda no servidor
 * de partidas e nos testes. Ordem determinística por tick:
 * 1) jogadores por id crescente (entrada → movimento → intenções);
 * 2) regras de vida/tinta/proteção; 3) projéteis por id; 4) objetos por id;
 * 5) reaparecimentos; 6) cronômetro. A última aplicação de tinta no tick vence.
 */
export class MatchSimulation {
  readonly paint: PaintState;
  readonly players = new Map<number, SimPlayer>();
  readonly projectiles: Projectile[] = [];
  readonly objects: WorldObject[] = [];
  tick = 0;
  phase: SimPhase = 'countdown';
  readonly startTick: number;
  readonly endTick: number;
  private rng: Rng;
  private nextId = 1;
  private events: AddressedEvent[] = [];
  private result: RoundResult | null = null;
  private finishCount = 0;
  readonly mode: GameModeId;
  readonly correio: CorreioMode | null = null;
  readonly pickups: BuffPickups | null = null;
  readonly mutirao: MutiraoTracker | null = null;

  constructor(readonly opts: MatchSimulationOptions) {
    this.paint = new PaintState(opts.layout);
    this.paint.reset(opts.roundId, opts.contextTag);
    this.paint.setTracking(true);
    this.rng = new Rng(opts.seed);
    this.startTick = Math.round(opts.countdownSeconds / TICK_DT);
    this.endTick = this.startTick + Math.round(opts.durationSeconds / TICK_DT);
    this.mode = opts.mode ?? 'territorio';
    const def = MODES[this.mode];
    const self = this;
    const host: ModeHost = {
      get tick() {
        return self.tick;
      },
      players: this.players,
      layout: opts.layout,
      paint: this.paint,
      physics: opts.physics,
      map: opts.map,
      emit: (ev, to) => this.emit(ev, to),
    };
    if (def.objective) this.correio = new CorreioMode(host, this.startTick);
    if (def.buffs && opts.map.objectives.pickups.length) this.pickups = new BuffPickups(host, this.startTick);
    if (def.mutirao) this.mutirao = new MutiraoTracker(host);
  }

  get layout(): PaintLayout {
    return this.opts.layout;
  }
  get physics(): PhysicsWorld {
    return this.opts.physics;
  }
  get finished(): boolean {
    return this.phase === 'finished';
  }
  /** ms restantes da fase atual. */
  get phaseRemainingMs(): number {
    if (this.phase === 'countdown') return Math.max(0, (this.startTick - this.tick) * TICK_DT * 1000);
    if (this.phase === 'running') return Math.max(0, (this.endTick - this.tick) * TICK_DT * 1000);
    return 0;
  }

  /* ---------------------------- jogadores ---------------------------- */

  addPlayer(id: number, name: string, team: TeamId, weaponId: WeaponId, isBot: boolean): SimPlayer {
    const spawn = this.pickSpawn(team);
    const state = createPlayerState(spawn.pos, spawn.yaw);
    state.spawnProtect = HEALTH.spawnProtection;
    const p: SimPlayer = {
      id,
      name,
      team,
      weaponId,
      isBot,
      state,
      body: this.physics.createCharacter(MOVEMENT),
      inputQueue: [],
      lastInput: neutralInput(0, spawn.yaw, 0),
      staleTicks: 0,
      lastProcessedSeq: 0,
      inputDebt: 0,
      hpRegenDelay: 0,
      stats: { paintedUnits: 0, eliminations: 0, deaths: 0, specialsUsed: 0 },
      contactCooldowns: new Map(),
      bot: null,
      lastDamagedBy: null,
      travel: null,
      mode: freshModeState(),
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    this.correio?.drop(id);
    p.body.dispose();
    this.players.delete(id);
  }

  /** Enfileira uma entrada já saneada. Sequências antigas/duplicadas são descartadas. */
  enqueueInput(id: number, input: PlayerInput): 'queued' | 'stale' | 'unknown' {
    const p = this.players.get(id);
    if (!p) return 'unknown';
    const lastQueued = p.inputQueue.length ? p.inputQueue[p.inputQueue.length - 1].sequence : p.lastProcessedSeq;
    if (input.sequence <= lastQueued) return 'stale';
    p.inputQueue.push(input);
    // Fila limitada: excesso descarta as mais antigas (impede "speedhack" por rajada).
    while (p.inputQueue.length > INPUT_QUEUE_MAX) p.inputQueue.shift();
    return 'queued';
  }

  drainEvents(): AddressedEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private emit(ev: GameEvent, to?: number) {
    this.events.push(to === undefined ? { ev } : { ev, to });
  }

  private pickSpawn(team: TeamId): { pos: Vec3; yaw: number } {
    const pts = this.opts.map.spawns[team];
    const order = pts.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const i of order) {
      const sp = pts[i];
      let free = true;
      for (const p of this.players.values()) {
        if (p.state.alive && dist(p.state.pos, sp.pos) < 0.9) free = false;
      }
      if (free) return { pos: [...sp.pos] as Vec3, yaw: sp.yaw };
    }
    const sp = pts[order[0]];
    return { pos: [sp.pos[0] + this.rng.range(-0.6, 0.6), sp.pos[1], sp.pos[2] + this.rng.range(-0.6, 0.6)], yaw: sp.yaw };
  }

  /* ------------------------------ tick ------------------------------ */

  step(): void {
    if (this.phase === 'finished') return;
    this.tick++;
    if (this.phase === 'countdown') {
      // Durante a contagem: entradas são consumidas mas o personagem não se move.
      for (const p of this.sortedPlayers()) {
        const inp = this.takeInput(p);
        p.state.yaw = inp.yaw;
        p.state.pitch = inp.pitch;
      }
      if (this.tick >= this.startTick) this.phase = 'running';
      return;
    }

    const dt = TICK_DT;
    for (const p of this.sortedPlayers()) this.stepOnePlayer(p, dt);
    this.stepProjectiles(dt);
    this.stepObjects(dt);
    this.stepModes();
    for (const p of this.sortedPlayers()) this.stepRespawn(p, dt);
    if (this.tick >= this.endTick || this.correio?.decided != null) this.finish('completed');
  }

  /** Buffs, Mutirão e Correio: temporizadores, coleta, combo e cápsula; modificadores do próximo tick. */
  private stepModes() {
    const st = (p: SimPlayer) => p.mode;
    for (const p of this.players.values()) {
      const m = p.mode;
      if (m.buffTicks > 0 && --m.buffTicks === 0 && m.buff) {
        this.emit({ k: 'buffEnd', pid: p.id, kind: m.buff });
        m.buff = null;
      }
      if (m.mutiraoTicks > 0) m.mutiraoTicks--;
      if (m.mutiraoCooldownTicks > 0) m.mutiraoCooldownTicks--;
    }
    this.pickups?.step(st);
    this.mutirao?.step(st);
    this.correio?.step(st);
    for (const p of this.players.values()) applyModifiers(p, p.mode);
  }

  /** Portador desconectou (servidor): a cápsula cai; o slot segue na rodada. */
  dropObjective(id: number) {
    this.correio?.drop(id);
  }

  objectiveSnapshot(): ObjectiveSnapshot | undefined {
    return this.correio?.snapshot();
  }

  pickupSnapshot(): PickupSnapshot[] | undefined {
    return this.pickups?.snapshot();
  }

  isCarrier(id: number): boolean {
    return this.correio?.isCarrier(id) ?? false;
  }

  private sortedPlayers(): SimPlayer[] {
    return [...this.players.values()].sort((a, b) => a.id - b.id);
  }

  private takeInput(p: SimPlayer): PlayerInput {
    if (p.bot) {
      const inp = p.bot.think(p, this);
      p.lastInput = inp;
      return inp;
    }
    // "Dívida" de ticks extrapolados: se o servidor repetiu a última entrada por
    // falta de pacote e depois chegam várias atrasadas, descarta o movimento das
    // excedentes (preservando as ações discretas). Assim o total de passos
    // simulados acompanha o total de entradas do cliente, sem ganho de velocidade.
    while (p.inputDebt > 0 && p.inputQueue.length > 1) {
      const dropped = p.inputQueue.shift()!;
      p.inputQueue[0] = { ...p.inputQueue[0], pressedActions: [...dropped.pressedActions, ...p.inputQueue[0].pressedActions].slice(-4) };
      p.lastProcessedSeq = dropped.sequence;
      p.inputDebt--;
    }
    const next = p.inputQueue.shift();
    if (next) {
      p.lastInput = next;
      p.lastProcessedSeq = next.sequence;
      p.staleTicks = 0;
      return next;
    }
    // Sem entrada nova: repete o movimento por poucos ticks; depois neutraliza.
    p.staleTicks++;
    const last = p.lastInput;
    if (p.staleTicks > INPUT_STALE_TICKS) return { ...neutralInput(last.sequence, last.yaw, last.pitch), heldButtons: last.heldButtons & Buttons.FLOW };
    p.inputDebt = Math.min(INPUT_STALE_TICKS, p.inputDebt + 1);
    return { ...last, pressedActions: [] };
  }

  private stepCtx(p: SimPlayer): StepContext {
    return {
      body: p.body,
      physics: this.physics,
      paint: { layout: this.layout, owner: this.paint.owner },
      team: p.team,
      weapon: WEAPONS[p.weaponId],
      tuning: MOVEMENT,
    };
  }

  private stepOnePlayer(p: SimPlayer, dt: number) {
    const s = p.state;
    const input = this.takeInput(p);
    if (s.travelPhase !== 0) {
      this.stepTravel(p, dt);
      return;
    }
    const intents = stepPlayer(s, input, dt, this.stepCtx(p));
    for (const d of intents.denied) this.emit({ k: 'denied', reason: d }, p.id);
    if (!s.alive) return;

    const fired = intents.shots > 0 || intents.flick || intents.chargeRelease > 0 || intents.throwSecondary || (intents.dragging && Math.hypot(s.vel[0], s.vel[2]) > 1);
    if (fired && s.spawnProtect > 0) s.spawnProtect = 0; // disparar encerra a proteção

    const w = WEAPONS[p.weaponId];
    for (let i = 0; i < intents.shots; i++) this.fireAutomatic(p, w as AutomaticWeaponDefinition);
    if (intents.flick) this.fireFlick(p, w as ContactWeaponDefinition);
    if (intents.dragging) this.applyDrag(p, w as ContactWeaponDefinition);
    if (intents.chargeRelease > 0) this.fireCharge(p, w as ChargeWeaponDefinition, intents.chargeRelease);
    if (intents.throwSecondary) this.throwMoringa(p);
    if (intents.specialRequested) this.tryActivateSpecial(p);
    if (intents.travelTarget >= 0) this.tryStartTravel(p, intents.travelTarget);

    // proteção de reaparecimento: termina por tempo ou ao sair da área segura (não renova)
    if (s.spawnProtect > 0) {
      s.spawnProtect = Math.max(0, s.spawnProtect - dt);
      const z = this.opts.map.spawnZones[p.team];
      const inside = s.pos[0] >= z.min[0] && s.pos[0] <= z.max[0] && s.pos[1] >= z.min[1] && s.pos[1] <= z.max[1] && s.pos[2] >= z.min[2] && s.pos[2] <= z.max[2];
      if (!inside) s.spawnProtect = 0;
    }

    // tinta inimiga: dano ambiental gradual, não letal (piso configurável)
    if (s.groundState === GROUND_ENEMY && s.grounded && s.spawnProtect <= 0) {
      if (s.hp > HEALTH.enemyInkFloor) s.hp = Math.max(HEALTH.enemyInkFloor, s.hp - HEALTH.enemyInkDps * dt);
      p.hpRegenDelay = Math.max(p.hpRegenDelay, 0.3);
    } else {
      p.hpRegenDelay = Math.max(0, p.hpRegenDelay - dt);
      if (p.hpRegenDelay <= 0 && s.hp < HEALTH.maxHp) s.hp = Math.min(HEALTH.maxHp, s.hp + HEALTH.regenRate * dt);
    }
    // limite do mapa (salvaguarda): volta ao spawn sem contar eliminação
    if (s.pos[1] < this.opts.map.killY) this.respawnNow(p);
  }

  /* --------------------------- disparos --------------------------- */

  /** Origem efetiva do disparo: se o cano estiver atrás de uma parede, recua até ela. */
  private safeMuzzle(s: PlayerSimState): Vec3 {
    const m = muzzlePosition(s);
    const chest: Vec3 = [s.pos[0], s.pos[1] + MOVEMENT.muzzleHeight, s.pos[2]];
    const d = sub(m, chest);
    const L = Math.hypot(d[0], d[1], d[2]);
    const hit = this.physics.raycast(chest, [d[0] / L, d[1] / L, d[2] / L], L);
    if (hit) return addScaled(chest, d, Math.max(0, hit.toi - 0.06) / L);
    return m;
  }

  private spread(dir: Vec3, deg: number): Vec3 {
    const a = (deg * Math.PI) / 180;
    const yaw = Math.atan2(dir[0], dir[2]) + this.rng.gauss() * a * 0.5;
    const pitch = -Math.asin(clamp(dir[1], -1, 1)) + this.rng.gauss() * a * 0.25;
    return aimDirection(yaw, pitch);
  }

  private fireAutomatic(p: SimPlayer, w: AutomaticWeaponDefinition) {
    const s = p.state;
    const origin = this.safeMuzzle(s);
    const dir = this.spread(aimDirection(s.yaw, s.pitch), s.grounded ? w.spreadDeg : w.airSpreadDeg);
    const vel: Vec3 = [dir[0] * w.projectileSpeed, dir[1] * w.projectileSpeed, dir[2] * w.projectileSpeed];
    const proj: Projectile = {
      id: this.nextId++,
      owner: p.id,
      team: p.team,
      kind: 'droplet',
      pos: origin,
      vel,
      age: 0,
      straightTime: w.straightTime,
      gravity: w.gravity,
      maxLife: w.maxLife,
      damage: w.damage,
      paintRadius: w.paintRadius,
      dripRadius: w.dripRadius,
      dripDone: false,
      hitRadius: w.projectileRadius,
      group: 0,
    };
    this.projectiles.push(proj);
    this.emit({ k: 'shot', pid: p.id, w: 'esguicho', p: r3v(origin), v: r3v(vel), gd: w.straightTime, g: w.gravity, life: w.maxLife });
  }

  private fireFlick(p: SimPlayer, w: ContactWeaponDefinition) {
    const s = p.state;
    const origin = this.safeMuzzle(s);
    const group = this.nextId++;
    const baseYaw = s.yaw;
    const basePitch = Math.min(s.pitch, 0.25) - 0.12;
    for (let i = 0; i < w.flickCount; i++) {
      const t = w.flickCount === 1 ? 0 : i / (w.flickCount - 1) - 0.5;
      const yaw = baseYaw + ((t * w.flickSpreadDeg * 2) * Math.PI) / 180 + this.rng.gauss() * 0.02;
      const dir = aimDirection(yaw, basePitch + this.rng.gauss() * 0.03);
      const speed = w.flickSpeed * (0.9 + 0.2 * this.rng.next());
      const vel: Vec3 = [dir[0] * speed, dir[1] * speed + w.flickUp, dir[2] * speed];
      this.projectiles.push({
        id: this.nextId++,
        owner: p.id,
        team: p.team,
        kind: 'flick',
        pos: [...origin] as Vec3,
        vel,
        age: 0,
        straightTime: 0,
        gravity: w.flickGravity,
        maxLife: w.flickLife,
        damage: w.flickDamage,
        paintRadius: w.flickPaintRadius,
        dripRadius: 0,
        dripDone: true,
        hitRadius: 0.2,
        group,
      });
      this.emit({ k: 'shot', pid: p.id, w: 'flick', p: r3v(origin), v: r3v(vel), gd: 0, g: w.flickGravity, life: w.flickLife });
    }
  }

  private flickDamageDealt = new Map<string, number>();

  /** Rodo arrastado: pinta uma faixa real à frente e causa dano por contato com velocidade real. */
  private applyDrag(p: SimPlayer, w: ContactWeaponDefinition) {
    const s = p.state;
    const hspeed = Math.hypot(s.vel[0], s.vel[2]);
    if (hspeed < 0.5) return;
    const f = forwardFromYaw(s.yaw);
    const r = rightFromYaw(s.yaw);
    const chest: Vec3 = [s.pos[0], s.pos[1] + 0.6, s.pos[2]];
    const sink = this.sinkFor(p);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const lat = (i / (n - 1) - 0.5) * w.bladeWidth;
      const bp: Vec3 = [s.pos[0] + f[0] * 0.6 + r[0] * lat, s.pos[1] + 0.4, s.pos[2] + f[2] * 0.6 + r[2] * lat];
      if (this.physics.segmentBlocked(chest, bp, 0.02)) continue;
      const down = this.physics.raycast(bp, [0, -1, 0], 0.9);
      if (!down || down.normal[1] < 0.5) continue;
      this.paint.paintSplat({ center: add(down.point, [0, 0.05, 0]), radius: w.stripPaintRadius, team: p.team, seed: this.rng.int(1e9), wobble: 0.05 }, sink);
    }
    if (hspeed < w.contactMinSpeed) return;
    // dano por contato: caixa à frente da lâmina, com linha de visão
    for (const t of this.players.values()) {
      if (t.team === p.team || !t.state.alive || t.state.spawnProtect > 0) continue;
      const cd = p.contactCooldowns.get(t.id) ?? 0;
      if (this.tick < cd) continue;
      const rel = sub(t.state.pos, s.pos);
      const fwdD = rel[0] * f[0] + rel[2] * f[2];
      const latD = rel[0] * r[0] + rel[2] * r[2];
      if (fwdD < 0.1 || fwdD > 0.6 + w.bladeReach) continue;
      if (Math.abs(latD) > w.bladeWidth / 2 + MOVEMENT.hitRadius) continue;
      if (Math.abs(rel[1]) > w.bladeHeight) continue;
      const tc: Vec3 = [t.state.pos[0], t.state.pos[1] + 0.6, t.state.pos[2]];
      if (this.physics.segmentBlocked(chest, tc)) continue;
      p.contactCooldowns.set(t.id, this.tick + Math.round(w.contactCooldown / TICK_DT));
      this.damage(t, w.contactDamage, p, 'contact');
    }
  }

  private fireCharge(p: SimPlayer, w: ChargeWeaponDefinition, charge: number) {
    const s = p.state;
    const origin = this.safeMuzzle(s);
    const dir = aimDirection(s.yaw, s.pitch);
    const range = lerp(w.minRange, w.maxRange, charge);
    const worldHit = this.physics.raycast(origin, dir, range);
    let end = worldHit ? worldHit.toi : range;
    const end3 = addScaled(origin, dir, end);
    // alvo mais próximo ao longo do segmento (jogadores inimigos e Rodas)
    let best: { t: number; player?: SimPlayer; wheel?: WheelObject } | null = null;
    for (const t of this.players.values()) {
      if (t.team === p.team || !t.state.alive) continue;
      const tt = segmentCapsuleHit(origin, end3, t.state.pos, hitHeight(t.state), MOVEMENT.hitRadius + w.hitInflate);
      if (tt >= 0 && (!best || tt < best.t)) best = { t: tt, player: t };
    }
    for (const o of this.objects) {
      if (o.kind !== 'wheel' || o.team === p.team) continue;
      const tt = segmentSphere(origin, end3, add(o.pos, [0, 0.4, 0]), RODA_DE_OLEIRO.hitRadius);
      if (tt >= 0 && (!best || tt < best.t)) best = { t: tt, wheel: o };
    }
    const dmg = lerp(w.minDamage, w.maxDamage, charge);
    if (best) end = end * best.t;
    const hitPoint = addScaled(origin, dir, end);
    const sink = this.sinkFor(p);
    // rastro: gotas no piso sob a trajetória
    for (let d = 1.5; d < end; d += w.trailSpacing) {
      const pt = addScaled(origin, dir, d);
      const down = this.physics.raycast(pt, [0, -1, 0], 3.5);
      if (down && down.normal[1] > 0.5) this.paint.paintSplat({ center: add(down.point, [0, 0.08, 0]), radius: w.trailRadius, team: p.team, seed: this.rng.int(1e9), occluded: this.occluder }, sink);
    }
    if (best?.player) {
      this.damage(best.player, dmg, p, 'estilingue');
    } else if (best?.wheel) {
      this.damageWheel(best.wheel, dmg);
    } else if (worldHit) {
      const c = addScaled(worldHit.point, worldHit.normal, 0.12);
      this.paint.paintSplat({ center: c, radius: lerp(w.impactPaintMin, w.impactPaintMax, charge), team: p.team, seed: this.rng.int(1e9), occluded: this.occluder, stretch: dir, normal: worldHit.normal, satellites: 3 }, sink);
      this.emit({ k: 'impact', p: r3v(worldHit.point), n: r3v(worldHit.normal), team: p.team, s: 1 + charge });
    }
    this.emit({ k: 'beam', pid: p.id, team: p.team, from: r3v(origin), to: r3v(hitPoint), charge: Math.round(charge * 100) / 100 });
  }

  private throwMoringa(p: SimPlayer) {
    const s = p.state;
    const origin = this.safeMuzzle(s);
    const dir = aimDirection(s.yaw, Math.min(s.pitch, 0.6));
    const vel: Vec3 = [dir[0] * MORINGA.throwSpeed + s.vel[0] * 0.3, dir[1] * MORINGA.throwSpeed + MORINGA.throwUp, dir[2] * MORINGA.throwSpeed + s.vel[2] * 0.3];
    const o: MoringaObject = { id: this.nextId++, kind: 'moringa', owner: p.id, team: p.team, pos: origin, vel, age: 0, fuse: -1, armed: false, resting: false, bounces: 0 };
    this.objects.push(o);
    s.spawnProtect = 0;
    this.emit({ k: 'throw', id: o.id, pid: p.id, team: p.team, kind: 'moringa', p: r3v(origin), v: r3v(vel) });
  }

  private tryActivateSpecial(p: SimPlayer) {
    const s = p.state;
    if (!s.alive || s.specialActive || s.special < RODA_DE_OLEIRO.pointsRequired || s.travelPhase !== 0) {
      this.emit({ k: 'denied', reason: 'special_unavailable' }, p.id);
      return;
    }
    const origin = this.safeMuzzle(s);
    const dir = aimDirection(s.yaw, Math.min(s.pitch, 0.5));
    const vel: Vec3 = [dir[0] * RODA_DE_OLEIRO.throwSpeed, dir[1] * RODA_DE_OLEIRO.throwSpeed + RODA_DE_OLEIRO.throwUp, dir[2] * RODA_DE_OLEIRO.throwSpeed];
    const o: WheelObject = { id: this.nextId++, kind: 'wheel', owner: p.id, team: p.team, pos: origin, vel, age: 0, deployed: false, deployAge: 0, hp: RODA_DE_OLEIRO.hp, waveRadius: [], waveHit: [] };
    this.objects.push(o);
    s.special = 0;
    s.specialActive = true;
    s.spawnProtect = 0;
    p.stats.specialsUsed++;
    this.emit({ k: 'special', pid: p.id, kind: 'wheel' });
    this.emit({ k: 'throw', id: o.id, pid: p.id, team: p.team, kind: 'wheel', p: r3v(origin), v: r3v(vel) });
  }

  /* --------------------------- tinta --------------------------- */

  readonly occluder = (from: Vec3, to: Vec3) => this.physics.segmentBlocked(from, to, 0.08);

  /** Atribui conquistas de área e carga especial a quem pintou. */
  private sinkFor(p: SimPlayer | null): PaintChangeSink | undefined {
    if (!p) return undefined;
    return (cell, prev, next, units, scoring) => {
      if (prev === next) return;
      if (scoring) {
        p.stats.paintedUnits += units;
        this.mutirao?.record(p, cell, prev, units * this.layout.areaPerUnit);
      }
      if (!p.state.specialActive && p.state.alive) {
        p.state.special = Math.min(RODA_DE_OLEIRO.pointsRequired, p.state.special + units * this.layout.areaPerUnit);
      }
    };
  }

  /* --------------------------- projéteis --------------------------- */

  private stepProjectiles(dt: number) {
    this.projectiles.sort((a, b) => a.id - b.id);
    const keep: Projectile[] = [];
    for (const pr of this.projectiles) {
      if (this.stepProjectile(pr, dt)) keep.push(pr);
    }
    this.projectiles.length = 0;
    this.projectiles.push(...keep);
  }

  /** Retorna false quando o projétil termina. Varredura contínua (sem atravessar paredes). */
  private stepProjectile(pr: Projectile, dt: number): boolean {
    const p0 = pr.pos;
    const vy = pr.age >= pr.straightTime ? pr.vel[1] - pr.gravity * dt : pr.vel[1];
    const vel: Vec3 = [pr.vel[0], vy, pr.vel[2]];
    const p1: Vec3 = [p0[0] + vel[0] * dt, p0[1] + vel[1] * dt, p0[2] + vel[2] * dt];
    pr.vel = vel;
    pr.age += dt;
    const seg = sub(p1, p0);
    const L = Math.hypot(seg[0], seg[1], seg[2]);
    const dir: Vec3 = L > 0 ? [seg[0] / L, seg[1] / L, seg[2] / L] : [0, -1, 0];
    const owner = this.players.get(pr.owner) ?? null;

    const wh = L > 0 ? this.physics.raycast(p0, dir, L + pr.hitRadius * 0.5) : null;
    let tWorld = wh ? Math.min(1, wh.toi / Math.max(L, 1e-6)) : Infinity;
    let hitPlayer: SimPlayer | null = null;
    let hitWheel: WheelObject | null = null;
    let tBest = tWorld;
    for (const t of this.players.values()) {
      if (t.team === pr.team || !t.state.alive) continue; // atravessa aliados (regra única)
      const tt = segmentCapsuleHit(p0, p1, t.state.pos, hitHeight(t.state), MOVEMENT.hitRadius + pr.hitRadius);
      if (tt >= 0 && tt < tBest) {
        tBest = tt;
        hitPlayer = t;
        hitWheel = null;
      }
    }
    for (const o of this.objects) {
      if (o.kind !== 'wheel' || o.team === pr.team) continue;
      const tt = segmentSphere(p0, p1, add(o.pos, [0, 0.4, 0]), RODA_DE_OLEIRO.hitRadius + pr.hitRadius);
      if (tt >= 0 && tt < tBest) {
        tBest = tt;
        hitWheel = o;
        hitPlayer = null;
      }
    }

    if (hitPlayer) {
      const dmg = this.projectileDamage(pr, hitPlayer);
      if (dmg > 0) this.damage(hitPlayer, dmg, owner, pr.kind === 'flick' ? 'rodo' : 'esguicho');
      const hp = addScaled(p0, seg, tBest);
      const down = this.physics.raycast(hp, [0, -1, 0], 3);
      if (down) this.paint.paintSplat({ center: add(down.point, [0, 0.08, 0]), radius: pr.paintRadius * 0.5, team: pr.team, seed: this.rng.int(1e9), occluded: this.occluder }, this.sinkFor(owner));
      return false;
    }
    if (hitWheel) {
      this.damageWheel(hitWheel, pr.damage);
      return false;
    }
    if (wh && tWorld <= 1) {
      const c = addScaled(wh.point, wh.normal, 0.12);
      this.paint.paintSplat({ center: c, radius: pr.paintRadius, team: pr.team, seed: this.rng.int(1e9), occluded: this.occluder, stretch: dir, normal: wh.normal, satellites: pr.kind === 'flick' ? 1 : 2 }, this.sinkFor(owner));
      this.emit({ k: 'impact', p: r3v(wh.point), n: r3v(wh.normal), team: pr.team, s: pr.kind === 'flick' ? 0.8 : 0.6 });
      return false;
    }
    pr.pos = p1;
    // gota intermediária: pinta o piso sob a trajetória (cobertura regular)
    if (!pr.dripDone && pr.age >= pr.straightTime + 0.06) {
      pr.dripDone = true;
      const down = this.physics.raycast(p1, [0, -1, 0], 6);
      if (down && down.normal[1] > 0.5) this.paint.paintSplat({ center: add(down.point, [0, 0.08, 0]), radius: pr.dripRadius, team: pr.team, seed: this.rng.int(1e9), occluded: this.occluder }, this.sinkFor(owner));
    }
    if (pr.age > pr.maxLife || p1[1] < this.opts.map.killY) return false;
    void tWorld;
    return true;
  }

  private projectileDamage(pr: Projectile, target: SimPlayer): number {
    if (pr.kind !== 'flick') return pr.damage;
    const key = `${pr.group}:${target.id}`;
    const dealt = this.flickDamageDealt.get(key) ?? 0;
    const cap = (WEAPONS.rodo as ContactWeaponDefinition).flickMaxDamagePerTarget;
    const dmg = Math.max(0, Math.min(pr.damage, cap - dealt));
    this.flickDamageDealt.set(key, dealt + dmg);
    if (this.flickDamageDealt.size > 512) this.flickDamageDealt.clear();
    return dmg;
  }

  /* ---------------------------- objetos ---------------------------- */

  private stepObjects(dt: number) {
    this.objects.sort((a, b) => a.id - b.id);
    const keep: WorldObject[] = [];
    for (const o of this.objects) {
      const alive = o.kind === 'moringa' ? this.stepMoringa(o, dt) : this.stepWheel(o, dt);
      if (alive) keep.push(o);
    }
    this.objects.length = 0;
    this.objects.push(...keep);
  }

  /** Física simples de arremesso: gravidade, quique amortecido nas paredes, pouso em piso. */
  private stepThrown(o: { pos: Vec3; vel: Vec3 }, gravity: number, dt: number, radius: number, damping: number): 'flying' | 'landed' | 'bounced' {
    o.vel = [o.vel[0], o.vel[1] - gravity * dt, o.vel[2]];
    const d: Vec3 = [o.vel[0] * dt, o.vel[1] * dt, o.vel[2] * dt];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-6) return 'flying';
    const dir: Vec3 = [d[0] / L, d[1] / L, d[2] / L];
    const hit = this.physics.raycast(o.pos, dir, L + radius);
    if (!hit) {
      o.pos = add(o.pos, d);
      return 'flying';
    }
    o.pos = addScaled(hit.point, hit.normal, radius);
    if (hit.normal[1] > 0.6) {
      o.vel = [0, 0, 0];
      return 'landed';
    }
    const vn = o.vel[0] * hit.normal[0] + o.vel[1] * hit.normal[1] + o.vel[2] * hit.normal[2];
    o.vel = [(o.vel[0] - 2 * vn * hit.normal[0]) * damping, (o.vel[1] - 2 * vn * hit.normal[1]) * damping, (o.vel[2] - 2 * vn * hit.normal[2]) * damping];
    return 'bounced';
  }

  private stepMoringa(o: MoringaObject, dt: number): boolean {
    o.age += dt;
    if (!o.resting) {
      const r = this.stepThrown(o, MORINGA.gravity, dt, MORINGA.radius, MORINGA.bounceDamping);
      if (r === 'landed') o.resting = true;
      if (r === 'bounced') o.bounces++;
      if (!o.armed && (r !== 'flying' || o.age >= MORINGA.maxFlight || o.bounces > MORINGA.maxBounces)) {
        o.armed = true;
        o.fuse = MORINGA.fuse;
      }
      if (o.pos[1] < this.opts.map.killY) return false;
    }
    if (o.armed) {
      o.fuse -= dt;
      if (o.fuse <= 0) {
        this.burstMoringa(o);
        return false;
      }
    }
    return true;
  }

  private burstMoringa(o: MoringaObject) {
    const owner = this.players.get(o.owner) ?? null;
    const c: Vec3 = add(o.pos, [0, 0.25, 0]);
    this.paint.paintSplat({ center: c, radius: MORINGA.paintRadius, team: o.team, seed: this.rng.int(1e9), occluded: this.occluder, wobble: 0.24, normal: [0, 1, 0], satellites: 6 }, this.sinkFor(owner));
    this.emit({ k: 'burst', id: o.id, team: o.team, p: r3v(c), r: MORINGA.paintRadius });
    for (const t of this.sortedPlayers()) {
      if (t.team === o.team || !t.state.alive) continue;
      const body: Vec3 = [t.state.pos[0], t.state.pos[1] + 0.7, t.state.pos[2]];
      const d = dist(c, body);
      if (d > MORINGA.damageRadius) continue;
      if (!this.hasLineOfSightToBody(c, t)) continue; // sem dano através de paredes
      const dmg = d <= MORINGA.damageInnerRadius ? MORINGA.damageInner : lerp(MORINGA.damageInner * 0.55, MORINGA.damageOuter, (d - MORINGA.damageInnerRadius) / (MORINGA.damageRadius - MORINGA.damageInnerRadius));
      this.damage(t, dmg, owner, 'moringa');
    }
    for (const w of this.objects) {
      if (w.kind === 'wheel' && w.team !== o.team && dist(w.pos, c) < MORINGA.damageRadius && !this.physics.segmentBlocked(c, add(w.pos, [0, 0.4, 0]))) this.damageWheel(w, 60);
    }
  }

  private hasLineOfSightToBody(from: Vec3, t: SimPlayer): boolean {
    const h = hitHeight(t.state);
    const pts: Vec3[] = [
      [t.state.pos[0], t.state.pos[1] + h * 0.5, t.state.pos[2]],
      [t.state.pos[0], t.state.pos[1] + h * 0.9, t.state.pos[2]],
      [t.state.pos[0], t.state.pos[1] + 0.15, t.state.pos[2]],
    ];
    return pts.some((pt) => !this.physics.segmentBlocked(from, pt, 0.1));
  }

  private stepWheel(o: WheelObject, dt: number): boolean {
    const R = RODA_DE_OLEIRO;
    o.age += dt;
    const owner = this.players.get(o.owner) ?? null;
    if (!o.deployed) {
      const r = this.stepThrown(o, R.gravity, dt, 0.25, 0.3);
      if (r === 'landed') {
        o.deployed = true;
        o.deployAge = 0;
      } else if (o.age > 3 || o.pos[1] < this.opts.map.killY) {
        // falha segura: não pousou num piso; devolve a carga
        if (owner) {
          owner.state.specialActive = false;
          owner.state.special = R.pointsRequired;
        }
        this.emit({ k: 'objectDestroyed', id: o.id });
        return false;
      }
      return true;
    }
    o.deployAge += dt;
    const center: Vec3 = add(o.pos, [0, 0.5, 0]);
    for (let k = 0; k < R.waveCount; k++) {
      const start = R.deployTime + k * R.waveInterval;
      const t = o.deployAge - start;
      if (t < 0 || t > R.waveDuration + dt) continue;
      if (o.waveRadius[k] === undefined) {
        o.waveRadius[k] = 0;
        o.waveHit[k] = new Set();
        this.emit({ k: 'wave', id: o.id, team: o.team, p: r3v(o.pos), r: R.waveRadius, n: k });
      }
      const r1 = R.waveRadius * Math.min(1, t / R.waveDuration);
      const r0 = o.waveRadius[k];
      if (r1 <= r0) continue;
      this.paint.paintSplat({ center, radius: r1, innerRadius: Math.max(0, r0 - 0.3), verticalBand: R.waveVerticalBand, floorsOnly: true, team: o.team, seed: this.rng.int(1e9), occluded: this.occluder }, this.sinkFor(owner));
      for (const tp of this.sortedPlayers()) {
        if (tp.team === o.team || !tp.state.alive || o.waveHit[k].has(tp.id)) continue;
        const hd = Math.hypot(tp.state.pos[0] - o.pos[0], tp.state.pos[2] - o.pos[2]);
        const vd = Math.abs(tp.state.pos[1] - o.pos[1]);
        if (hd < r0 - 0.5 || hd > r1 + 0.5 || vd > R.waveVerticalBand) continue;
        if (!this.hasLineOfSightToBody(center, tp)) continue;
        o.waveHit[k].add(tp.id);
        this.damage(tp, R.waveDamage, owner, 'wheel');
      }
      o.waveRadius[k] = r1;
    }
    if (o.deployAge >= R.lifetime || o.hp <= 0) {
      if (owner) owner.state.specialActive = false;
      this.emit({ k: 'objectDestroyed', id: o.id });
      return false;
    }
    return true;
  }

  private damageWheel(o: WheelObject, dmg: number) {
    o.hp -= dmg;
  }

  /* ---------------------- dano e eliminação ---------------------- */

  /** Única porta de entrada de dano ofensivo. Sem fogo amigo; proteção de spawn respeitada. */
  damage(target: SimPlayer, amount: number, source: SimPlayer | null, cause: 'esguicho' | 'rodo' | 'estilingue' | 'moringa' | 'wheel' | 'contact') {
    const s = target.state;
    if (!s.alive || amount <= 0) return;
    if (source && source.team === target.team) return;
    if (s.spawnProtect > 0) return;
    s.hp -= amount;
    target.hpRegenDelay = HEALTH.regenDelay;
    target.lastDamagedBy = source?.id ?? null;
    const lethal = s.hp <= 0;
    this.emit({ k: 'hit', src: source?.id ?? 0, dst: target.id, dmg: Math.round(amount), lethal });
    if (lethal) this.eliminate(target, source, cause);
  }

  private eliminate(target: SimPlayer, killer: SimPlayer | null, cause: 'esguicho' | 'rodo' | 'estilingue' | 'moringa' | 'wheel' | 'contact') {
    const s = target.state;
    s.alive = false;
    s.hp = 0;
    s.respawnTimer = HEALTH.respawnDelay;
    s.charging = false;
    s.charge = 0;
    s.dragging = false;
    s.climbSurface = -1;
    s.vel = [0, 0, 0];
    s.travelPhase = 0;
    target.travel = null;
    target.stats.deaths++;
    // eliminação: solta a cápsula e encerra buff e Mutirão (não reiniciam no reaparecimento)
    this.correio?.drop(target.id);
    if (target.mode.buff && target.mode.buffTicks > 0) this.emit({ k: 'buffEnd', pid: target.id, kind: target.mode.buff });
    target.mode.buff = null;
    target.mode.buffTicks = 0;
    target.mode.mutiraoTicks = 0;
    applyModifiers(target, target.mode);
    if (s.special < RODA_DE_OLEIRO.pointsRequired) s.special *= 1 - RODA_DE_OLEIRO.deathLossFraction;
    if (killer) {
      killer.stats.eliminations++;
      const c: Vec3 = [s.pos[0], s.pos[1] + 0.4, s.pos[2]];
      this.paint.paintSplat({ center: c, radius: HEALTH.deathSplatRadius, team: killer.team, seed: this.rng.int(1e9), occluded: this.occluder }, this.sinkFor(killer));
    }
    const causeOut = cause === 'contact' ? 'contact' : cause;
    this.emit({ k: 'elim', killer: killer?.id ?? null, victim: target.id, cause: causeOut });
  }

  private stepRespawn(p: SimPlayer, dt: number) {
    const s = p.state;
    if (s.alive) return;
    s.respawnTimer -= dt;
    if (s.respawnTimer <= 0) this.respawnNow(p);
  }

  private respawnNow(p: SimPlayer) {
    const sp = this.pickSpawn(p.team);
    const special = p.state.special;
    const specialActive = p.state.specialActive;
    const lastActionId = p.state.lastActionId;
    const fresh = createPlayerState(sp.pos, sp.yaw);
    fresh.special = special;
    fresh.specialActive = specialActive;
    fresh.lastActionId = lastActionId;
    fresh.spawnProtect = HEALTH.spawnProtection;
    p.state = fresh;
    p.travel = null;
    p.hpRegenDelay = 0;
    this.emit({ k: 'respawn', pid: p.id });
  }

  /* ---------------------- deslocamento tático ---------------------- */

  private tryStartTravel(p: SimPlayer, targetId: number) {
    const s = p.state;
    const t = this.players.get(targetId);
    const deny = (reason: string) => this.emit({ k: 'denied', reason }, p.id);
    if (!t || t.id === p.id || t.team !== p.team) return deny('travel_invalid_target');
    if (!t.state.alive || t.state.travelPhase !== 0) return deny('travel_target_unavailable');
    if (!s.alive || s.travelPhase !== 0 || s.climbSurface >= 0) return deny('travel_state');
    // Correio do Ara: o Pião-Guia fica indisponível para quem carrega a cápsula
    if (this.isCarrier(p.id)) return deny('travel_carrying');
    p.travel = { targetId, destination: null, origin: [...s.pos] as Vec3 };
    s.travelPhase = 1;
    s.travelTimer = PIAO_GUIA.prepTime;
    s.spawnProtect = 0; // não concede invulnerabilidade
    s.form = 0;
    s.formTimer = 0;
    s.charging = false;
    s.dragging = false;
    this.emit({ k: 'travel', pid: p.id, target: targetId, to: r3v(t.state.pos), phase: 'prep' });
  }

  /** Busca um destino válido (piso + espaço livre) perto do ponto. */
  findLandingSpot(around: Vec3, body = this.anyBody()): Vec3 | null {
    if (!body) return null;
    const offsets: Array<[number, number]> = [[0, 0]];
    for (let r = 0.6; r <= PIAO_GUIA.maxDestinationSearch; r += 0.6) for (let k = 0; k < 8; k++) offsets.push([Math.cos((k * Math.PI) / 4) * r, Math.sin((k * Math.PI) / 4) * r]);
    for (const [ox, oz] of offsets) {
      const top: Vec3 = [around[0] + ox, around[1] + 1.2, around[2] + oz];
      if (this.physics.pointInsideWorld(top)) continue;
      const down = this.physics.raycast(top, [0, -1, 0], 3);
      if (!down || down.normal[1] < 0.6) continue;
      const feet: Vec3 = [down.point[0], down.point[1] + 0.02, down.point[2]];
      const b = this.opts.map.bounds;
      if (feet[0] < b.min[0] || feet[0] > b.max[0] || feet[2] < b.min[2] || feet[2] > b.max[2]) continue;
      if (body.fits(feet)) return feet;
    }
    return null;
  }

  private anyBody() {
    for (const p of this.players.values()) return p.body;
    return null;
  }

  private stepTravel(p: SimPlayer, dt: number) {
    const s = p.state;
    const tr = p.travel;
    if (!tr) {
      s.travelPhase = 0;
      return;
    }
    s.travelTimer -= dt;
    if (s.travelPhase === 1) {
      const t = this.players.get(tr.targetId);
      if (!t || !t.state.alive) {
        // política: alvo eliminado/saiu durante a preparação => cancela sem custo
        s.travelPhase = 0;
        p.travel = null;
        this.emit({ k: 'travel', pid: p.id, target: tr.targetId, to: r3v(s.pos), phase: 'cancel' });
        return;
      }
      if (s.travelTimer <= 0) {
        const dest = this.findLandingSpot(t.state.pos, p.body);
        if (!dest) {
          s.travelPhase = 0;
          p.travel = null;
          this.emit({ k: 'travel', pid: p.id, target: tr.targetId, to: r3v(s.pos), phase: 'cancel' });
          return;
        }
        tr.destination = dest;
        tr.origin = [...s.pos] as Vec3;
        s.travelPhase = 2;
        s.travelTimer = PIAO_GUIA.flightTime;
        this.emit({ k: 'travel', pid: p.id, target: tr.targetId, to: r3v(dest), phase: 'launch' });
      }
      return;
    }
    // voo em arco até o destino fixado
    const dest = tr.destination!;
    const k = clamp(1 - s.travelTimer / PIAO_GUIA.flightTime, 0, 1);
    const flat = [lerp(tr.origin[0], dest[0], k), lerp(tr.origin[1], dest[1], k), lerp(tr.origin[2], dest[2], k)] as Vec3;
    flat[1] += Math.sin(Math.PI * k) * PIAO_GUIA.arcHeight;
    s.pos = flat;
    if (s.travelTimer <= 0) {
      // revalida o destino antes de concluir
      let landing: Vec3 | null = p.body.fits(dest) ? dest : this.findLandingSpot(dest, p.body);
      if (!landing) landing = this.pickSpawn(p.team).pos;
      s.pos = landing;
      s.vel = [0, 0, 0];
      s.grounded = true;
      s.travelPhase = 0;
      p.travel = null;
      this.emit({ k: 'travel', pid: p.id, target: tr.targetId, to: r3v(landing), phase: 'land' });
    }
  }

  /* ------------------------ término e resultado ------------------------ */

  /** Congela a simulação e calcula o resultado uma única vez. */
  finish(status: 'completed' | 'interrupted'): RoundResult {
    this.finishCount++;
    if (this.result) return this.result;
    this.phase = 'finished';
    this.projectiles.length = 0;
    const L = this.layout;
    const total = L.totalScoringUnits;
    const u0 = this.paint.teamUnits[0];
    const u1 = this.paint.teamUnits[1];
    const deliveries: [number, number] = this.correio ? [...this.correio.deliveries] as [number, number] : [0, 0];
    // território: mais área; Correio: mais entregas (igualdade é empate nos dois)
    const winner: TeamId | 'draw' = this.correio
      ? deliveries[0] === deliveries[1] ? 'draw' : deliveries[0] > deliveries[1] ? 0 : 1
      : u0 === u1 ? 'draw' : u0 > u1 ? 0 : 1;
    const pct = (u: number) => Math.round((u / total) * 1000) / 10;
    const players: PlayerRoundStats[] = this.sortedPlayers().map((p) => ({
      playerId: p.id,
      displayName: p.name,
      team: p.team,
      isBot: p.isBot,
      weaponId: p.weaponId,
      paintedArea: Math.round(p.stats.paintedUnits * L.areaPerUnit * 10) / 10,
      eliminations: p.stats.eliminations,
      deaths: p.stats.deaths,
      specialsUsed: p.stats.specialsUsed,
      deliveries: p.mode.deliveries,
      mutiroes: p.mode.mutiroes,
    }));
    this.result = {
      matchId: this.opts.matchId,
      roundId: this.opts.roundId,
      mapId: this.opts.map.id,
      mode: this.mode,
      deliveries,
      totalArea: Math.round(total * L.areaPerUnit * 100) / 100,
      teamArea: [Math.round(u0 * L.areaPerUnit * 100) / 100, Math.round(u1 * L.areaPerUnit * 100) / 100],
      neutralArea: Math.round((total - u0 - u1) * L.areaPerUnit * 100) / 100,
      teamUnits: [u0, u1],
      totalUnits: total,
      percent: [pct(u0), pct(u1)],
      neutralPercent: Math.round((100 - (u0 / total) * 100 - (u1 / total) * 100) * 10) / 10,
      winner,
      endedAtTick: this.tick,
      players,
      status,
    };
    return this.result;
  }

  get finishCalls(): number {
    return this.finishCount;
  }

  dispose() {
    for (const p of this.players.values()) p.body.dispose();
    this.players.clear();
  }

  /** Utilitário de testes/bots: equipe adversária. */
  enemyOf(t: TeamId): TeamId {
    return otherTeam(t);
  }

  /** Utilitário: direção normalizada (exposto para bots). */
  static dir(a: Vec3, b: Vec3): Vec3 {
    return normalize(sub(b, a));
  }
}

function r3v(v: Vec3): Vec3 {
  return [Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000, Math.round(v[2] * 1000) / 1000];
}

/** Interseção segmento–esfera: t ∈ [0,1] ou -1. */
function segmentSphere(p0: Vec3, p1: Vec3, c: Vec3, r: number): number {
  const d = sub(p1, p0);
  const f = sub(p0, c);
  const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const b = 2 * (f[0] * d[0] + f[1] * d[1] + f[2] * d[2]);
  const cc = f[0] * f[0] + f[1] * f[1] + f[2] * f[2] - r * r;
  if (cc <= 0) return 0;
  const disc = b * b - 4 * a * cc;
  if (disc < 0 || a < 1e-9) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
