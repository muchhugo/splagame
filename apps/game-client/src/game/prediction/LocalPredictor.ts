import type { ActionKind, PlayerInput, SelfSnapshot, TeamId, Vec3, WeaponId } from '@borrifo/game-contracts';
import { Buttons, TICK_DT } from '@borrifo/game-contracts';
import { MOVEMENT, WEAPONS } from '@borrifo/game-content';
import { applySelfSnapshot, createPlayerState, stepPlayer, type CharacterBody, type PaintQuery, type PhysicsWorld, type PlayerSimState, type StepIntents } from '@borrifo/game-simulation';

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
  bigCorrections = 0;
  lastAck = 0;
  private ackedMaxAction = 0;
  frozen = false;

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

  private ctx(replay: boolean) {
    return { body: this.body, physics: this.physics, paint: this.paint, team: this.team, weapon: WEAPONS[this.weaponId], tuning: MOVEMENT, replay };
  }

  /** Gera a próxima entrada, simula localmente e devolve para envio. */
  step(move: [number, number], yaw: number, pitch: number, buttons: number, actions: ActionKind[], travelTarget?: number): PredictedStep {
    const input: PlayerInput = {
      sequence: ++this.seq,
      clientTick: this.seq,
      moveX: move[0],
      moveY: move[1],
      yaw,
      pitch,
      heldButtons: buttons,
      pressedActions: actions.map((kind) => ({ actionId: ++this.actionId, kind, ...(kind === 'tacticalTravel' && travelTarget !== undefined ? { targetPlayerId: travelTarget } : {}) })),
    };
    this.history.push(input);
    if (this.history.length > 90) this.history.shift();
    this.prevPos = [...this.state.pos] as Vec3;
    const intents = this.frozen ? emptyIntents() : stepPlayer(this.state, input, TICK_DT, this.ctx(false));
    return { input, intents };
  }

  reconcile(me: SelfSnapshot, ack: number) {
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
    if (!this.frozen) for (const inp of this.history) stepPlayer(this.state, inp, TICK_DT, this.ctx(true));
    const err: Vec3 = [before[0] - this.state.pos[0], before[1] - this.state.pos[1], before[2] - this.state.pos[2]];
    const mag = Math.hypot(err[0], err[1], err[2]);
    if (mag > 0.02) this.corrections++;
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
