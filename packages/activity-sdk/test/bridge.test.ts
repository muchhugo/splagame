import { describe, expect, it } from 'vitest';
import { ActivityClient, ActivityHost, HostRequestError, VOICE_NOT_CONFIGURED, type ActivityContext } from '../src/index';

const ctx: ActivityContext = {
  protocolVersion: 1,
  activityId: 'trivo.lab.activity.borrifo',
  activitySessionId: 'sess-teste',
  channelId: 'canal',
  viewer: { id: 'ana', displayName: 'Ana' },
  capabilities: { canCreateMatch: true, canJoinMatch: true, canInvite: false, canUseVoice: false },
  locale: 'pt-BR',
  theme: 'dark',
  hostKind: 'lab-dev',
};

function pair(context = ctx, extraHandlers: Partial<ConstructorParameters<typeof ActivityHost>[0]['handlers']> = {}) {
  const rejected: string[] = [];
  const host = new ActivityHost({
    activityOrigin: 'http://jogo.local',
    nonce: 'nonce-1234567890',
    context,
    voice: VOICE_NOT_CONFIGURED,
    handlers: {
      requestMatchCredential: async () => ({ credential: 'x'.repeat(40), expiresAt: Date.now() + 60000, gameServerUrl: 'http://srv' }),
      onRejectedMessage: (r) => rejected.push(r),
      ...extraHandlers,
    },
  });
  const port = host.connectLocal();
  const client = ActivityClient.fromPort(port, 'nonce-1234567890', host.initPayload());
  return { host, client, rejected, port };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe('contrato host ⇄ Atividade', () => {
  it('pedido de credencial com correlação; sessão diferente e permissão são verificadas pelo host', async () => {
    const { client } = pair();
    const cred = await client.request<{ credential: string }>('ACTIVITY_REQUEST_MATCH_CREDENTIAL', { activitySessionId: 'sess-teste' });
    expect(cred.credential.length).toBe(40);
    await expect(client.request('ACTIVITY_REQUEST_MATCH_CREDENTIAL', { activitySessionId: 'outra-sessao' })).rejects.toMatchObject({ code: 'wrong_session' });
    const noJoin = pair({ ...ctx, capabilities: { ...ctx.capabilities, canJoinMatch: false } });
    await expect(noJoin.client.request('ACTIVITY_REQUEST_MATCH_CREDENTIAL', { activitySessionId: 'sess-teste' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('capacidade inexistente no host responde erro explícito (convite/voz)', async () => {
    const { client } = pair();
    await expect(client.request('ACTIVITY_REQUEST_INVITE', {})).rejects.toMatchObject({ code: 'unsupported' });
    await expect(client.request('ACTIVITY_REQUEST_VOICE_ACTION', { action: 'toggle_mute' })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('erro do backend vira resposta de erro (sem vazar detalhes internos)', async () => {
    const { client } = pair(ctx, {
      requestMatchCredential: async () => {
        throw new HostRequestError('forbidden', 'Usuário sem acesso ao canal');
      },
    });
    await expect(client.request('ACTIVITY_REQUEST_MATCH_CREDENTIAL', { activitySessionId: 'sess-teste' })).rejects.toMatchObject({ code: 'forbidden', message: 'Usuário sem acesso ao canal' });
  });

  it('mensagens malformadas, nonce errado e tipos desconhecidos são descartados', async () => {
    const { host, port, rejected } = pair();
    // escreve diretamente no canal do host simulando uma Atividade adulterada
    const raw = new MessageChannel();
    void raw;
    const sendRaw = (m: unknown) => (port as MessagePort).postMessage(m);
    sendRaw({ v: 1, type: 'ACTIVITY_READY', nonce: 'nonce-errado-000', payload: { gameId: 'x', version: '1' } });
    sendRaw({ v: 1, type: 'ACTIVITY_DELETE_EVERYTHING', nonce: 'nonce-1234567890', payload: {} });
    sendRaw({ v: 1, type: 'ACTIVITY_LOADING_PROGRESS', nonce: 'nonce-1234567890', payload: { progress: 7, label: 'x' } });
    sendRaw('texto solto');
    sendRaw({ v: 2, type: 'ACTIVITY_READY', nonce: 'nonce-1234567890', payload: {} });
    await tick();
    expect(rejected).toEqual(['nonce_invalido', 'tipo_desconhecido', 'payload_invalido', 'envelope_invalido', 'envelope_invalido']);
    expect(host.rejected).toBe(5);
  });

  it('timeout de pedido e fechamento limpo (sem pendências nem listeners)', async () => {
    const { client } = pair(ctx, { requestMatchCredential: () => new Promise(() => {}) });
    await expect(client.request('ACTIVITY_REQUEST_MATCH_CREDENTIAL', { activitySessionId: 'sess-teste' }, 50)).rejects.toMatchObject({ code: 'timeout' });
    const p = client.request('ACTIVITY_REQUEST_MATCH_CREDENTIAL', { activitySessionId: 'sess-teste' }, 5000);
    client.close();
    await expect(p).rejects.toMatchObject({ code: 'closed' });
    await expect(client.request('ACTIVITY_REQUEST_INVITE', {})).rejects.toMatchObject({ code: 'closed' });
  });

  it('eventos do host chegam validados: contexto, visibilidade e voz', async () => {
    const { host, client } = pair();
    const seen: string[] = [];
    client.on('ACTIVITY_VISIBILITY_CHANGED', (p) => seen.push(`vis:${p.visible}`));
    client.on('VOICE_STATE_UPDATED', (p) => seen.push(`voz:${p.voice.reason}`));
    client.on('ACTIVITY_CLOSE_REQUESTED', (p) => seen.push(`fechar:${p.reason}`));
    host.setVisibility(false);
    host.setVoice({ ...VOICE_NOT_CONFIGURED, available: true, reason: 'ok', connected: true, muted: true, scope: 'shared_call' });
    host.updateContext({ ...ctx, theme: 'light' });
    host.requestClose('teste');
    await tick();
    expect(seen).toEqual(['vis:false', 'voz:ok', 'fechar:teste']);
    expect(client.context.theme).toBe('light');
    expect(client.voice.connected).toBe(true);
  });

  it('handshake por janela: exige origem permitida, janela pai e nonce correto', async () => {
    // janela falsa mínima
    const listeners = new Set<(ev: MessageEvent) => void>();
    const parent = { postMessage: () => {} } as unknown as Window;
    const win = {
      parent,
      addEventListener: (_t: string, fn: (ev: MessageEvent) => void) => listeners.add(fn),
      removeEventListener: (_t: string, fn: (ev: MessageEvent) => void) => listeners.delete(fn),
    } as unknown as Window;
    const promise = ActivityClient.connect({ allowedHostOrigins: ['http://host.local'], nonce: 'nonce-abcdefghij', timeoutMs: 500, win });
    const ch = new MessageChannel();
    const init = { v: 1, type: 'ACTIVITY_INIT', nonce: 'nonce-abcdefghij', payload: { context: ctx, voice: VOICE_NOT_CONFIGURED } };
    const fire = (origin: string, source: unknown, data: unknown) => {
      for (const l of [...listeners]) l({ origin, source, data, ports: [ch.port2] } as unknown as MessageEvent);
    };
    fire('http://malicioso.local', parent, init); // origem não permitida
    fire('http://host.local', {}, init); // não é a janela pai
    fire('http://host.local', parent, { ...init, nonce: 'nonce-outro-00000' }); // nonce errado
    let settled = false;
    promise.then(() => (settled = true)).catch(() => (settled = true));
    await tick();
    expect(settled).toBe(false);
    fire('http://host.local', parent, init);
    const client = await promise;
    expect(client.context.activitySessionId).toBe('sess-teste');
    expect(listeners.size).toBe(0); // listener removido após o handshake
    client.close();
  });

  it('handshake sem resposta do host expira', async () => {
    const win = { parent: { postMessage: () => {} }, addEventListener: () => {}, removeEventListener: () => {} } as unknown as Window;
    await expect(ActivityClient.connect({ allowedHostOrigins: ['http://host.local'], nonce: 'nonce-abcdefghij', timeoutMs: 50, win })).rejects.toMatchObject({ code: 'handshake_timeout' });
  });
});
