import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from './helpers';
import { reserve } from './proxySpoof.helpers';
import type { StartedServer } from '../src/server';

// Sem TRUSTED_PROXIES (padrão): nenhum cabeçalho de encaminhamento vale.
let srv: { s: StartedServer; url: string };
beforeAll(async () => {
  srv = await startTestServer({ JOIN_RATE_BURST: '3', JOIN_RATE_PER_SECOND: '0.01' });
});
afterAll(async () => {
  await srv.s.shutdown();
});

describe('falsificação de IP sem proxy confiável', () => {
  it('trocar X-Forwarded-For, X-Real-IP, X-Client-IP ou Forwarded a cada tentativa não fura o limite', async () => {
    const sid = `spoof-u-${Date.now().toString(36)}`;
    const out = [];
    for (let i = 0; i < 8; i++) {
      out.push(
        await reserve(srv.url, sid, `s${i}`, {
          'x-forwarded-for': `198.51.100.${i + 1}`,
          'x-real-ip': `203.0.113.${i + 1}`,
          'x-client-ip': `192.0.2.${i + 1}`,
          forwarded: `for=192.0.2.${i + 50}`,
          'x-borrifo-client-ip': `10.9.9.${i}`,
        }),
      );
    }
    const ok = out.filter((r) => r.status === 200).length;
    const limited = out.filter((r) => r.status === 429);
    expect(ok).toBe(3);
    expect(limited.length).toBe(5);
    expect(limited.every((r) => /muitas tentativas/.test(r.body))).toBe(true);
  });

  it('falsificar o IP de outra pessoa não esgota o limite dela (vale o socket de quem conecta)', async () => {
    // tudo aqui vem de 127.0.0.1, que já esgotou o balde no teste anterior; o "alvo" é outro
    // endereço que nunca conectou — nada do que foi mandado em nome dele foi contado
    const r = await reserve(srv.url, `spoof-u2-${Date.now().toString(36)}`, 'alvo', { 'x-forwarded-for': '198.51.100.1' });
    expect(r.status).toBe(429); // o balde é o do socket (127.0.0.1), não o do cabeçalho
  });
});
