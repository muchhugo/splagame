export type TeamId = 0 | 1;
/** -1 = neutro. */
export type PaintOwner = -1 | TeamId;
export const NEUTRAL: PaintOwner = -1;

export const TEAM_IDS: readonly TeamId[] = [0, 1];

export interface TeamPresentation {
  id: TeamId;
  name: string;
  symbol: string;
  /** Descrição do padrão da tinta, usado quando o modo de padrões está ativo. */
  pattern: 'listras' | 'pontos';
}

/** Apresentação é independente da cor; a paleta de render fica no cliente. */
export const TEAMS: Record<TeamId, TeamPresentation> = {
  0: { id: 0, name: 'Urucum', symbol: '▲', pattern: 'listras' },
  1: { id: 1, name: 'Anil', symbol: '●', pattern: 'pontos' },
};

export function otherTeam(t: TeamId): TeamId {
  return t === 0 ? 1 : 0;
}

export function isTeamId(v: unknown): v is TeamId {
  return v === 0 || v === 1;
}
