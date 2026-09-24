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

  it('sala aceita até 20 pessoas (16 jogam, 4 na fila); a 21ª é recusada; equipe com 8 fica cheia', async () => {
    const sid = newSid();
    const clients: HeadlessClient[] = [];
    for (let i = 0; i < 20; i++) clients.push(await join(`v${i}`, sid));
    await expect(join('v20', sid)).rejects.toThrow();
    const host = clients.find((c) => c.welcome!.playerId === c.lobby!.hostPlayerId)!;
    await host.waitFor(() => host.lobby!.players.length === 20, 3000, '20 no lobby');
    // plano visível antes do início: 8 × 8 e 4 na fila (flex, sem bots)
    host.send(C2S.SET_BOTS, { enabled: false });
    await host.waitFor(() => host.lobby!.plan.teamSize === 8 && host.lobby!.plan.queue.length === 4, 3000, 'plano 8×8 + fila');
    expect(host.lobby!.plan.variant).toBe('ampliado');
    const guest = clients.find((c) => c !== host)!;
    const myTeam = guest.lobby!.players.find((p) => p.playerId === guest.welcome!.playerId)!.team;
    guest.send(C2S.SET_TEAM, { team: myTeam === 0 ? 1 : 0 });
    await guest.waitFor(() => guest.notices.find((n) => n.code === 'team_full'), 3000, 'team_full');
    guest.send(C2S.START, {});
    await guest.waitFor(() => guest.notices.find((n) => n.code === 'not_host'), 3000, 'not_host');
    guest.send(C2S.SET_OPTIONS, { mode: 'correio' });
    await guest.waitFor(() => guest.notices.filter((n) => n.code === 'not_host').length >= 2, 3000, 'opções só do anfitrião');
    host.send(C2S.START, {});
    await host.waitFor(() => host.notices.find((n) => n.code === 'not_all_ready'), 3000, 'not_all_ready');
    guest.sendInput({ moveY: 1 });
    await Promise.all(clients.map((c) => c.leave()));
  });

  it('opções do anfitrião: modo, mapa e formação validados; mapa e variante escolhidos pelo servidor', async () => {
    const sid = newSid();
    const host = await join('o1', sid);
    const b = await join('o2', sid);
    host.send(C2S.SET_OPTIONS, { mode: 'correio', map: 'clube-da-mare', formation: 4 });
    await b.waitFor(() => b.lobby!.mode === 'correio' && b.lobby!.mapChoice === 'clube-da-mare' && b.lobby!.formation === 4, 3000, 'opções');
    // 4 × 4 com bots: 8 ativos → Clube da Maré padrão
    expect(b.lobby!.plan.teamSize).toBe(4);
    expect(b.lobby!.plan.bots[0] + b.lobby!.plan.bots[1]).toBe(6);
    expect(b.lobby!.map.id).toBe('clube-da-mare.padrao');
    host.send(C2S.SET_OPTIONS, { map: 'mapa-que-nao-existe' });
    await host.waitFor(() => host.notices.find((n) => n.code === 'invalid_message'), 3000, 'mapa inválido');
    host.send(C2S.SET_OPTIONS, { formation: 9 } as never);
    host.send(C2S.SET_OPTIONS, { mode: 'caos' } as never);
    await new Promise((r) => setTimeout(r, 300));
    expect(b.lobby!.formation).toBe(4);
    expect(b.lobby!.mode).toBe('correio');
    b.send(C2S.SET_READY, { ready: true });
    await host.waitFor(() => host.lobby!.players.find((p) => p.playerId === b.welcome!.playerId)?.ready === true, 3000, 'pronto');
    host.send(C2S.START, {});
    const loading = await host.waitFor(() => host.roundLoadings?.[0], 10000, 'round.loading');
    expect(loading.mapId).toBe('clube-da-mare.padrao');
    expect(loading.mode).toBe('correio');
    await host.waitFor(() => host.lobby!.phase === 'running', 25000, 'running');
    await host.waitFor(() => host.lastSnapshot?.obj !== undefined, 5000, 'snapshot do objetivo');
    expect(host.lastSnapshot!.pk!.length).toBeGreaterThan(0);
    await Promise.all([host.leave(), b.leave()]);
  });

  it('ímpar sem bots: equipes equilibradas e fila avisada; quem ficou de fora tem prioridade na revanche', async () => {
    const sid = newSid();
    const cs = [await join('q1', sid), await join('q2', sid), await join('q3', sid)];
    const host = cs.find((c) => c.welcome!.playerId === c.lobby!.hostPlayerId)!;
    host.send(C2S.SET_BOTS, { enabled: false });
    await host.waitFor(() => host.lobby!.plan.teamSize === 1 && host.lobby!.plan.queue.length === 1, 3000, 'plano 1×1 + fila');
    const queuedId = host.lobby!.plan.queue[0];
    for (const c of cs) if (c !== host) c.send(C2S.SET_READY, { ready: true });
    await host.waitFor(() => host.lobby!.players.filter((p) => p.ready).length >= 2, 3000, 'prontos');
    host.send(C2S.START, {});
    const queued = cs.find((c) => c.welcome!.playerId === queuedId)!;
    await queued.waitFor(() => queued.notices.find((n) => n.code === 'queued'), 5000, 'aviso de fila');
    await host.waitFor(() => host.lobby!.phase === 'running' || host.lobby!.phase === 'countdown', 25000, 'rodada');
    expect(host.lobby!.players.find((p) => p.playerId === queuedId)!.queued).toBe(true);
    expect(host.lobby!.players.filter((p) => p.inRound).length).toBe(2);
    // o próximo plano já coloca quem esperou para jogar
    expect(host.lobby!.plan.queue).not.toContain(queuedId);
    await Promise.all(cs.map((c) => c.leave()));
  });
});

