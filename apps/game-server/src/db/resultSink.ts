import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { RoundResult } from '@borrifo/game-contracts';
import { log } from '../logger';
import type { ResultSink } from '../results';
import { roundResults } from './schema';

/**
 * Resultado no PostgreSQL (Drizzle). A idempotência é do BANCO (constraint única em
 * (match_id, round_id) + ON CONFLICT DO NOTHING): vale entre processos e reinícios, não só
 * na memória deste servidor. Falha de banco sobe como erro; a sala registra
 * `result.persist_failed` e segue (a rodada não cai por causa do banco).
 */
export class PostgresResultSink implements ResultSink {
  constructor(private readonly db: PgDatabase<PgQueryResultHKT, Record<string, never>>) {}

  async write(activitySessionId: string, result: RoundResult): Promise<'written' | 'duplicate'> {
    const rows = await this.db
      .insert(roundResults)
      .values({
        activitySessionId,
        matchId: result.matchId,
        roundId: result.roundId,
        mapId: result.mapId,
        mode: result.mode,
        status: result.status,
        winner: result.winner === 'draw' ? 'draw' : (String(result.winner) as '0' | '1'),
        teamUnits: result.teamUnits,
        totalUnits: result.totalUnits,
        percent: result.percent,
        deliveries: result.deliveries,
        players: result.players.map((p) => ({ playerId: p.playerId, team: p.team, isBot: p.isBot, paintedArea: p.paintedArea, eliminations: p.eliminations, deaths: p.deaths })),
      })
      .onConflictDoNothing({ target: [roundResults.matchId, roundResults.roundId] })
      .returning({ id: roundResults.id });
    if (rows.length === 0) return 'duplicate';
    log('info', 'result.persisted', { activitySessionId, matchId: result.matchId, roundId: result.roundId, winner: result.winner, store: 'postgres' });
    return 'written';
  }
}
