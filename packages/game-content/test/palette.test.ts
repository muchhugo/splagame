import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENERY_TOKENS, TEAM_PAIRS, TRIVO_SVG, UI_TOKENS, colorDistance, pickTeamPair, simulateCvd, teamPair } from '../src/palette';

const scenery = [...SCENERY_TOKENS.bandeirinhas, SCENERY_TOKENS.araraAzul, SCENERY_TOKENS.araraAmarelo, SCENERY_TOKENS.araraVerde, SCENERY_TOKENS.toldo, SCENERY_TOKENS.madeira, SCENERY_TOKENS.terracota];

describe('tokens de cor', () => {
  it('marca: são exatamente os preenchimentos de `trivo logo.svg`', () => {
    const svg = readFileSync(new URL('../../../trivo logo.svg', import.meta.url), 'utf8');
    const fills = new Set([...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase()));
    expect(new Set(Object.values(TRIVO_SVG))).toEqual(fills);
  });

  for (const p of TEAM_PAIRS) {
    describe(`par ${p.id}`, () => {
      const [a, b] = p.teams.map((t) => t.color);
      it('as duas equipes se distinguem, inclusive sob daltonismo simulado', () => {
        expect(colorDistance(a, b)).toBeGreaterThan(0.3);
        for (const k of ['protan', 'deutan', 'tritan'] as const) expect(colorDistance(simulateCvd(a, k), simulateCvd(b, k))).toBeGreaterThan(0.2);
      });
      it('nenhuma cor de equipe se confunde com o cenário nem com a marca', () => {
        for (const t of [a, b]) {
          for (const s of scenery) expect(colorDistance(t, s), `${t} × cenário ${s}`).toBeGreaterThan(0.08);
          for (const s of Object.values(TRIVO_SVG)) expect(colorDistance(t, s), `${t} × marca ${s}`).toBeGreaterThan(0.08);
          expect(colorDistance(t, UI_TOKENS.destaque)).toBeGreaterThan(0.1);
        }
      });
      it('nomes curtos e distintos', () => {
        expect(p.teams[0].name).not.toBe(p.teams[1].name);
        for (const t of p.teams) expect(t.name.length).toBeLessThanOrEqual(10);
      });
    });
  }

  it('a arara do cenário não parece a equipe azul', () => {
    const blues = TEAM_PAIRS.flatMap((p) => p.teams.map((t) => t.color));
    for (const c of blues) expect(colorDistance(SCENERY_TOKENS.araraAzul, c)).toBeGreaterThan(0.1);
  });

  it('servidor: par determinístico por semente, muda a cada rodada e id desconhecido cai no padrão', () => {
    expect(pickTeamPair(7, 3).id).toBe(pickTeamPair(7, 3).id);
    for (let r = 1; r < 10; r++) expect(pickTeamPair(7, r).id).not.toBe(pickTeamPair(7, r + 1).id);
    expect(teamPair('nao-existe').id).toBe(TEAM_PAIRS[0].id);
  });
});
