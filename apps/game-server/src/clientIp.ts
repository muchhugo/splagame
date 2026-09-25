import { BlockList, isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

/**
 * Endereço do cliente para o limite de taxa, sem confiar em cabeçalho que qualquer um
 * escreve. Regra (a mesma dos proxies reversos bem configurados):
 *
 * - começa no endereço do SOCKET (quem de fato abriu a conexão com este processo);
 * - só se esse endereço for um proxy confiável (`TRUSTED_PROXIES`), lê o
 *   `X-Forwarded-For` da DIREITA para a esquerda, pulando os saltos que também são
 *   proxies confiáveis; o primeiro salto não confiável é o cliente;
 * - `X-Real-IP`, `X-Client-IP` e similares são ignorados (o Colyseus confia neles por
 *   padrão; aqui eles são removidos antes de chegar ao Colyseus).
 *
 * Sem `TRUSTED_PROXIES`, o cabeçalho nunca é lido: vale o socket.
 */
export class TrustedProxies {
  private readonly list = new BlockList();
  readonly entries: readonly string[];

  constructor(spec: string | undefined) {
    const entries: string[] = [];
    for (const raw of (spec ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const [addr, bits] = raw.split('/');
      const a = normalizeIp(addr);
      const kind = isIP(a);
      if (!kind) throw new Error(`TRUSTED_PROXIES: endereço inválido "${raw}"`);
      const type = kind === 6 ? 'ipv6' : 'ipv4';
      if (bits !== undefined) {
        const n = Number(bits);
        if (!Number.isInteger(n) || n < 0 || n > (kind === 6 ? 128 : 32)) throw new Error(`TRUSTED_PROXIES: prefixo inválido "${raw}"`);
        this.list.addSubnet(a, n, type);
      } else this.list.addAddress(a, type);
      entries.push(raw);
    }
    this.entries = entries;
  }

  trusts(ip: string): boolean {
    const a = normalizeIp(ip);
    const kind = isIP(a);
    if (!kind) return false;
    return this.list.check(a, kind === 6 ? 'ipv6' : 'ipv4');
  }

  /** Cliente a partir do endereço do socket e do `X-Forwarded-For` (se houver). */
  resolve(socketAddress: string | undefined, forwardedFor: string | string[] | undefined): string {
    let ip = normalizeIp(socketAddress ?? '');
    if (!isIP(ip)) return 'desconhecido';
    if (!this.trusts(ip)) return ip;
    const hops = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? ''))
      .split(',')
      .map((h) => normalizeIp(h.trim()))
      .filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      // salto malformado: não dá para ir além dele com segurança; fica o último confiável
      if (!isIP(hops[i])) return ip;
      ip = hops[i];
      if (!this.trusts(ip)) return ip;
    }
    return ip;
  }
}

/** `::ffff:1.2.3.4` → `1.2.3.4`; tira colchetes e porta de `[::1]:123` / `1.2.3.4:123`. */
export function normalizeIp(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('[')) s = s.slice(1, s.indexOf(']') > 0 ? s.indexOf(']') : undefined);
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  if (s.toLowerCase().startsWith('::ffff:') && isIP(s.slice(7)) === 4) s = s.slice(7);
  return s;
}

/**
 * Chave do limite: IPv4 inteiro; IPv6 pelo /64 (um cliente comum controla um /64 inteiro,
 * e trocar de endereço dentro dele não pode render baldes novos).
 */
export function rateKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const full = expandIpv6(ip);
  return full ? `${full.slice(0, 4).join(':')}::/64` : ip;
}

function expandIpv6(ip: string): string[] | null {
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  if (ip.includes('.')) return null; // IPv4 embutido: raro aqui; usa o endereço inteiro
  const fill = ip.includes('::') ? 8 - h.length - t.length : 0;
  const parts = [...h, ...Array(fill).fill('0'), ...t].map((p) => p.toLowerCase().replace(/^0+(?=.)/, ''));
  return parts.length === 8 ? parts : null;
}

/** Cabeçalho interno, escrito só pelo servidor depois de resolver o cliente. */
export const CLIENT_IP_HEADER = 'x-borrifo-client-ip';
const SPOOFABLE = ['x-real-ip', 'x-client-ip', 'x-forwarded-for', 'forwarded', 'cf-connecting-ip', 'true-client-ip', CLIENT_IP_HEADER];

/**
 * Reescreve os cabeçalhos da requisição (HTTP ou upgrade de WebSocket) ANTES do Colyseus:
 * remove todo cabeçalho de encaminhamento vindo de fora e grava o cliente resolvido no
 * cabeçalho interno e no `x-real-ip` (o que o Colyseus lê para `context.ip`).
 */
export function sanitizeForwarding(req: IncomingMessage, proxies: TrustedProxies) {
  const ip = proxies.resolve(req.socket.remoteAddress, req.headers['x-forwarded-for']);
  for (const h of SPOOFABLE) delete req.headers[h];
  req.headers[CLIENT_IP_HEADER] = ip;
  req.headers['x-real-ip'] = ip;
  // mantém rawHeaders coerente (algumas conversões para Request leem de lá)
  const raw: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (!SPOOFABLE.includes(req.rawHeaders[i].toLowerCase()) && req.rawHeaders[i].toLowerCase() !== 'x-real-ip') raw.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
  raw.push(CLIENT_IP_HEADER, ip, 'x-real-ip', ip);
  req.rawHeaders.length = 0;
  req.rawHeaders.push(...raw);
  return ip;
}
