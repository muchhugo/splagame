import { z } from 'zod';

/** Bits de botões contínuos. */
export const Buttons = {
  FIRE: 1 << 0,
  /** Forma de fluxo desejada. O cliente converte o modo "alternar" em bit contínuo. */
  FLOW: 1 << 1,
  /** Mapa tático aberto (apenas informativo; não altera a simulação). */
  MAP: 1 << 2,
} as const;
export const BUTTON_MASK = Buttons.FIRE | Buttons.FLOW | Buttons.MAP;

export const ACTION_KINDS = ['jump', 'secondary', 'special', 'tacticalTravel'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface PressedAction {
  actionId: number;
  kind: ActionKind;
  targetPlayerId?: number;
}

export interface PlayerInput {
  sequence: number;
  clientTick: number;
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  heldButtons: number;
  pressedActions: PressedAction[];
}

export const PITCH_LIMIT = 1.4;
export const MAX_ACTIONS_PER_INPUT = 4;

export function neutralInput(sequence = 0, yaw = 0, pitch = 0): PlayerInput {
  return { sequence, clientTick: 0, moveX: 0, moveY: 0, yaw, pitch, heldButtons: 0, pressedActions: [] };
}

/**
 * Formato de fio compacto (tupla) enviado via msgpack:
 * [seq, clientTick, moveX, moveY, yaw, pitch, buttons, actions[]]
 * actions: [actionId, kindIndex, target?]
 */
const finite = z.number().refine(Number.isFinite, 'não finito');
const actionTuple = z.union([
  z.tuple([z.number().int().nonnegative(), z.number().int().min(0).max(ACTION_KINDS.length - 1)]),
  z.tuple([z.number().int().nonnegative(), z.number().int().min(0).max(ACTION_KINDS.length - 1), z.number().int().min(0).max(65535)]),
]);
export const InputWireSchema = z.tuple([
  z.number().int().nonnegative().max(2 ** 31),
  z.number().int().nonnegative().max(2 ** 31),
  finite,
  finite,
  finite,
  finite,
  z.number().int().nonnegative().max(0xffff),
  z.array(actionTuple).max(MAX_ACTIONS_PER_INPUT),
]);
export type InputWire = z.infer<typeof InputWireSchema>;

export function encodeInput(i: PlayerInput): InputWire {
  const q = (n: number) => Math.round(n * 1000) / 1000;
  return [
    i.sequence,
    i.clientTick,
    q(i.moveX),
    q(i.moveY),
    q(i.yaw),
    q(i.pitch),
    i.heldButtons,
    i.pressedActions.map((a) => {
      const k = ACTION_KINDS.indexOf(a.kind);
      return a.targetPlayerId !== undefined ? ([a.actionId, k, a.targetPlayerId] as [number, number, number]) : ([a.actionId, k] as [number, number]);
    }),
  ];
}

/**
 * Converte e normaliza a entrada. Nunca confia no cliente: vetor de movimento é
 * limitado a norma 1 (sem bônus diagonal), pitch é limitado, yaw é normalizado.
 */
export function decodeInput(w: InputWire): PlayerInput {
  let mx = clamp(w[2], -1, 1);
  let my = clamp(w[3], -1, 1);
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  return {
    sequence: w[0],
    clientTick: w[1],
    moveX: mx,
    moveY: my,
    yaw: wrapAngle(w[4]),
    pitch: clamp(w[5], -PITCH_LIMIT, PITCH_LIMIT),
    heldButtons: w[6] & BUTTON_MASK,
    pressedActions: w[7].map((a) => ({
      actionId: a[0],
      kind: ACTION_KINDS[a[1]],
      ...(a.length === 3 ? { targetPlayerId: a[2] } : {}),
    })),
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function wrapAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  a = a % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a < -Math.PI) a += TWO_PI;
  return a;
}
