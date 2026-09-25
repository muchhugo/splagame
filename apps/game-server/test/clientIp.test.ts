import { describe, expect, it } from 'vitest';
import { TrustedProxies, normalizeIp, rateKey } from '../src/clientIp';
import { KeyedRateLimiter } from '../src/rateLimit';

describe('cliente atrás de proxy: quem é confiável', () => {
  it('sem proxies confiáveis, o X-Forwarded-For nunca é lido (vale o socket)', () => {
    const p = new TrustedProxies('');
    expect(p.resolve('203.0.113.9', '1.2.3.4')).toBe('203.0.113.9');
    expect(p.resolve('::ffff:203.0.113.9', '1.2.3.4, 5.6.7.8')).toBe('203.0.113.9');
  });

  it('com proxy confiável, lê da direita para a esquerda e para no primeiro salto não confiável', () => {
    const p = new TrustedProxies('10.0.0.0/8, 127.0.0.1');
    // cliente → proxy de borda (10.0.0.5) → proxy interno (127.0.0.1) → servidor
    expect(p.resolve('127.0.0.1', '198.51.100.7, 10.0.0.5')).toBe('198.51.100.7');
    // o cliente tenta falsificar prefixando o cabeçalho: vale o salto que o proxy viu
    expect(p.resolve('127.0.0.1', '6.6.6.6, 198.51.100.7')).toBe('198.51.100.7');
    // conexão direta de fora (não passou pelo proxy): o cabeçalho é ignorado
    expect(p.resolve('198.51.100.7', '6.6.6.6')).toBe('198.51.100.7');
    // proxy confiável sem cabeçalho: fica o próprio proxy (todos dividem o balde)
    expect(p.resolve('127.0.0.1', undefined)).toBe('127.0.0.1');
    // salto malformado: não passa dele
    expect(p.resolve('127.0.0.1', 'lixo, 10.0.0.5')).toBe('10.0.0.5');
    // IPv6 e sub-rede IPv6
    const q = new TrustedProxies('2001:db8::/32');
    expect(q.resolve('2001:db8::1', '2001:db8:1::2, 2606:4700::1')).toBe('2606:4700::1');
  });

  it('configuração malformada falha na partida', () => {
    expect(() => new TrustedProxies('10.0.0.0/33')).toThrow();
    expect(() => new TrustedProxies('não-é-ip')).toThrow();
  });

  it('normaliza endereço mapeado, porta e colchetes; IPv6 agrupa pelo /64', () => {
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('1.2.3.4:5678')).toBe('1.2.3.4');
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(rateKey('2001:db8:aa:bb:1:2:3:4')).toBe(rateKey('2001:db8:aa:bb::99'));
    expect(rateKey('2001:db8:aa:bb::1')).not.toBe(rateKey('2001:db8:aa:bc::1'));
    expect(rateKey('1.2.3.4')).toBe('1.2.3.4');
  });
});

describe('limitador por chave com LRU', () => {
  it('enxurrada de chaves novas não passa do teto e não apaga quem está ativo', () => {
    let t = 0;
    const lim = new KeyedRateLimiter(2, 0.001, 100, () => t);
    expect(lim.take('ativo')).toBe(true);
    expect(lim.take('ativo')).toBe(true);
    for (let i = 0; i < 1000; i++) {
      lim.take(`novo-${i}`);
      if (i % 10 === 0) lim.take('ativo'); // continua usando: fica no fim da fila
      t++;
    }
    expect(lim.size).toBeLessThanOrEqual(100);
    // o balde de "ativo" não foi recriado (continua esgotado)
    expect(lim.take('ativo')).toBe(false);
  });
});