describe('aparência cosmética', () => {
  it('valida, sincroniza para todos e só aceita troca no lobby', async () => {
    const sid = newSid();
    const a = await join('ap1', sid);
    const b = await join('ap2', sid);
    const aid = a.welcome!.playerId;
    expect(a.lobby!.players.find((p) => p.playerId === aid)!.appearance).toBe('a1');
    a.send(C2S.SET_APPEARANCE, { appearance: 'b3' });
    await b.waitFor(() => b.lobby!.players.find((p) => p.playerId === aid)?.appearance === 'b3', 3000, 'b vê b3');
    // forma completa: cabelo e cor do cabelo
    a.send(C2S.SET_APPEARANCE, { appearance: 'b2h3c5' });
    await b.waitFor(() => b.lobby!.players.find((p) => p.playerId === aid)?.appearance === 'b2h3c5', 3000, 'b vê b2h3c5');
    a.send(C2S.SET_APPEARANCE, { appearance: 'b3' });
    await b.waitFor(() => b.lobby!.players.find((p) => p.playerId === aid)?.appearance === 'b3', 3000, 'b volta a b3');
    // valores fora do formato são descartados pelo esquema (a sala segue viva, nada muda)
    a.send(C2S.SET_APPEARANCE, { appearance: 'z9' });
    a.send(C2S.SET_APPEARANCE, { appearance: 'a1h4c0' });
    a.send(C2S.SET_APPEARANCE, { appearance: 'a1h0c6' });
    a.send(C2S.SET_APPEARANCE, { appearance: '<b>a1' });
    a.send(C2S.SET_APPEARANCE, { appearance: 'a0', hitbox: 3 });
    await new Promise((r) => setTimeout(r, 300));
    expect(b.lobby!.players.find((p) => p.playerId === aid)!.appearance).toBe('b3');
    await Promise.all([a.leave(), b.leave()]);
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

describe('janela de reconexão expirada', () => {
  it('durante a rodada, o slot vira bot da mesma turma; ao voltar, a pessoa retoma o slot', async () => {
    // o matchmaker do Colyseus é global no processo: ajusta a sala do servidor da suíte
    // (janela de 1 s e rodada longa) em vez de subir outro servidor
    const saved = { ...ArenaRoom.deps };
    ArenaRoom.deps = { ...ArenaRoom.deps, reconnectWindowSeconds: 1, roundDurationSeconds: 30 };
    const sid = newSid();
    const joinL = (u: string) => join(u, sid);
    try {
      const a = await joinL('exp1');
      const b = await joinL('exp2');
      const host = [a, b].find((c) => c.welcome!.playerId === c.lobby!.hostPlayerId)!;
      const guest = host === a ? b : a;
      const gid = guest.welcome!.playerId;
      guest.send(C2S.SET_READY, { ready: true });
      await host.waitFor(() => host.lobby!.players.find((p) => p.playerId === gid)?.ready, 3000, 'pronto');
      host.send(C2S.START, {});
      await host.waitFor(() => host.lobby!.phase === 'running', 25000, 'running');
      const team = host.lobby!.players.find((p) => p.playerId === gid)!.team;
      // queda sem volta automática: a janela (1 s) expira
      (guest as unknown as { room: { reconnection: { enabled: boolean } } }).room.reconnection.enabled = false;
      guest.simulateNetworkDrop();
      await host.waitFor(() => host.lobby!.players.find((p) => p.playerId === gid)?.connection === 'replaced_by_bot', 8000, 'slot vira bot');
      const slot = host.lobby!.players.find((p) => p.playerId === gid)!;
      expect(slot.team).toBe(team);
      expect(host.lobby!.players.filter((p) => !p.isBot).length).toBe(2);
      // o bot joga: a posição do slot muda nos snapshots
      const posOf = () => host.lastSnapshot?.pl.find((t) => t[0] === gid);
      const p0 = await host.waitFor(() => posOf(), 3000, 'slot no snapshot');
      await new Promise((r) => setTimeout(r, 2500));
      const p1 = posOf()!;
      expect(Math.hypot(p1[1] - p0[1], p1[3] - p0[3])).toBeGreaterThan(50); // centímetros
      // a pessoa volta com nova credencial e retoma o mesmo slot, na mesma turma
      const back = await joinL(guest === a ? 'exp1' : 'exp2');
      expect(back.welcome!.playerId).toBe(gid);
      expect(back.welcome!.resumed).toBe(true);
      await host.waitFor(() => host.lobby!.players.find((p) => p.playerId === gid)?.connection === 'connected', 5000, 'retomou');
      expect(host.lobby!.players.find((p) => p.playerId === gid)!.team).toBe(team);
      await Promise.all([host.leave(), back.leave()]);
    } finally {
      ArenaRoom.deps = saved;
    }
  }, 60000);
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
