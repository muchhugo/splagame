import type { ActionKind, BuffKind, PickupSnapshot, PlayerInput, SelfSnapshot, TeamId, Vec3, WeaponId } from '@borrifo/game-contracts';
import { Buttons, TICK_DT, decodeInput, encodeInput } from '@borrifo/game-contracts';
import { BUFFS, MOVEMENT, WEAPONS } from '@borrifo/game-content';
import { applySelfSnapshot, buffTicksFor, createPlayerState, pickupReach, stepPlayer, type CharacterBody, type PaintQuery, type PhysicsWorld, type PlayerSimState, type StepIntents } from '@borrifo/game-simulation';

/** Estado de modo que a previsão acompanha para acertar a velocidade (Embalo). */
export interface PredictedModeInput {
  /** Buff ativo e ticks restantes, exatos, no estado do ack. */
  buff?: BuffKind | null;
  buffTicks?: number;
  /** Pickups disponíveis no mesmo snapshot. */
  pickups?: readonly PickupSnapshot[];
}

export interface PredictedStep {
  input: PlayerInput;
  intents: StepIntents;
}

/**
 * Previsão do jogador local com o MESMO stepPlayer do servidor. Guarda um
 * histórico limitado de entradas; ao receber o estado autoritativo, descarta as
 * confirmadas, aplica forma/pigmento/superfície/posição e reaplica as pendentes.
 */
