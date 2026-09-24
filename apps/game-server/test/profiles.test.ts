import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HeadlessClient, issueDevCredential, TEST_DEV_SECRET } from '@borrifo/test-utils';
import { TEAM_PAIRS } from '@borrifo/game-content';
import { MAP_HASH, startTestServer } from './helpers';
import type { StartedServer } from '../src/server';
import type { MemoryResultSink } from '../src/results';

let srv: { s: StartedServer; url: string; sink: MemoryResultSink };
beforeAll(async () => {
  srv = await startTestServer({ AVATAR_ALLOWED_HOSTS: 'avatars.trivo.test' });
});
afterAll(async () => {
  await srv.s.shutdown();
});

async function join(sid: string, claims: { userId: string; name: string; nick?: string; uname?: string; avatar?: string }) {
  const c = new HeadlessClient(srv.url);
  await c.join({ activitySessionId: sid, credential: await issueDevCredential(TEST_DEV_SECRET, { ...claims, activitySessionId: sid }), mapHash: MAP_HASH });
  await c.waitFor(() => c.welcome && c.lobby, 5000, 'welcome');
  return c;
}

describe('par de cores da rodada (servidor real)', () => {
  it('o servidor escolhe um par válido e todos na sala recebem o mesmo, inclusive quem entra depois', async () => {
    const sid = 'sessao-par-1';
    const a = await join(sid, { userId: 'u-p1', name: 'P1' });
    const b = await join(sid, { userId: 'u-p2', name: 'P2' });
    await b.waitFor(() => b.lobby?.players.length === 2, 5000, 'dois');
    expect(TEAM_PAIRS.map((p) => p.id)).toContain(a.lobby!.teamPairId);
    expect(b.lobby!.teamPairId).toBe(a.lobby!.teamPairId);
    a.leave();
    b.leave();
  });
});

describe('perfis do Trivo no lobby (servidor real)', () => {
  it('nome: apelido da comunidade → nome de exibição → usuário; texto limpo e limitado; avatar só de host permitido', async () => {
    const sid = 'sessao-perfis-1';
    const a = await join(sid, { userId: 'u-ana', name: 'Ana', nick: 'Aninha', uname: 'ana.souza', avatar: 'https://avatars.trivo.test/ana.png' });
    const b = await join(sid, { userId: 'u-fabio', name: '', uname: 'fabio_22', avatar: 'https://malicioso.example/x.png' });
    const c = await join(sid, { userId: 'u-elis', name: 'Elis', nick: 'Elis <img src=x onerror=alert(1)>‮!', avatar: 'javascript:alert(1)' });
    const d = await join(sid, { userId: 'u-davi', name: 'Davi', nick: 'Davi, o Destruidor de Moringas' });
    await d.waitFor(() => d.lobby?.players.length === 4, 5000, 'quatro no lobby');
    const by = (u: string) => d.lobby!.players.find((p) => p.userId === u)!;
    expect(by('u-ana').displayName).toBe('Aninha');
    expect(by('u-ana').avatarUrl).toBe('https://avatars.trivo.test/ana.png');
    expect(by('u-fabio').displayName).toBe('fabio_22');
    expect(by('u-fabio').avatarUrl).toBeNull();
    expect(by('u-elis').displayName).not.toMatch(/[<>‮]/);
    expect(by('u-elis').avatarUrl).toBeNull();
    expect([...by('u-davi').displayName].length).toBeLessThanOrEqual(24);
    // bots não têm userId (nada a ligar com a chamada)
    for (const x of [a, b, c, d]) x.leave();
  });

  it('ao reconectar com credencial nova, o apelido atualizado vale', async () => {
    const sid = 'sessao-perfis-2';
    const a = await join(sid, { userId: 'u-gabi', name: 'Gabriela', nick: 'Gabi' });
    expect(a.lobby!.players[0].displayName).toBe('Gabi');
    a.leave();
    const again = await join(sid, { userId: 'u-gabi', name: 'Gabriela', nick: 'Gabi 🎨' });
    await again.waitFor(() => again.lobby?.players.find((p) => p.userId === 'u-gabi')?.displayName === 'Gabi 🎨', 5000, 'apelido novo');
    expect(again.lobby!.players.filter((p) => p.userId === 'u-gabi')).toHaveLength(1);
    again.leave();
  });
});
