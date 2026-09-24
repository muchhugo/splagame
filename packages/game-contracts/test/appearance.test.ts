import { describe, expect, it } from 'vitest';
import { APPEARANCE_IDS, SetAppearanceSchema, formatAppearanceId, isAppearanceId, parseAppearanceId } from '../src/index';

describe('aparência: base, pele, cabelo e cor', () => {
  it('forma legado vale e usa o cabelo original da base', () => {
    for (const a of APPEARANCE_IDS) expect(isAppearanceId(a)).toBe(true);
    expect(parseAppearanceId('a2')).toEqual({ base: 'a', tone: 2, hair: 0, hairColor: 0 });
    expect(parseAppearanceId('b0')).toEqual({ base: 'b', tone: 0, hair: 1, hairColor: 1 });
  });
  it('forma completa ida e volta, com limites', () => {
    for (const base of ['a', 'b'] as const)
      for (let tone = 0; tone < 4; tone++)
        for (let hair = 0; hair < 4; hair++)
          for (let hairColor = 0; hairColor < 6; hairColor++) {
            const id = formatAppearanceId({ base, tone, hair, hairColor });
            expect(isAppearanceId(id)).toBe(true);
            expect(parseAppearanceId(id)).toEqual({ base, tone, hair, hairColor });
          }
    expect(formatAppearanceId({ base: 'a', tone: 9, hair: -3, hairColor: 99 })).toBe('a3h0c5');
  });
  it('recusa o que não é aparência (sem virar texto livre no lobby)', () => {
    for (const bad of ['z9', 'a4', 'a1h4c0', 'a1h0c6', 'a1h0', '<b>a1', 'a1h0c0x', '', 'A1']) {
      expect(isAppearanceId(bad)).toBe(false);
      expect(SetAppearanceSchema.safeParse({ appearance: bad }).success).toBe(false);
    }
    expect(SetAppearanceSchema.safeParse({ appearance: 'b2h3c5' }).success).toBe(true);
    expect(SetAppearanceSchema.safeParse({ appearance: 'b2h3c5', hitbox: 2 }).success).toBe(false);
    expect(parseAppearanceId('lixo')).toEqual(parseAppearanceId('a1'));
  });
});
