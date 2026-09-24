import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { C2S, CloseCodes, MATCH_ROOM_NAME, encodeInput, neutralInput } from '@borrifo/game-contracts';
import { HeadlessClient, issueDevCredential, TEST_DEV_SECRET, type DevCredentialInput } from '@borrifo/test-utils';
import { MAP_HASH, startTestServer } from './helpers';
import type { StartedServer } from '../src/server';
import type { MemoryResultSink } from '../src/results';
import { ArenaRoom } from '../src/rooms/ArenaRoom';
import { KeyedRateLimiter } from '../src/rateLimit';

let srv: { s: StartedServer; url: string; sink: MemoryResultSink };
beforeAll(async () => {
  srv = await startTestServer({ ROUND_DURATION_SECONDS: '4', JOIN_RATE_BURST: '500', JOIN_RATE_PER_SECOND: '100' });
});
afterAll(async () => {
  await srv.s.shutdown();
});

let sidCounter = 0;
const newSid = () => `sessao-rede-${++sidCounter}-${Date.now().toString(36)}`;
const cred = (userId: string, sid: string, extra: Partial<DevCredentialInput> = {}) => issueDevCredential(TEST_DEV_SECRET, { userId, name: userId.toUpperCase(), activitySessionId: sid, ...extra });

async function join(userId: string, sid: string, extra: Partial<DevCredentialInput> = {}) {
  const c = new HeadlessClient(srv.url);
  await c.join({ activitySessionId: sid, credential: await cred(userId, sid, extra), mapHash: MAP_HASH });
  await c.waitFor(() => c.welcome && c.lobby, 5000, `welcome ${userId}`);
  return c;
}

describe('ingresso, vagas e lobby', () => {
  it('ingressos simultâneos caem na mesma sala, com equipes equilibradas e um anfitrião', async () => {
    const sid = newSid();
    const clients = await Promise.all(['u1', 'u2', 'u3', 'u4'].map((u) => join(u, sid)));
    const roomIds = new Set(clients.map((c) => c.room!.roomId));
    expect(roomIds.size).toBe(1);
    const last = clients[0];
    await last.waitFor(() => last.lobby!.players.length === 4, 3000, '4 no lobby');
    const teams = last.lobby!.players.map((p) => p.team);
    expect(teams.filter((t) => t === 0).length).toBe(2);
    expect(last.lobby!.hostPlayerId).not.toBeNull();
    await Promise.all(clients.map((c) => c.leave()));
  });

  it('bloqueia a nona pessoa e valida troca de equipe e comandos de anfitrião', async () => {
    const sid = newSid();
    const clients: HeadlessClient[] = [];
    for (let i = 0; i < 8; i++) clients.push(await join(`v${i}`, sid));
    await expect(join('v9', sid)).rejects.toThrow();
    const host = clients.find((c) => c.welcome!.playerId === c.lobby!.hostPlayerId)!;
    const guest = clients.find((c) => c !== host)!;
    // equipe cheia: 4 em cada
    const myTeam = guest.lobby!.players.find((p) => p.playerId === guest.welcome!.playerId)!.team;
    guest.send(C2S.SET_TEAM, { team: myTeam === 0 ? 1 : 0 });
    await guest.waitFor(() => guest.notices.find((n) => n.code === 'team_full'), 3000, 'team_full');
    guest.send(C2S.START, {});
    await guest.waitFor(() => guest.notices.find((n) => n.code === 'not_host'), 3000, 'not_host');
    host.send(C2S.START, {});
    await host.waitFor(() => host.notices.find((n) => n.code === 'not_all_ready'), 3000, 'not_all_ready');
    // entrada fora de fase (lobby) é ignorada sem derrubar a sala
    guest.sendInput({ moveY: 1 });
    await Promise.all(clients.map((c) => c.leave()));
  });
});

