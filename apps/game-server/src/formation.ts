import { MAX_TEAM_SIZE, type FormationOption, type TeamId } from '@borrifo/game-contracts';

export interface FormationCandidate {
  playerId: number;
  /** Equipe preferida (escolhida no lobby). */
  team: TeamId;
  /** Ordem de chegada (menor = chegou antes). */
  joinOrder: number;
  /** Quantas rodadas seguidas ficou na fila: tem prioridade na próxima. */
  sitOuts: number;
}

export interface Formation {
  teamSize: number;
  teamOf: Map<number, TeamId>;
  humans: [number, number];
  bots: [number, number];
  queue: number[];
  active: number;
  blocked: string | null;
}

/**
 * Formação da próxima rodada (função pura, determinística).
 *
 * - Flex: com bots, ⌈n/2⌉ por equipe (a menor é completada por bots identificados);
 *   sem bots, ⌊n/2⌋ por equipe e quem sobra (número ímpar) vai para a fila.
 * - Limite fixo k: com bots, k × k completado por bots; sem bots, até k por equipe,
 *   sempre equilibrado; excedentes vão para a fila.
 * - Uma pessoa sem bots não começa (não se anuncia um duelo humano inexistente).
 * - Prioridade para jogar: quem ficou mais vezes na fila, depois ordem de chegada.
 *   A preferência de equipe é respeitada enquanto houver vaga; senão vai para a outra.
 */
export function planFormation(cands: readonly FormationCandidate[], option: FormationOption, fillWithBots: boolean): Formation {
  const n = cands.length;
  let size: number;
  if (option === 'flex') size = fillWithBots ? Math.ceil(n / 2) : Math.floor(n / 2);
  else size = fillWithBots ? option : Math.min(option, Math.floor(n / 2));
  size = Math.max(0, Math.min(MAX_TEAM_SIZE, size));
  if (fillWithBots && n > 0) size = Math.max(1, size);

  const order = [...cands].sort((a, b) => b.sitOuts - a.sitOuts || a.joinOrder - b.joinOrder || a.playerId - b.playerId);
  const seats = size * 2;
  const playing = order.slice(0, Math.min(seats, n));
  const queue = order.slice(playing.length).map((c) => c.playerId);
  const teamOf = new Map<number, TeamId>();
  const count: [number, number] = [0, 0];
  for (const c of playing) {
    const t: TeamId = count[c.team] < size ? c.team : c.team === 0 ? 1 : 0;
    teamOf.set(c.playerId, t);
    count[t]++;
  }
  const bots: [number, number] = fillWithBots ? [size - count[0], size - count[1]] : [0, 0];
  let blocked: string | null = null;
  if (n === 0) blocked = 'Ninguém pronto para jogar.';
  else if (size === 0) blocked = 'Com uma pessoa, ative os bots para treinar.';
  return { teamSize: size, teamOf, humans: count, bots, queue, active: size * 2, blocked };
}