export class LocalPredictor {
  state: PlayerSimState;
  prevPos: Vec3;
  private history: PlayerInput[] = [];
  private seq = 0;
  private actionId = 0;
  private body: CharacterBody;
  /** Deslocamento visual que decai após correções pequenas. */
  errorOffset: Vec3 = [0, 0, 0];
  corrections = 0;
  correctionLog: number[] = [];
  bigCorrections = 0;
  lastAck = 0;
  private ackedMaxAction = 0;
  frozen = false;
  /** Buff previsto e ticks restantes (o servidor manda os exatos; aqui só se descontam). */
  private buff: BuffKind | null = null;
  private buffTicks = 0;
  /** Pickups disponíveis segundo o último snapshot; `taken` marca a coleta prevista. */
  private pickups: Array<{ pos: Vec3; kind: BuffKind; readyIn: number; taken: boolean }> = [];
  /**
   * Diagnóstico opcional (desligado): estado previsto por sequência, para comparar com o
   * do servidor no mesmo ack e separar divergência de passo de efeito do replay.
   */
  debugTrace: Map<number, { p: Vec3; v: Vec3; g: boolean; gs: number; f: number; ft: number }> | null = null;
  debugLog: Array<{ ack: number; ackDiff: number; corr: number; mine?: unknown; srv?: unknown }> = [];
  /** Só acompanha o buff quando o servidor manda os ticks exatos (`bk`). */
  private trackBuff = false;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly paint: PaintQuery,
    readonly team: TeamId,
    readonly weaponId: WeaponId,
    spawn: Vec3,
    yaw: number,
  ) {
    this.body = physics.createCharacter(MOVEMENT);
    this.state = createPlayerState(spawn, yaw);
    this.prevPos = [...spawn] as Vec3;
  }

  /** Posições dos pickups do mapa (na ordem do servidor). */
  setMapPickups(list: ReadonlyArray<{ pos: Vec3; kind: BuffKind }>) {
    this.pickups = list.map((p) => ({ pos: p.pos, kind: p.kind, readyIn: Infinity, taken: false }));
  }

  /**
   * Depois de cada passo, na mesma ordem do servidor: desconta o buff, coleta um pickup
   * ao alcance (ignora disputa com outra pessoa: se outra levar, a reconciliação corrige)
   * e aplica o Embalo no próximo passo. Fôlego e Mutirão só mexem no pigmento: ficam com
   * o valor do servidor.
   */
  private stepModes() {
    if (!this.trackBuff) return;
    if (this.buffTicks > 0 && --this.buffTicks === 0) this.buff = null;
    for (const it of this.pickups) {
      // aparece no tick exato do servidor (a contagem vem do snapshot)
      if (it.readyIn > 0) it.readyIn--;
      if (it.readyIn > 0 || it.taken) continue;
      if (pickupReach(this.state, it.pos, this.physics) === null) continue;
      this.buff = it.kind;
      this.buffTicks = buffTicksFor(it.kind);
      it.taken = true;
    }
    this.state.speedMul = this.buff === 'embalo' && this.buffTicks > 0 ? BUFFS.embalo.speedMul : 1;
  }

  private ctx(replay: boolean) {
    return { body: this.body, physics: this.physics, paint: this.paint, team: this.team, weapon: WEAPONS[this.weaponId], tuning: MOVEMENT, replay };
  }

  /** Gera a próxima entrada, simula localmente e devolve para envio. */
  step(move: [number, number], yaw: number, pitch: number, buttons: number, actions: ActionKind[], travelTarget?: number): PredictedStep {
    const raw: PlayerInput = {
      sequence: ++this.seq,
      clientTick: this.seq,
      moveX: move[0],
      moveY: move[1],
      yaw,
      pitch,
      heldButtons: buttons,
      pressedActions: actions.map((kind) => ({ actionId: ++this.actionId, kind, ...(kind === 'tacticalTravel' && travelTarget !== undefined ? { targetPlayerId: travelTarget } : {}) })),
    };
    // prevê com a entrada EXATA que o servidor vai decodificar (mira quantizada em
    // milirradianos, eixos limitados): um milésimo de radiano muda o que o controlador
    // de personagem decide numa quina
    const input = decodeInput(encodeInput(raw));
    this.history.push(input);
    if (this.history.length > 90) this.history.shift();
    this.prevPos = [...this.state.pos] as Vec3;
    const intents = this.frozen ? emptyIntents() : stepPlayer(this.state, input, TICK_DT, this.ctx(false));
    if (!this.frozen) this.stepModes();
    if (this.debugTrace) {
      const st = this.state;
      this.debugTrace.set(input.sequence, { p: [...st.pos] as Vec3, v: [...st.vel] as Vec3, g: st.grounded, gs: st.groundState, f: st.form, ft: st.formTimer });
      if (this.debugTrace.size > 200) this.debugTrace.delete(this.debugTrace.keys().next().value!);
    }
    return { input, intents };
  }

  reconcile(me: SelfSnapshot, ack: number, mode: PredictedModeInput = {}) {
    this.lastAck = ack;
    let ackInput: PlayerInput | undefined;
    const pending: PlayerInput[] = [];
    for (const i of this.history) {
      if (i.sequence <= ack) {
        for (const a of i.pressedActions) this.ackedMaxAction = Math.max(this.ackedMaxAction, a.actionId);
        if (i.sequence === ack) ackInput = i;
      } else pending.push(i);
    }
    this.history = pending;
    const before: Vec3 = [...this.state.pos] as Vec3;
    applySelfSnapshot(this.state, me, ackInput ? (ackInput.heldButtons & Buttons.FIRE) !== 0 : this.state.prevFire);
    // ações até o ack já foram processadas pelo servidor; as pendentes serão reaplicadas
    this.state.lastActionId = this.ackedMaxAction;
    // modo no ack: buff exato e pickups disponíveis; a coleta prevista é refeita no replay
    this.trackBuff = mode.buffTicks !== undefined;
    if (mode.buffTicks !== undefined) {
      this.buff = mode.buff ?? null;
      this.buffTicks = this.buff ? mode.buffTicks : 0;
    }
    if (mode.pickups) for (const pk of mode.pickups) if (this.pickups[pk.i]) this.pickups[pk.i].readyIn = pk.a === 1 ? 0 : (pk.tk ?? Infinity);
    for (const it of this.pickups) it.taken = false;
    if (!this.frozen)
      for (const inp of this.history) {
        stepPlayer(this.state, inp, TICK_DT, this.ctx(true));
        this.stepModes();
      }
    const err: Vec3 = [before[0] - this.state.pos[0], before[1] - this.state.pos[1], before[2] - this.state.pos[2]];
    const mag = Math.hypot(err[0], err[1], err[2]);
    this.correctionLog.push(Math.round(mag * 1000) / 1000);
    if (this.correctionLog.length > 60) this.correctionLog.shift();
    if (mag > 0.05) this.corrections++;
    if (this.debugTrace && mag > 0.25) {
      const mine = this.debugTrace.get(ack);
      const ackDiff = mine ? Math.hypot(mine.p[0] - me.p[0], mine.p[1] - me.p[1], mine.p[2] - me.p[2]) : -1;
      this.debugLog.push({ ack, ackDiff: Math.round(ackDiff * 1000) / 1000, corr: Math.round(mag * 1000) / 1000, mine, srv: { p: me.p, v: me.v, g: me.g, gs: me.gs, f: me.f, ft: me.ft } });
      if (this.debugLog.length > 40) this.debugLog.shift();
    }
    if (mag > 2.5) {
      // violação importante: corrige sem suavizar (sem conceder atravessamento)
      this.errorOffset = [0, 0, 0];
      this.prevPos = [...this.state.pos] as Vec3;
      this.bigCorrections++;
    } else {
      this.errorOffset = [this.errorOffset[0] + err[0], this.errorOffset[1] + err[1], this.errorOffset[2] + err[2]];
    }
  }

  /** Posição de render interpolada entre ticks, somada ao erro que decai. */
  renderPos(alpha: number, dt: number): Vec3 {
    const k = Math.exp(-dt * 12);
    this.errorOffset = [this.errorOffset[0] * k, this.errorOffset[1] * k, this.errorOffset[2] * k];
    const p = this.state.pos,
      q = this.prevPos;
    return [q[0] + (p[0] - q[0]) * alpha + this.errorOffset[0], q[1] + (p[1] - q[1]) * alpha + this.errorOffset[1], q[2] + (p[2] - q[2]) * alpha + this.errorOffset[2]];
  }

  get pendingInputs() {
    return this.history.length;
  }

  dispose() {
    this.body.dispose();
  }
}

function emptyIntents(): StepIntents {
  return { shots: 0, flick: false, dragging: false, chargeRelease: 0, throwSecondary: false, specialRequested: false, travelTarget: -1, jumped: false, denied: [] };
}
