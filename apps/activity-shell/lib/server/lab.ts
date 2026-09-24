import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { parseLabConfig, type LabConfig } from '../config';
import { LabError } from '../errors';
import { TokenBucketLimiter } from '../rateLimit';
import type { LabUser } from '../roster';
import { LAB_SESSION_COOKIE, verifyLabSession } from '../session';
import { loadRepoRootDotEnv } from './dotenv';

export function getLabConfig(): LabConfig {
  loadRepoRootDotEnv();
  return parseLabConfig(process.env);
}

/** Limitadores em memória. Guardados em globalThis para sobreviver ao HMR do `next dev`. */
type Limiters = { session: TokenBucketLimiter; credential: TokenBucketLimiter; standalone: TokenBucketLimiter; livekit: TokenBucketLimiter };
const g = globalThis as typeof globalThis & { __borrifoLabLimiters?: Limiters };
export const limiters: Limiters = (g.__borrifoLabLimiters ??= {
  session: new TokenBucketLimiter({ capacity: 30, refillPerMinute: 30 }),
  credential: new TokenBucketLimiter({ capacity: 20, refillPerMinute: 20 }),
  standalone: new TokenBucketLimiter({ capacity: 20, refillPerMinute: 20 }),
  livekit: new TokenBucketLimiter({ capacity: 10, refillPerMinute: 10 }),
});

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function errorResponse(e: unknown, headers: Record<string, string> = {}): NextResponse {
  if (e instanceof LabError) return json({ error: e.message, code: e.code }, e.status, { ...headers, ...e.headers });
  // Nunca expõe detalhes internos (nem segredos) ao cliente.
  console.error('[activity-shell] erro inesperado:', e instanceof Error ? e.message : 'desconhecido');
  return json({ error: 'Erro interno do laboratório.', code: 'internal' }, 500, headers);
}

/**
 * IP do cliente para o rate limit. Sem proxy na frente, o Next define
 * x-forwarded-for a partir do socket apenas quando o cabeçalho não veio na
 * requisição — ou seja, é falsificável. Aceitável no laboratório local.
 */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return (first || req.headers.get('x-real-ip') || 'local').slice(0, 64);
}

export function rateLimit(limiter: TokenBucketLimiter, key: string): void {
  const r = limiter.take(key);
  if (!r.ok) {
    throw new LabError(429, 'rate_limited', `Muitas requisições. Tente de novo em ${r.retryAfterSeconds}s.`, { 'Retry-After': String(r.retryAfterSeconds) });
  }
}

/** Lê JSON com limite de tamanho. Não valida (use `parseBody`). */
export async function readJson(req: NextRequest, maxBytes = 4096): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new LabError(413, 'payload_too_large', 'Corpo da requisição grande demais.');
  const text = await req.text();
  if (text.length > maxBytes) throw new LabError(413, 'payload_too_large', 'Corpo da requisição grande demais.');
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new LabError(400, 'invalid_json', 'JSON inválido.');
  }
}

export function parseBody<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) throw new LabError(400, 'invalid_body', 'Corpo da requisição inválido.');
  return r.data;
}

export async function requireLabUser(req: NextRequest, cfg: LabConfig): Promise<LabUser> {
  const user = await verifyLabSession(req.cookies.get(LAB_SESSION_COOKIE)?.value, cfg.labSessionSecret);
  if (!user) throw new LabError(401, 'no_session', 'Sessão do laboratório ausente ou expirada. Escolha um usuário de desenvolvimento.');
  return user;
}

/** Chave de rate limit tolerante a corpo inválido. */
export function userKeyFrom(raw: unknown): string {
  const v = (raw as { userId?: unknown } | null)?.userId;
  return typeof v === 'string' ? v.slice(0, 32) : '?';
}
