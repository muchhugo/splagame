import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { C2S, type RoundResult } from '@borrifo/game-contracts';
import { HeadlessClient, issueDevCredential, TEST_DEV_SECRET } from '@borrifo/test-utils';
import { PostgresResultSink } from '../src/db/resultSink';
import { MIGRATIONS_FOLDER } from '../src/db/postgres';
import { loadConfig } from '../src/config';
import { MAP_HASH } from './helpers';
import { startGameServer, type StartedServer } from '../src/server';

// PostgreSQL de verdade (PGlite: o Postgres compilado para WASM, no processo), com as
// MESMAS migrações que vão para produção. Nada de banco externo.
let client: PGlite;
let db: ReturnType<typeof drizzle>;
beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
});
afterAll(async () => {
  await client.close();
});

const result = (matchId: string, roundId: number, winner: RoundResult['winner'] = 0): RoundResult => ({
  matchId,
  roundId,
  mapId: 'toca-do-ara-padrao',
  mode: 'territorio',
  deliveries: [0, 0],
  totalArea: 100,
  teamArea: [40, 30],
  neutralArea: 30,
  teamUnits: [400, 300],
  totalUnits: 1000,
  percent: [40, 30],
  neutralPercent: 30,
  winner,
  endedAtTick: 5400,
  players: [{ playerId: 1, displayName: 'Ana', team: 0, isBot: false, weaponId: 'esguicho', paintedArea: 12.5, eliminations: 2, deaths: 1, specialsUsed: 0, deliveries: 0, mutiroes: 0 }],
  status: 'completed',
});
const count = async (matchId: string) => (await client.query<{ n: number }>('select count(*)::int as n from round_results where match_id = $1', [matchId])).rows[0].n;

describe('resultado no PostgreSQL (Drizzle)', () => {
  it('grava uma vez; repetir a mesma rodada não duplica', async () => {
    const sink = new PostgresResultSink(db as never);
    expect(await sink.write('sessao-1', result('m-1', 1))).toBe('written');
    expect(await sink.write('sessao-1', result('m-1', 1))).toBe('duplicate');
    expect(await sink.write('sessao-1', result('m-1', 2, 'draw'))).toBe('written');
    expect(await count('m-1')).toBe(2);
    const row = (await client.query<Record<string, unknown>>('select * from round_results where match_id = $1 and round_id = 2', ['m-1'])).rows[0];
    expect(row.winner).toBe('draw');
    expect(row.activity_session_id).toBe('sessao-1');
    expect(row.team_units).toEqual([400, 300]);
    expect((row.players as Array<Record<string, unknown>>)[0]).toEqual({ playerId: 1, team: 0, isBot: false, paintedArea: 12.5, eliminations: 2, deaths: 1 });
    // só o necessário: o nome de exibição não vai para o banco
    expect(JSON.stringify(row.players)).not.toContain('Ana');
  });

  it('dez gravações simultâneas da mesma rodada (e outro processo) resultam em uma linha', async () => {
    const a = new PostgresResultSink(db as never);
    const b = new PostgresResultSink(db as never); // "outro servidor" no mesmo banco
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).write('sessao-2', result('m-2', 1))));
    expect(out.filter((x) => x === 'written').length).toBe(1);
    expect(out.filter((x) => x === 'duplicate').length).toBe(9);
    expect(await count('m-2')).toBe(1);
  });

  it('falha do banco vira erro (a sala registra result.persist_failed e segue)', async () => {
    const other = new PGlite();
    const odb = drizzle(other);
    await migrate(odb, { migrationsFolder: MIGRATIONS_FOLDER });
    const sink = new PostgresResultSink(odb as never);
    await other.close();
    await expect(sink.write('sessao-3', result('m-3', 1))).rejects.toThrow();
  });
});

describe('servidor de partidas gravando no PostgreSQL', () => {
  let srv: StartedServer;
  let url: string;
  beforeAll(async () => {
    const port = 30000 + Math.floor(Math.random() * 20000);
    const cfg = loadConfig({ NODE_ENV: 'test', MATCH_AUTH_MODE: 'dev-hs256', DEV_MATCH_CREDENTIAL_SECRET: TEST_DEV_SECRET, GAME_SERVER_HOST: '127.0.0.1', ROUND_DURATION_SECONDS: '3' } as NodeJS.ProcessEnv);
    srv = await startGameServer(cfg, { sink: new PostgresResultSink(db as never), port });
    url = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await srv.shutdown();
  });

  it('uma rodada completa vira exatamente uma linha no banco, com o resultado que os clientes receberam', async () => {
    const sid = `sessao-pg-${Date.now().toString(36)}`;
    const c = new HeadlessClient(url);
    await c.join({ activitySessionId: sid, credential: await issueDevCredential(TEST_DEV_SECRET, { userId: 'u-pg', name: 'PG', activitySessionId: sid }), mapHash: MAP_HASH });
    await c.waitFor(() => c.welcome && c.lobby, 5000, 'welcome');
    c.send(C2S.START, {});
    const res = await c.waitFor(() => c.results[0], 30000, 'resultado');
    // a gravação é assíncrona depois do anúncio
    for (let i = 0; i < 50 && (await count(res.matchId)) === 0; i++) await new Promise((r) => setTimeout(r, 50));
    const rows = (await client.query<Record<string, unknown>>('select * from round_results where match_id = $1', [res.matchId])).rows;
    expect(rows.length).toBe(1);
    expect(rows[0].round_id).toBe(res.roundId);
    expect(rows[0].team_units).toEqual(res.teamUnits);
    expect(rows[0].winner).toBe(String(res.winner));
    expect(rows[0].activity_session_id).toBe(sid);
    await c.leave();
  }, 45000);
});

describe('configuração da persistência', () => {
  const base = { MATCH_AUTH_MODE: 'jwks', MATCH_CREDENTIAL_JWKS_URL: 'https://exemplo.invalid/jwks' } as NodeJS.ProcessEnv;
  it('produção exige PostgreSQL e DATABASE_URL; JSONL só no laboratório', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', RESULT_SINK: 'jsonl' })).toThrow(/laboratório/);
    expect(loadConfig({ ...base, NODE_ENV: 'production', DATABASE_URL: 'postgres://u@h/db' }).resultSink).toBe('postgres');
    expect(loadConfig({ NODE_ENV: 'development', DEV_MATCH_CREDENTIAL_SECRET: TEST_DEV_SECRET }).resultSink).toBe('jsonl');
    expect(() => loadConfig({ NODE_ENV: 'development', DEV_MATCH_CREDENTIAL_SECRET: TEST_DEV_SECRET, RESULT_SINK: 'mongo' })).toThrow(/RESULT_SINK/);
  });
});
