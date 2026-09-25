import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from './helpers';
import { reserve } from './proxySpoof.helpers';
import type { StartedServer } from '../src/server';

// Atrás de proxy confiável (o teste conecta de 127.0.0.1, declarado confiável).
let srv: { s: StartedServer; url: string };
beforeAll(async () => {
  srv = await startTestServer({ JOIN_RATE_BURST: '3', JOIN_RATE_PER_SECOND: '0.01', TRUSTED_PROXIES: '127.0.0.1, ::1' });
});
afterAll(async () => {
  await srv.s.shutdown();
});

describe('limite por cliente atrás de proxy confiável', () => {
  it('cada cliente encaminhado tem o próprio balde; o mesmo cliente é limitado', async () => {
    const sid = `spoof-t-${Date.now().toString(36)}`;
    const a = [];
    for (let i = 0; i < 5; i++) a.push(await reserve(srv.url, sid, `a${i}`, { 'x-forwarded-for': '198.51.100.10' }));
    expect(a.map((r) => r.status)).toEqual([200, 200, 200, 429, 429]);
    // outro cliente atrás do mesmo proxy não é afetado
    const b = await reserve(srv.url, sid, 'b0', { 'x-forwarded-for': '198.51.100.11' });
    expect(b.status).toBe(200);
  });

  it('o cliente não escapa prefixando o X-Forwarded-For nem mandando X-Real-IP', async () => {
    const sid = `spoof-t2-${Date.now().toString(36)}`;
    const out = [];
    for (let i = 0; i < 6; i++) {
      // o proxy acrescenta o endereço real (198.51.100.20) à direita; o resto veio do cliente
      out.push(await reserve(srv.url, sid, `c${i}`, { 'x-forwarded-for': `6.6.6.${i}, 198.51.100.20`, 'x-real-ip': `7.7.7.${i}` }));
    }
    expect(out.filter((r) => r.status === 200).length).toBe(3);
  });

  it('IPv6: trocar de endereço dentro do mesmo /64 não rende baldes novos', async () => {
    const sid = `spoof-t3-${Date.now().toString(36)}`;
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await reserve(srv.url, sid, `v${i}`, { 'x-forwarded-for': `2001:db8:1:2::${(i + 1).toString(16)}` }));
    expect(out.filter((r) => r.status === 200).length).toBe(3);
  });
});
