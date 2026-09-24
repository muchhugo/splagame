import { z } from 'zod';

/**
 * Contrato versionado host ⇄ Atividade. Nomes propostos pelo laboratório; se o
 * host real tiver protocolo equivalente, use um adaptador em vez de mudá-lo.
 */
export const ACTIVITY_PROTOCOL_VERSION = 1 as const;

export const ActivityContextSchema = z
  .object({
    protocolVersion: z.literal(1),
    activityId: z.string().min(1).max(128),
    activitySessionId: z.string().min(1).max(128),
    matchId: z.string().max(128).optional(),
    channelId: z.string().max(128).optional(),
    communityId: z.string().max(128).optional(),
    viewer: z
      .object({
        id: z.string().min(1).max(128),
        displayName: z.string().min(1).max(64),
        avatarUrl: z.string().max(512).optional(),
      })
      .strict(),
    capabilities: z
      .object({
        canCreateMatch: z.boolean(),
        canJoinMatch: z.boolean(),
        canInvite: z.boolean(),
        canUseVoice: z.boolean(),
      })
      .strict(),
    locale: z.string().max(16),
    theme: z.enum(['light', 'dark']),
    /** Identifica o host para diagnóstico ("trivo" ou "lab-dev"). Não concede nada. */
    hostKind: z.enum(['trivo', 'lab-dev', 'standalone-dev']),
  })
  .strict();
export type ActivityContext = z.infer<typeof ActivityContextSchema>;

export const VoiceParticipantSchema = z
  .object({ id: z.string().max(128), displayName: z.string().max(64), speaking: z.boolean(), muted: z.boolean(), isLocal: z.boolean() })
  .strict();

export const VoiceStateSchema = z
  .object({
    /** Há integração de voz configurada neste host? */
    available: z.boolean(),
    reason: z.enum(['ok', 'not_configured', 'not_in_call', 'connecting', 'error', 'permission_denied']),
    connected: z.boolean(),
    muted: z.boolean(),
    /** A voz é a da chamada compartilhada (todas as equipes ouvem todas). */
    scope: z.enum(['shared_call', 'none']),
    participants: z.array(VoiceParticipantSchema).max(64),
  })
  .strict();
export type VoiceState = z.infer<typeof VoiceStateSchema>;

export const HOST_TO_ACTIVITY = [
  'ACTIVITY_INIT',
  'ACTIVITY_CONTEXT_UPDATED',
  'ACTIVITY_VISIBILITY_CHANGED',
  'ACTIVITY_RESIZE',
  'ACTIVITY_SUSPEND',
  'ACTIVITY_RESUME',
  'ACTIVITY_CLOSE_REQUESTED',
  'VOICE_STATE_UPDATED',
  'RESPONSE',
] as const;
export type HostToActivityType = (typeof HOST_TO_ACTIVITY)[number];

export const ACTIVITY_TO_HOST = [
  'ACTIVITY_HELLO',
  'ACTIVITY_READY',
  'ACTIVITY_LOADING_PROGRESS',
  'ACTIVITY_ERROR',
  'ACTIVITY_REQUEST_MATCH_CREDENTIAL',
  'ACTIVITY_REQUEST_INVITE',
  'ACTIVITY_REQUEST_FULLSCREEN',
  'ACTIVITY_REQUEST_CLOSE',
  'ACTIVITY_REQUEST_VOICE_ACTION',
  'ACTIVITY_SESSION_STATE_CHANGED',
  'ACTIVITY_CLOSED',
] as const;
export type ActivityToHostType = (typeof ACTIVITY_TO_HOST)[number];

export const EnvelopeSchema = z
  .object({
    v: z.literal(ACTIVITY_PROTOCOL_VERSION),
    type: z.string().max(64),
    nonce: z.string().min(8).max(128),
    id: z.string().max(64).optional(),
    replyTo: z.string().max(64).optional(),
    payload: z.unknown(),
  })
  .strict();
export type Envelope = z.infer<typeof EnvelopeSchema>;

