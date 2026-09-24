import {
  ACTIVITY_PROTOCOL_VERSION,
  ACTIVITY_TO_HOST,
  parseEnvelope,
  type ActivityContext,
  type Envelope,
  type HostToActivityType,
  type PayloadOf,
  type VoiceState,
  type MatchCredentialResponse,
} from './protocol';

export interface ActivityHostHandlers {
  onReady?(p: PayloadOf<'ACTIVITY_READY'>): void;
  onLoading?(p: PayloadOf<'ACTIVITY_LOADING_PROGRESS'>): void;
  onError?(p: PayloadOf<'ACTIVITY_ERROR'>): void;
  onSessionState?(p: PayloadOf<'ACTIVITY_SESSION_STATE_CHANGED'>): void;
  onClosed?(): void;
  onRejectedMessage?(reason: string): void;
  requestMatchCredential(p: PayloadOf<'ACTIVITY_REQUEST_MATCH_CREDENTIAL'>): Promise<MatchCredentialResponse>;
  requestInvite?(): Promise<{ shared: boolean }>;
  requestFullscreen?(p: PayloadOf<'ACTIVITY_REQUEST_FULLSCREEN'>): Promise<{ fullscreen: boolean }>;
  requestClose?(p: PayloadOf<'ACTIVITY_REQUEST_CLOSE'>): void;
  voiceAction?(p: PayloadOf<'ACTIVITY_REQUEST_VOICE_ACTION'>): Promise<{ accepted: boolean }>;
}

export class HostRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Lado do host. Faz o handshake com o iframe (origem e janela verificadas) e
 * entrega um MessagePort privado; depois só aceita mensagens por esse canal.
 * Objetos vivos (ex.: Room do LiveKit) nunca atravessam a fronteira.
 */
export class ActivityHost {
  private port: MessagePort | null = null;
  private channel: MessageChannel | null = null;
  private target: Window | null = null;
  private windowListener: ((ev: MessageEvent) => void) | null = null;
  private destroyed = false;
  rejected = 0;

  constructor(
    private readonly opts: {
      activityOrigin: string;
      nonce: string;
      context: ActivityContext;
      voice: VoiceState;
      handlers: ActivityHostHandlers;
      hostWindow?: Window;
    },
  ) {}

  get connected() {
    return this.port !== null;
  }

  /** Iframe: aguarda HELLO vindo exatamente desse iframe e da origem esperada. */
  attachIframe(iframe: HTMLIFrameElement) {
    const win = this.opts.hostWindow ?? window;
    this.windowListener = (ev: MessageEvent) => {
      if (this.destroyed) return;
      if (ev.source !== iframe.contentWindow || ev.origin !== this.opts.activityOrigin) return;
      const parsed = parseEnvelope(ev.data, this.opts.nonce, ['ACTIVITY_HELLO']);
      if (!parsed.ok) {
        this.reject(parsed.reason);
        return;
      }
      this.target = iframe.contentWindow;
      this.sendInit();
    };
    win.addEventListener('message', this.windowListener);
  }

  /** Conexão direta (host de desenvolvimento no mesmo documento). */
  connectLocal(): MessagePort {
    this.channel = new MessageChannel();
    this.bindPort(this.channel.port1);
    return this.channel.port2;
  }

  initPayload(): PayloadOf<'ACTIVITY_INIT'> {
    return { context: this.opts.context, voice: this.opts.voice };
  }

  private sendInit() {
    if (!this.target || this.destroyed) return;
    // Um novo canal a cada INIT (recarga do iframe); o anterior é fechado.
    this.port?.close();
    this.channel = new MessageChannel();
    this.bindPort(this.channel.port1);
    const env: Envelope = { v: ACTIVITY_PROTOCOL_VERSION, type: 'ACTIVITY_INIT', nonce: this.opts.nonce, payload: this.initPayload() };
    this.target.postMessage(env, this.opts.activityOrigin, [this.channel.port2]);
  }

  private bindPort(port: MessagePort) {
    this.port = port;
    port.onmessage = (ev) => void this.onPortMessage(ev.data);
    port.start();
  }

  private reject(reason: string) {
    this.rejected++;
    this.opts.handlers.onRejectedMessage?.(reason);
  }

  private post(type: HostToActivityType, payload: unknown, replyTo?: string) {
    if (!this.port || this.destroyed) return;
    const env: Envelope = { v: ACTIVITY_PROTOCOL_VERSION, type, nonce: this.opts.nonce, payload, ...(replyTo ? { replyTo } : {}) };
    this.port.postMessage(env);
  }