describe('credenciais', () => {
  it('rejeita credencial reutilizada, expirada, de outra sessão, audiência/emissor errados e sem permissão', async () => {
    const sid = newSid();
    const good = await cred('w1', sid, { jti: 'jti-unico-1' });
    const c1 = new HeadlessClient(srv.url);
    await c1.join({ activitySessionId: sid, credential: good, mapHash: MAP_HASH });
    const reuse = new HeadlessClient(srv.url);
    await expect(reuse.join({ activitySessionId: sid, credential: good, mapHash: MAP_HASH })).rejects.toThrow(/já utilizada/);
    const expired = await cred('w2', sid, { iatOffsetSeconds: -300, ttlSeconds: 60 });
    await expect(new HeadlessClient(srv.url).join({ activitySessionId: sid, credential: expired, mapHash: MAP_HASH })).rejects.toThrow();
    const otherSession = await cred('w3', 'sessao-alheia');
    await expect(new HeadlessClient(srv.url).join({ activitySessionId: sid, credential: otherSession, mapHash: MAP_HASH })).rejects.toThrow(/outra sessão/);
    const badAud = await cred('w4', sid, { audience: 'outro-servico' });
    await expect(new HeadlessClient(srv.url).join({ activitySessionId: sid, credential: badAud, mapHash: MAP_HASH })).rejects.toThrow(/inválida/);
    const badIss = await cred('w5', sid, { issuer: 'trivo' });
    await expect(new HeadlessClient(srv.url).join({ activitySessionId: sid, credential: badIss, mapHash: MAP_HASH })).rejects.toThrow(/inválida/);
    const noJoin = await cred('w6', sid, { join: false });
    await expect(new HeadlessClient(srv.url).join({ activitySessionId: sid, credential: noJoin, mapHash: MAP_HASH })).rejects.toThrow(/permissão/);
    const forged = (await cred('w7', sid)).slice(0, -4) + 'AAAA';
    await expect(new HeadlessClient(srv.url).join({ activitySessionId: sid, credential: forged, mapHash: MAP_HASH })).rejects.toThrow(/inválida/);
    await expect(new HeadlessClient(srv.url).join({ activitySessionId: sid, credential: await cred('w8', sid), mapHash: 'mapa-velho' })).rejects.toThrow(/mapa/);
    // opções extras / credencial na URL não são aceitas
    await expect(new HeadlessClient(srv.url).client.joinOrCreate(MATCH_ROOM_NAME, { activitySessionId: sid, credential: await cred('w9', sid), clientVersion: '0', mapHash: MAP_HASH, playerId: 1 })).rejects.toThrow();
    await c1.leave();
  });
});

describe('limite de taxa de entrada', () => {
  it('rajada de ingressos do mesmo IP recebe 429 sem afetar a sala', async () => {
    const original = ArenaRoom.joinLimiter;
    ArenaRoom.joinLimiter = new KeyedRateLimiter(3, 0.1);
    try {
      const sid = newSid();
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, async (_, i) => {
          const c = new HeadlessClient(srv.url);
          await c.join({ activitySessionId: sid, credential: await cred(`rl${i}`, sid), mapHash: MAP_HASH });
          return c;
        }),
      );
      const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<HeadlessClient>[];
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(ok.length).toBe(3);
      expect(rejected.every((r) => /muitas tentativas/.test(String(r.reason)))).toBe(true);
      for (const r of ok) await r.value.leave();
    } finally {
      ArenaRoom.joinLimiter = original;
    }
  });
});

describe('reconexão e identidade', () => {
  it('queda de rede reconecta ao mesmo slot sem criar segundo jogador', async () => {
    const sid = newSid();
    const a = await join('r1', sid);
    const b = await join('r2', sid);
    const pid = a.welcome!.playerId;
    a.simulateNetworkDrop();
    await b.waitFor(() => b.lobby!.players.find((p) => p.playerId === pid)?.connection === 'reconnecting' || a.reconnects > 0, 5000, 'reconnecting');
    await a.waitFor(() => a.reconnects > 0, 10000, 'reconectado');
    await b.waitFor(() => b.lobby!.players.find((p) => p.playerId === pid)?.connection === 'connected', 5000, 'connected');
    expect(b.lobby!.players.filter((p) => !p.isBot).length).toBe(2);
    await Promise.all([a.leave(), b.leave()]);
  });

  it('reabrir com nova credencial retoma o slot e encerra a conexão antiga', async () => {
    const sid = newSid();
    const a1 = await join('t1', sid);
    const other = await join('t2', sid);
    const pid = a1.welcome!.playerId;
    const a2 = await join('t1', sid);
    expect(a2.welcome!.playerId).toBe(pid);
    expect(a2.welcome!.resumed).toBe(true);
    await a1.waitFor(() => a1.leftCode !== null, 5000, 'antiga encerrada');
    expect(a1.leftCode).toBe(CloseCodes.REPLACED_BY_NEW_SESSION);
    await other.waitFor(() => other.lobby!.players.filter((p) => !p.isBot).length === 2, 3000, 'dois humanos');
    await Promise.all([a2.leave(), other.leave()]);
  });
});

