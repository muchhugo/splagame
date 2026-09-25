import { describe, expect, it } from 'vitest';
import { PFLAG_ALIVE, PFLAG_HIDDEN, PFLAG_SUBMERGED, type RemotePlayerTuple } from '@borrifo/game-contracts';
import { RemoteInterpolator } from '../src/game/prediction/RemoteInterpolator';

const tup = (x: number, flags: number, vx = 0): RemotePlayerTuple => [7, x * 100, 0, 0, 0, 0, 1, flags, 100, 0, vx * 100, 0];

describe('interpolação de remotos com filtragem de imersos', () => {
  it('não desliza da posição congelada (oculto) até a real ao revelar, nem ao esconder', () => {
    const it = new RemoteInterpolator();
    const hidden = PFLAG_ALIVE | PFLAG_SUBMERGED | PFLAG_HIDDEN;
    const shown = PFLAG_ALIVE | PFLAG_SUBMERGED;
    it.push(100, 0, [tup(0, hidden)]);
    it.push(102, 66, [tup(3, shown, 2)]);
    // no meio do intervalo: já na posição revelada, com as marcas da amostra nova
    const mid = it.sample(7, 101)!;
    expect(mid.pos[0]).toBe(3);
    expect(mid.flags & PFLAG_HIDDEN).toBe(0);
    // e ao esconder de novo: a pose congelada vale de uma vez
    it.push(104, 133, [tup(3, hidden)]);
    const mid2 = it.sample(7, 103)!;
    expect(mid2.flags & PFLAG_HIDDEN).toBeTruthy();
  });

  it('entre duas amostras visíveis continua interpolando', () => {
    const it = new RemoteInterpolator();
    it.push(100, 0, [tup(0, PFLAG_ALIVE)]);
    it.push(102, 66, [tup(2, PFLAG_ALIVE)]);
    expect(it.sample(7, 101)!.pos[0]).toBeCloseTo(1, 5);
  });

  it('oculto não extrapola (a tupla oculta vem sem velocidade)', () => {
    const it = new RemoteInterpolator();
    it.push(100, 0, [tup(5, PFLAG_ALIVE | PFLAG_SUBMERGED | PFLAG_HIDDEN)]);
    expect(it.sample(7, 103)!.pos[0]).toBe(5);
  });
});