  private async onPortMessage(raw: unknown) {
    const parsed = parseEnvelope(raw, this.opts.nonce, ACTIVITY_TO_HOST);
    if (!parsed.ok) return this.reject(parsed.reason);
    const { env, payload } = parsed;
    const h = this.opts.handlers;
    const respond = async (fn: () => Promise<unknown>) => {
      if (!env.id) return this.reject('pedido_sem_id');
      try {
        const data = await fn();
        this.post('RESPONSE', { ok: true, data }, env.id);
      } catch (e) {
        const err = e instanceof HostRequestError ? e : new HostRequestError('host_error', 'Falha no host');
        this.post('RESPONSE', { ok: false, error: err.message.slice(0, 200), code: err.code }, env.id);
      }
    };
    switch (env.type) {
      case 'ACTIVITY_HELLO':
        return; // já conectado
      case 'ACTIVITY_READY':
        return h.onReady?.(payload as PayloadOf<'ACTIVITY_READY'>);
      case 'ACTIVITY_LOADING_PROGRESS':
        return h.onLoading?.(payload as PayloadOf<'ACTIVITY_LOADING_PROGRESS'>);
      case 'ACTIVITY_ERROR':
        return h.onError?.(payload as PayloadOf<'ACTIVITY_ERROR'>);
      case 'ACTIVITY_SESSION_STATE_CHANGED':
        return h.onSessionState?.(payload as PayloadOf<'ACTIVITY_SESSION_STATE_CHANGED'>);
      case 'ACTIVITY_CLOSED':
        return h.onClosed?.();
      case 'ACTIVITY_REQUEST_CLOSE':
        return h.requestClose?.(payload as PayloadOf<'ACTIVITY_REQUEST_CLOSE'>);
      case 'ACTIVITY_REQUEST_MATCH_CREDENTIAL': {
        const p = payload as PayloadOf<'ACTIVITY_REQUEST_MATCH_CREDENTIAL'>;
        return respond(async () => {
          // A Atividade só pode pedir credencial da sessão que o host abriu.
          if (p.activitySessionId !== this.opts.context.activitySessionId) throw new HostRequestError('wrong_session', 'Sessão diferente da aberta pelo host');
          if (!this.opts.context.capabilities.canJoinMatch) throw new HostRequestError('forbidden', 'Sem permissão para entrar na partida');
          return h.requestMatchCredential(p);
        });
      }
      case 'ACTIVITY_REQUEST_INVITE':
        return respond(async () => {
          if (!h.requestInvite || !this.opts.context.capabilities.canInvite) throw new HostRequestError('unsupported', 'Convites não disponíveis neste host');
          return h.requestInvite();
        });
      case 'ACTIVITY_REQUEST_FULLSCREEN':
        return respond(async () => {
          if (!h.requestFullscreen) throw new HostRequestError('unsupported', 'Tela cheia não disponível');
          return h.requestFullscreen(payload as PayloadOf<'ACTIVITY_REQUEST_FULLSCREEN'>);
        });
      case 'ACTIVITY_REQUEST_VOICE_ACTION':
        return respond(async () => {
          if (!h.voiceAction || !this.opts.context.capabilities.canUseVoice) throw new HostRequestError('unsupported', 'Voz não configurada neste ambiente');
          return h.voiceAction(payload as PayloadOf<'ACTIVITY_REQUEST_VOICE_ACTION'>);
        });
      default:
        return this.reject('tipo_desconhecido');
    }
  }

  updateContext(context: ActivityContext) {
    this.opts.context = context;
    this.post('ACTIVITY_CONTEXT_UPDATED', { context });
  }
  setVisibility(visible: boolean) {
    this.post('ACTIVITY_VISIBILITY_CHANGED', { visible });
  }
  resize(width: number, height: number) {
    this.post('ACTIVITY_RESIZE', { width: Math.round(width), height: Math.round(height) });
  }
  suspend(reason: string) {
    this.post('ACTIVITY_SUSPEND', { reason });
  }
  resume() {
    this.post('ACTIVITY_RESUME', {});
  }
  requestClose(reason: string) {
    this.post('ACTIVITY_CLOSE_REQUESTED', { reason });
  }
  setVoice(voice: VoiceState) {
    this.opts.voice = voice;
    this.post('VOICE_STATE_UPDATED', { voice });
  }

  destroy() {
    this.destroyed = true;
    if (this.windowListener) (this.opts.hostWindow ?? window).removeEventListener('message', this.windowListener);
    this.windowListener = null;
    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
    }
    this.port = null;
    this.target = null;
  }
}