/** Payloads validados por tipo. */
export const PayloadSchemas = {
  ACTIVITY_INIT: z.object({ context: ActivityContextSchema, voice: VoiceStateSchema }).strict(),
  ACTIVITY_CONTEXT_UPDATED: z.object({ context: ActivityContextSchema }).strict(),
  ACTIVITY_VISIBILITY_CHANGED: z.object({ visible: z.boolean() }).strict(),
  ACTIVITY_RESIZE: z.object({ width: z.number().int().min(0).max(20000), height: z.number().int().min(0).max(20000) }).strict(),
  ACTIVITY_SUSPEND: z.object({ reason: z.string().max(64) }).strict(),
  ACTIVITY_RESUME: z.object({}).strict(),
  ACTIVITY_CLOSE_REQUESTED: z.object({ reason: z.string().max(64) }).strict(),
  VOICE_STATE_UPDATED: z.object({ voice: VoiceStateSchema }).strict(),
  RESPONSE: z.union([z.object({ ok: z.literal(true), data: z.unknown() }).strict(), z.object({ ok: z.literal(false), error: z.string().max(200), code: z.string().max(64) }).strict()]),

  ACTIVITY_HELLO: z.object({ protocolVersion: z.literal(ACTIVITY_PROTOCOL_VERSION) }).strict(),
  ACTIVITY_READY: z.object({ gameId: z.string().max(128), version: z.string().max(32) }).strict(),
  ACTIVITY_LOADING_PROGRESS: z.object({ progress: z.number().min(0).max(1), label: z.string().max(80) }).strict(),
  ACTIVITY_ERROR: z.object({ code: z.string().max(64), message: z.string().max(300), fatal: z.boolean() }).strict(),
  ACTIVITY_REQUEST_MATCH_CREDENTIAL: z.object({ activitySessionId: z.string().min(1).max(128) }).strict(),
  ACTIVITY_REQUEST_INVITE: z.object({}).strict(),
  ACTIVITY_REQUEST_FULLSCREEN: z.object({ enter: z.boolean() }).strict(),
  ACTIVITY_REQUEST_CLOSE: z.object({ reason: z.string().max(64) }).strict(),
  ACTIVITY_REQUEST_VOICE_ACTION: z.object({ action: z.enum(['toggle_mute', 'join', 'leave']) }).strict(),
  ACTIVITY_SESSION_STATE_CHANGED: z.object({ state: z.enum(['loading', 'lobby', 'in_match', 'results', 'reconnecting', 'error']), matchId: z.string().max(128).optional() }).strict(),
  ACTIVITY_CLOSED: z.object({}).strict(),
} as const;

export type PayloadOf<T extends keyof typeof PayloadSchemas> = z.infer<(typeof PayloadSchemas)[T]>;

export const MatchCredentialResponseSchema = z.object({ credential: z.string().min(10).max(4096), expiresAt: z.number(), gameServerUrl: z.string().max(512) }).strict();
export type MatchCredentialResponse = z.infer<typeof MatchCredentialResponseSchema>;

export function parseEnvelope(raw: unknown, expectedNonce: string, allowed: readonly string[]): { ok: true; env: Envelope; payload: unknown } | { ok: false; reason: string } {
  const e = EnvelopeSchema.safeParse(raw);
  if (!e.success) return { ok: false, reason: 'envelope_invalido' };
  if (e.data.nonce !== expectedNonce) return { ok: false, reason: 'nonce_invalido' };
  if (!allowed.includes(e.data.type)) return { ok: false, reason: 'tipo_desconhecido' };
  const schema = (PayloadSchemas as Record<string, z.ZodType>)[e.data.type];
  if (!schema) return { ok: false, reason: 'tipo_desconhecido' };
  const p = schema.safeParse(e.data.payload);
  if (!p.success) return { ok: false, reason: 'payload_invalido' };
  return { ok: true, env: e.data, payload: p.data };
}

export function randomNonce(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