describe('entradas adversariais', () => {
  it('NaN, Infinity, payload enorme, tipos errados e comandos inventados não derrubam a sala', async () => {
    const sid = newSid();
    const evil = await join('mal1', sid);
    const good = await join('bom1', sid);
    const host = [evil, good].find((c) => c.welcome!.playerId === c.lobby!.hostPlayerId)!;
    const other = host === evil ? good : evil;
    other.send(C2S.SET_READY, { ready: true });
    await host.waitFor(() => host.lobby!.players.every((p) => p.ready || p.playerId === host.lobby!.hostPlayerId), 3000, 'pronto');
    host.send(C2S.START, {});
    await good.waitFor(() => good.lobby!.phase === 'running', 25000, 'running');
    const r = evil.room!;
    const bad: unknown[] = [
      [1, 1, NaN, 0, 0, 0, 1, []],
      [2, 2, Infinity, 0, 0, 0, 1, []],
      [3, 3, 0, 0, 0, 0, 1, Array.from({ length: 5000 }, (_, i) => [i, 0])],
      { sequence: 4, moveX: 99 },
      'texto',
      [5, 5, 1e308, -1e308, 1e308, 1e308, 0xffffffff, [[1, 2, 3, 4]]],
    ];
    for (const b of bad) r.send(C2S.INPUT, b);
    r.send('lobby.setHp', { hp: 9999 });
    r.send('paint.write', { cell: 1, owner: 0 });
    r.send('round.result', { winner: 0 });
    r.send(C2S.SET_TEAM, { team: 7 });
    // enxurrada: 400 mensagens
    for (let i = 0; i < 400; i++) r.send(C2S.INPUT, encodeInput({ ...neutralInput(1000 + i), moveY: 1 }));
    await good.waitFor(() => good.snapshots.length > 5, 5000, 'snapshots');
    const before = good.lastSnapshot!.t;
    await new Promise((res) => setTimeout(res, 600));
    expect(good.lastSnapshot!.t).toBeGreaterThan(before); // a sala segue viva
    const mine = good.lastSnapshot!.pl.find((t) => t[0] === evil.welcome!.playerId)!;
    expect(mine[8]).toBeLessThanOrEqual(100); // vida não foi editada
    // o payload gigante (> limite do transporte) derruba só a conexão abusiva
    await evil.waitFor(() => evil.drops > 0 || evil.leftCode !== null, 5000, 'conexão abusiva encerrada');
    await Promise.all([evil.leave(), good.leave()]);
  });
});

describe('partida completa com 8 conexões, revanche e ressincronização', () => {
  it('oito clientes jogam, recebem o mesmo resultado, a revanche reinicia a tinta', async () => {
    const sid = newSid();
    const clients: HeadlessClient[] = [];
    for (let i = 0; i < 8; i++) clients.push(await join(`e${i}`, sid));
    const host = clients.find((c) => c.welcome!.playerId === c.lobby!.hostPlayerId)!;
    for (const c of clients) if (c !== host) c.send(C2S.SET_READY, { ready: true });
    await host.waitFor(() => host.lobby!.players.filter((p) => p.ready).length >= 7, 5000, 'prontos');
    host.send(C2S.SET_BOTS, { enabled: false });
    host.send(C2S.START, {});
    await host.waitFor(() => host.lobby!.phase === 'running', 25000, 'running');
    expect(host.lobby!.players.filter((p) => p.isBot).length).toBe(0);
    const t = setInterval(() => {
      for (const [i, c] of clients.entries()) c.sendInput({ moveY: 1, yaw: i % 2 ? -Math.PI / 2 : Math.PI / 2, pitch: 0.35, heldButtons: 1 });
    }, 33);
    await Promise.all(clients.map((c) => c.waitFor(() => c.results.length > 0, 20000, 'resultado')));
    clearInterval(t);
    const first = clients[0].results[0];
    for (const c of clients) {
      expect(c.results[0].teamUnits).toEqual(first.teamUnits);
      expect(c.results[0].winner).toEqual(first.winner);
    }
    expect(first.teamUnits[0] + first.teamUnits[1]).toBeGreaterThan(0);
    // ressincronização sob demanda
    const c0 = clients[0];
    const snapsBefore = c0.paintSnapshots.length;
    c0.send(C2S.PAINT_RESYNC, { roundId: first.roundId, reason: 'teste' });
    await c0.waitFor(() => c0.paintSnapshots.length > snapsBefore, 5000, 'snapshot de tinta');
    // revanche: todos votam
    await host.waitFor(() => host.lobby!.phase === 'results', 8000, 'results');
    for (const c of clients) c.send(C2S.VOTE, { choice: 'rematch' });
    await host.waitFor(() => host.lobby!.roundId === first.roundId + 1 && host.lobby!.phase !== 'results', 8000, 'nova rodada');
    await c0.waitFor(() => c0.paintSnapshots.some((s) => s.roundId === first.roundId + 1), 20000, 'tinta nova');
    const fresh = c0.paintSnapshots.find((s) => s.roundId === first.roundId + 1)!;
    expect(fresh.cells.every((v) => v === 0)).toBe(true);
    expect(srv.sink.rows.has(`${first.matchId}:${first.roundId}`)).toBe(true);
    await Promise.all(clients.map((c) => c.leave()));
  });

  it('quem chega com a rodada em andamento aguarda a próxima e não controla ninguém', async () => {
    const sid = newSid();
    const a = await join('l1', sid);
    a.send(C2S.START, {});
    await a.waitFor(() => a.lobby!.phase === 'running' || a.lobby!.phase === 'countdown', 25000, 'rodada');
    const late = await join('l2', sid);
    await late.waitFor(() => late.notices.find((n) => n.code === 'late_join_waiting'), 3000, 'aviso');
    const me = late.lobby!.players.find((p) => p.playerId === late.welcome!.playerId)!;
    expect(me.inRound).toBe(false);
    late.sendInput({ moveY: 1 });
    await new Promise((r) => setTimeout(r, 300));
    expect(late.snapshots.length).toBe(0); // não recebe estado de jogador na rodada
    await Promise.all([a.leave(), late.leave()]);
  });
});
