import { describe, expect, it } from 'vitest';
import { BUTTON_MASK, InputWireSchema, JoinOptionsSchema, PITCH_LIMIT, decodeInput, encodeInput, neutralInput, SetTeamSchema } from '../src/index';

describe('entradas do jogador (fronteira de confiança)', () => {
  it('ida e volta preserva a intenção e normaliza valores', () => {
    const w = encodeInput({ ...neutralInput(10, 1, 0.2), moveX: 1, moveY: 1, heldButtons: 0xffff, pressedActions: [{ actionId: 3, kind: 'jump' }] });
    const parsed = InputWireSchema.parse(w);
    const i = decodeInput(parsed);
    expect(Math.hypot(i.moveX, i.moveY)).toBeCloseTo(1, 5); // diagonal normalizada
    expect(i.heldButtons).toBe(BUTTON_MASK); // bits desconhecidos descartados
    expect(i.pressedActions[0]).toEqual({ actionId: 3, kind: 'jump' });
  });

  it('valores extremos são limitados; NaN/Infinity e formatos inválidos são rejeitados', () => {
    const i = decodeInput(InputWireSchema.parse([1, 1, 50, -50, 99, 99, 1, []]));
    expect(Math.abs(i.moveX)).toBeLessThanOrEqual(1);
    expect(i.pitch).toBe(PITCH_LIMIT);
    expect(Math.abs(i.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(InputWireSchema.safeParse([1, 1, NaN, 0, 0, 0, 0, []]).success).toBe(false);
    expect(InputWireSchema.safeParse([1, 1, Infinity, 0, 0, 0, 0, []]).success).toBe(false);
    expect(InputWireSchema.safeParse([1, 1, 0, 0, 0, 0, 0, Array.from({ length: 50 }, (_, k) => [k, 0])]).success).toBe(false);
    expect(InputWireSchema.safeParse([1, 1, 0, 0, 0, 0, 0, [[1, 99]]]).success).toBe(false);
    expect(InputWireSchema.safeParse({ x: 1 }).success).toBe(false);
    expect(InputWireSchema.safeParse([-1, 1, 0, 0, 0, 0, 0, []]).success).toBe(false);
  });

  it('mensagens de controle rejeitam campos extras e valores fora do enum', () => {
    expect(SetTeamSchema.safeParse({ team: 2 }).success).toBe(false);
    expect(SetTeamSchema.safeParse({ team: 0, hp: 999 }).success).toBe(false);
    expect(JoinOptionsSchema.safeParse({ activitySessionId: 's', credential: 'curta', clientVersion: '1', mapHash: 'x' }).success).toBe(false);
  });
});
