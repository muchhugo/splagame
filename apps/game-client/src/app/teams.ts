/**
 * Apresentação das equipes num só lugar: nome, símbolo e cor vêm do par que o
 * servidor escolheu para a rodada (ou da paleta de acessibilidade local). A
 * interface nunca decide nada por RGB; TeamId continua sendo a identidade.
 */
import { TEAMS, type TeamId } from '@borrifo/game-contracts';
import { useStore } from './store';
import { settingsStore, teamColorsFor, teamNamesFor } from './settings';
import { uiStore } from './uiStore';

export interface TeamView {
  name: string;
  symbol: string;
  color: string;
}

export function teamViews(palette = settingsStore.get().palette, pairId = uiStore.get().lobby?.teamPairId): [TeamView, TeamView] {
  const colors = teamColorsFor(palette, pairId);
  const names = teamNamesFor(palette, pairId);
  return [0, 1].map((t) => ({ name: names[t], symbol: TEAMS[t as TeamId].symbol, color: colors[t] })) as [TeamView, TeamView];
}

export function useTeams(): [TeamView, TeamView] {
  const palette = useStore(settingsStore, (s) => s.palette);
  const pairId = useStore(uiStore, (s) => s.lobby?.teamPairId);
  return teamViews(palette, pairId);
}
