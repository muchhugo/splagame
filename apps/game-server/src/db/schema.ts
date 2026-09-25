import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { PlayerRoundStats, TeamId } from '@borrifo/game-contracts';

/**
 * Resultado agregado de cada rodada, gravado só pelo servidor de partidas.
 * Idempotência no banco: (match_id, round_id) é único; gravar de novo não duplica.
 * Sem dado pessoal além do que a rodada precisa: ids de jogador da sala (não do Trivo).
 */
export const roundResults = pgTable(
  'round_results',
  {
    id: serial('id').primaryKey(),
    activitySessionId: text('activity_session_id').notNull(),
    matchId: text('match_id').notNull(),
    roundId: integer('round_id').notNull(),
    mapId: text('map_id').notNull(),
    mode: text('mode').notNull(),
    status: text('status').$type<'completed' | 'interrupted'>().notNull(),
    winner: text('winner').$type<`${TeamId}` | 'draw'>().notNull(),
    teamUnits: jsonb('team_units').$type<[number, number]>().notNull(),
    totalUnits: integer('total_units').notNull(),
    percent: jsonb('percent').$type<[number, number]>().notNull(),
    deliveries: jsonb('deliveries').$type<[number, number]>().notNull(),
    players: jsonb('players').$type<Array<Pick<PlayerRoundStats, 'playerId' | 'team' | 'isBot' | 'paintedArea' | 'eliminations' | 'deaths'>>>().notNull(),
    writtenAt: timestamp('written_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('round_results_match_round_uq').on(t.matchId, t.roundId)],
);
