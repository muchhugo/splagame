import { describe, expect, it } from 'vitest';
import { PFLAG_ALIVE, PFLAG_CHARGING, PFLAG_EMBALO, PFLAG_FIRING, PFLAG_HIDDEN, PFLAG_SUBMERGED, type RemotePlayerTuple, type TeamId } from '@borrifo/game-contracts';
import { STEALTH } from '@borrifo/game-content';
import { StealthFilter, type StealthSubject } from '../src/visibility';

const DT = 1 / 15;
type P = { id: number; team: TeamId; pos: [number, number, number]; speed?: number; submerged?: boolean; alive?: boolean; carrier?: boolean; exposed?: boolean; flags?: number };
const subj = (p: P): StealthSubject => ({ id: p.id, team: p.team, alive: p.alive ?? true, submerged: p.submerged ?? false, pos: p.pos, speed: p.speed ?? 0, carrier: p.carrier ?? false, exposedByState: p.exposed ?? false });
const tup = (p: P): RemotePlayerTuple => [p.id, Math.round(p.pos[0] * 100), Math.round(p.pos[1] * 100), Math.round(p.pos[2] * 100), 1234, 321, 1, p.flags ?? PFLAG_ALIVE | PFLAG_SUBMERGED, 87, 55, Math.round((p.speed ?? 0) * 100), 0];

function run(f: StealthFilter, ps: P[], seconds: number) {
  let out: RemotePlayerTuple[] = [];
  for (let t = 0; t < seconds - 1e-9; t += DT) out = f.update(ps.map(subj), ps.map(tup), DT);
  return out;
}

describe('filtragem de quem está imerso (regras)', () => {
  const foe: P = { id: 1, team: 0, pos: [0, 0, 0] };
  it('imerso parado longe do adversário some depois do atraso; a tupla oculta é a última vista, sem ação nem velocidade', () => {
    const f = new StealthFilter();
    const sub: P = { id: 2, team: 1, pos: [10, 0, 0], submerged: true, flags: PFLAG_ALIVE | PFLAG_SUBMERGED | PFLAG_FIRING | PFLAG_CHARGING | PFLAG_EMBALO };
    let out = run(f, [foe, sub], STEALTH.concealDelay - 0.1);
    expect(out[1][7] & PFLAG_HIDDEN).toBe(0);
    out = run(f, [foe, sub], 0.2);
    const h = out[1];
    expect(h[7] & PFLAG_HIDDEN).toBeTruthy();
    expect([h[1], h[2], h[3]]).toEqual([1000, 0, 0]);
    expect([h[5], h[9], h[10], h[11]]).toEqual([0, 0, 0, 0]);
    expect(h[7] & (PFLAG_FIRING | PFLAG_CHARGING)).toBe(0);
    expect(h[7] & PFLAG_EMBALO).toBeTruthy(); // público, não é posição
    // anda devagar (abaixo da ondulação): a posição enviada continua congelada
    const moved: P = { ...sub, pos: [11.3, 0, 0.8], speed: STEALTH.revealSpeed - 0.2 };
    out = run(f, [foe, moved], 1);
    expect([out[1][1], out[1][2], out[1][3]]).toEqual([1000, 0, 0]);
    expect(f.isHidden(2)).toBe(true);
  });

  it('volta a ser visível na hora: ondulação, perto do adversário, cápsula, evento, fora da tinta ou morto', () => {
    const cases: Array<[string, (s: P) => P, ((f: StealthFilter) => void)?]> = [
      ['ondulação', (s) => ({ ...s, speed: STEALTH.revealSpeed + 0.1 })],
      ['perto', (s) => ({ ...s, pos: [STEALTH.revealRadius - 0.2, 0, 0] })],
      ['cápsula', (s) => ({ ...s, carrier: true })],
      ['fora da tinta', (s) => ({ ...s, submerged: false })],
      ['morto', (s) => ({ ...s, alive: false })],
      ['proteção/deslocamento', (s) => ({ ...s, exposed: true })],
      ['levou dano', (s) => s, (f) => f.observe({ k: 'hit', src: 1, dst: 2, dmg: 30, lethal: false })],
      ['pegou buff', (s) => s, (f) => f.observe({ k: 'buff', pid: 2, kind: 'embalo', replaced: null, pickup: 0 })],
      ['Mutirão', (s) => s, (f) => f.observe({ k: 'mutirao', a: 9, b: 2, team: 1, p: [0, 0, 0] })],
    ];
    for (const [label, change, ev] of cases) {
      const f = new StealthFilter();
      const sub: P = { id: 2, team: 1, pos: [10, 0, 0], submerged: true };
      run(f, [foe, sub], 1);
      expect(f.isHidden(2), label).toBe(true);
      ev?.(f);
      const now = change(sub);
      const out = f.update([foe, now].map(subj), [foe, now].map(tup), DT);
      expect(out[1][7] & PFLAG_HIDDEN, label).toBe(0);
      expect([out[1][1], out[1][3]], label).toEqual([Math.round(now.pos[0] * 100), Math.round(now.pos[2] * 100)]);
    }
  });

  it('dano revela por um tempo e depois esconde de novo; adversário morto não denuncia', () => {
    const f = new StealthFilter();
    const sub: P = { id: 2, team: 1, pos: [10, 0, 0], submerged: true };
    run(f, [foe, sub], 1);
    f.observe({ k: 'hit', src: 1, dst: 2, dmg: 10, lethal: false });
    run(f, [foe, sub], STEALTH.eventReveal - 0.1);
    expect(f.isHidden(2)).toBe(false);
    run(f, [foe, sub], STEALTH.concealDelay + 0.3);
    expect(f.isHidden(2)).toBe(true);
    // adversário morto ao lado não conta
    const g = new StealthFilter();
    const deadFoe: P = { ...foe, pos: [9.5, 0, 0], alive: false };
    run(g, [deadFoe, sub], 1);
    expect(g.isHidden(2)).toBe(true);
    // aliado ao lado não revela
    const ally: P = { id: 3, team: 1, pos: [9.5, 0, 0] };
    const h = new StealthFilter();
    run(h, [foe, ally, sub], 1);
    expect(h.isHidden(2)).toBe(true);
  });

  it('sem ter sido visto antes não esconde (não há posição congelada para mandar); reset e saída limpam', () => {
    const f = new StealthFilter();
    const sub: P = { id: 2, team: 1, pos: [10, 0, 0], submerged: true };
    run(f, [foe, sub], 1);
    expect(f.isHidden(2)).toBe(true);
    f.reset();
    expect(f.isHidden(2)).toBe(false);
    run(f, [foe, sub], 1);
    f.remove(2);
    expect(f.isHidden(2)).toBe(false);
  });
});
