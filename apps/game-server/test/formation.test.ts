import { describe, expect, it } from 'vitest';
import type { TeamId } from '@borrifo/game-contracts';
import { planFormation, type FormationCandidate } from '../src/formation';

const people = (n: number, pref: (i: number) => TeamId = (i) => (i % 2) as TeamId, sitOuts: (i: number) => number = () => 0): FormationCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ playerId: i + 1, team: pref(i), joinOrder: i, sitOuts: sitOuts(i) }));

describe('formação flexível', () => {
  it.each([
    [2, 1],
    [4, 2],
    [6, 3],
    [8, 4],
    [10, 5],
    [12, 6],
    [14, 7],
    [16, 8],
  ])('%i pessoas sem bots → %i × %i', (n, size) => {
    const f = planFormation(people(n), 'flex', false);
    expect(f.teamSize).toBe(size);
    expect(f.humans).toEqual([size, size]);
    expect(f.bots).toEqual([0, 0]);
    expect(f.queue).toEqual([]);
    expect(f.active).toBe(n);
  });

  it('ímpar com bots: 5 pessoas jogam 3 × 3 com um bot identificado', () => {
    const f = planFormation(people(5), 'flex', true);
    expect(f.teamSize).toBe(3);
    expect(f.humans[0] + f.humans[1]).toBe(5);
    expect(f.bots[0] + f.bots[1]).toBe(1);
    expect(f.queue).toEqual([]);
  });

  it('ímpar sem bots: equipes equilibradas e uma vaga de fila (a última pessoa a chegar)', () => {
    const f = planFormation(people(7), 'flex', false);
    expect(f.teamSize).toBe(3);
    expect(f.humans).toEqual([3, 3]);
    expect(f.queue).toEqual([7]);
  });

  it('quem ficou na fila tem prioridade na revanche (rotação)', () => {
    const f = planFormation(people(7, undefined, (i) => (i === 6 ? 1 : 0)), 'flex', false);
    expect(f.queue).not.toContain(7);
    expect(f.queue).toEqual([6]);
  });

  it('uma pessoa: sem bots não começa; com bots, treino 1 × 1', () => {
    expect(planFormation(people(1), 'flex', false).blocked).toMatch(/bots/);
    const f = planFormation(people(1), 'flex', true);
    expect(f.teamSize).toBe(1);
    expect(f.bots[0] + f.bots[1]).toBe(1);
  });

  it('respeita a equipe preferida enquanto há vaga; excedente vai para a outra', () => {
    const f = planFormation(people(6, () => 0), 'flex', false);
    expect(f.humans).toEqual([3, 3]);
    expect([1, 2, 3].map((id) => f.teamOf.get(id))).toEqual([0, 0, 0]);
    expect([4, 5, 6].map((id) => f.teamOf.get(id))).toEqual([1, 1, 1]);
  });
});

describe('limites fixos', () => {
  it('2 × 2 com 7 pessoas: 4 jogam, 3 na fila', () => {
    const f = planFormation(people(7), 2, false);
    expect(f.teamSize).toBe(2);
    expect(f.queue.length).toBe(3);
  });
  it('8 × 8 com 3 pessoas e bots: completa com 13 bots', () => {
    const f = planFormation(people(3), 8, true);
    expect(f.active).toBe(16);
    expect(f.bots[0] + f.bots[1]).toBe(13);
  });
  it('8 × 8 com 3 pessoas sem bots: joga 1 × 1 equilibrado, 1 na fila', () => {
    const f = planFormation(people(3), 8, false);
    expect(f.teamSize).toBe(1);
    expect(f.queue.length).toBe(1);
  });
  it('3 × 3 e 7 × 7 intermediários', () => {
    expect(planFormation(people(6), 3, false).active).toBe(6);
    expect(planFormation(people(14), 7, false).active).toBe(14);
    expect(planFormation(people(20), 'flex', false).teamSize).toBe(8); // nunca passa de 8 × 8
    expect(planFormation(people(20), 'flex', false).queue.length).toBe(4);
  });
});
