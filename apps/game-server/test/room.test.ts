import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { C2S } from '@borrifo/game-contracts';
import { HeadlessClient, issueDevCredential, TEST_DEV_SECRET } from '@borrifo/test-utils';
import { PATIO_DA_OLARIA } from '@borrifo/game-content';
import { PaintLayout, PaintReplica } from '@borrifo/game-simulation';
import { MAP_HASH, startTestServer } from './helpers';
import type { StartedServer } from '../src/server';
import type { MemoryResultSink } from '../src/results';

let srv: { s: StartedServer; url: string; sink: MemoryResultSink };
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.s.shutdown();
});

describe('sala de partida pelo transporte real', () => {
  it('um humano + bots joga uma rodada completa e a réplica de tinta confere com o resultado', async () => {
    const sid = 'sessao-int-1';
    const a = new HeadlessClient(srv.url);
    await a.join({ activitySessionId: sid, credential: await issueDevCredential(TEST_DEV_SECRET, { userId: 'u-ana', name: 'Ana', activitySessionId: sid }), mapHash: MAP_HASH });
    await a.waitFor(() => a.welcome && a.lobby, 5000, 'welcome');
    expect(a.lobby!.hostPlayerId).toBe(a.welcome!.playerId);
    a.send(C2S.START, {});
    await a.waitFor(() => a.lobby?.phase === 'running', 20000, 'running');
    expect(a.lobby!.players.filter((p) => p.isBot).length).toBe(7);
    // envia entradas: anda para frente e atira
    const layout = PaintLayout.build(PATIO_DA_OLARIA);
    const timer = setInterval(() => a.sendInput({ moveY: 1, yaw: Math.PI / 2, pitch: 0.3, heldButtons: 1 }), 33);
    await a.waitFor(() => a.results.length > 0, 20000, 'resultado');
    clearInterval(timer);
    const result = a.results[0];
    // Reconstrói a tinta a partir do snapshot + deltas recebidos
    const replica = new PaintReplica(layout);
    const snap = a.paintSnapshots[a.paintSnapshots.length - 1];
    replica.expectRound(result.roundId, snap.contextTag);
    replica.receiveSnapshot(snap);
    for (const d of a.paintDeltas) replica.receiveDelta(d);
    expect(replica.status).toBe('synced');
    expect(replica.state.teamUnits).toEqual(result.teamUnits);
    expect(result.teamUnits[0] + result.teamUnits[1]).toBeGreaterThan(0);
    expect(result.percent[0] + result.percent[1] + result.neutralPercent).toBeCloseTo(100, 0);
    // meu jogador se moveu de acordo com o servidor
    expect(a.lastSnapshot!.me).not.toBeNull();
    expect(a.lastSnapshot!.ack).toBeGreaterThan(10);
    // resultado persistido uma vez
    expect(srv.sink.rows.size).toBe(1);
    await a.leave();
  });
});
