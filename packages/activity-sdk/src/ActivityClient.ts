import {
  ACTIVITY_PROTOCOL_VERSION,
  HOST_TO_ACTIVITY,
  PayloadSchemas,
  parseEnvelope,
  type ActivityContext,
  type ActivityToHostType,
  type Envelope,
  type HostToActivityType,
  type PayloadOf,
  type VoiceState,
} from './protocol';

type HostEventType = Exclude<HostToActivityType, 'RESPONSE' | 'ACTIVITY_INIT'>;
type Handler<T extends HostEventType> = (payload: PayloadOf<T>) => void;

export class ActivityRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Lado da Atividade (dentro do iframe). Após o handshake, toda comunicação
 * passa por um MessagePort privado — nada de postMessage('*').
 */
export class ActivityClient {
  context: ActivityContext;
  voice: VoiceState;
  private handlers = new Map<string, Set<(p: unknown) => void>>();
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private seq = 0;
  private closed = false;
  droppedMessages = 0;

  private constructor(
    private readonly port: MessagePort,
    private readonly nonce: string,
    init: PayloadOf<'ACTIVITY_INIT'>,
  ) {
    this.context = init.context;
    this.voice = init.voice;
    port.onmessage = (ev) => this.onPortMessage(ev.data);
    port.start();
  }

  /**
   * Aguarda ACTIVITY_INIT do host. Valida origem (lista explícita), `source`
   * (tem de ser a janela pai), nonce do fragmento da URL e esquema.
   */
  static connect(opts: { allowedHostOrigins: string[]; nonce: string; timeoutMs?: number; win?: Window }): Promise<ActivityClient> {
    const win = opts.win ?? window;
    return new Promise((resolve, reject) => {
      let done = false;
      const onMessage = (ev: MessageEvent) => {
        if (done) return;
        if (ev.source !== win.parent || !opts.allowedHostOrigins.includes(ev.origin)) return;
        const parsed = parseEnvelope(ev.data, opts.nonce, ['ACTIVITY_INIT']);
        if (!parsed.ok) return;
        const port = ev.ports?.[0];
        if (!port) return;
        done = true;
        cleanup();
        resolve(new ActivityClient(port, opts.nonce, parsed.payload as PayloadOf<'ACTIVITY_INIT'>));
      };
      const hello = setInterval(() => sayHello(), 500);
      const timer = setTimeout(() => {
        cleanup();
        reject(new ActivityRequestError('handshake_timeout', 'O host não respondeu ao handshake da Atividade.'));
      }, opts.timeoutMs ?? 10000);
      const cleanup = () => {
        win.removeEventListener('message', onMessage);
        clearInterval(hello);
        clearTimeout(timer);
      };
      const sayHello = () => {
        const env: Envelope = { v: ACTIVITY_PROTOCOL_VERSION, type: 'ACTIVITY_HELLO', nonce: opts.nonce, payload: { protocolVersion: ACTIVITY_PROTOCOL_VERSION } };
        // Envia apenas para origens permitidas; o navegador descarta se a janela pai não for dessa origem.
        for (const o of opts.allowedHostOrigins) {
          try {
            win.parent.postMessage(env, o);
          } catch {
            /* origem diferente */
          }
        }
      };
      win.addEventListener('message', onMessage);
      sayHello();
    });
  }

  /** Conexão direta a um MessagePort (host de desenvolvimento no mesmo processo). */
  static fromPort(port: MessagePort, nonce: string, init: PayloadOf<'ACTIVITY_INIT'>): ActivityClient {
    return new ActivityClient(port, nonce, init);
  }

  private onPortMessage(raw: unknown) {
    if (this.closed) return;
    const parsed = parseEnvelope(raw, this.nonce, HOST_TO_ACTIVITY);
    if (!parsed.ok) {
      this.droppedMessages++;
      return;
    }
    const { env, payload } = parsed;
    if (env.type === 'RESPONSE') {
      const p = env.replyTo ? this.pending.get(env.replyTo) : undefined;
      if (!p) return;
      this.pending.delete(env.replyTo!);
      clearTimeout(p.timer);
      const r = payload as PayloadOf<'RESPONSE'>;
      if (r.ok) p.resolve(r.data);
      else p.reject(new ActivityRequestError(r.code, r.error));
      return;
    }
    if (env.type === 'ACTIVITY_CONTEXT_UPDATED') this.context = (payload as PayloadOf<'ACTIVITY_CONTEXT_UPDATED'>).context;
    if (env.type === 'VOICE_STATE_UPDATED') this.voice = (payload as PayloadOf<'VOICE_STATE_UPDATED'>).voice;
    const hs = this.handlers.get(env.type);
    if (hs) for (const h of hs) h(payload);
  }

  on<T extends HostEventType>(type: T, handler: Handler<T>): () => void {
    let s = this.handlers.get(type);
    if (!s) this.handlers.set(type, (s = new Set()));
    s.add(handler as (p: unknown) => void);
    return () => s!.delete(handler as (p: unknown) => void);
  }

  send<T extends Exclude<ActivityToHostType, 'ACTIVITY_REQUEST_MATCH_CREDENTIAL' | 'ACTIVITY_REQUEST_INVITE' | 'ACTIVITY_REQUEST_VOICE_ACTION' | 'ACTIVITY_REQUEST_FULLSCREEN'>>(type: T, payload: PayloadOf<T>) {
    if (this.closed) return;
    PayloadSchemas[type].parse(payload);
    const env: Envelope = { v: ACTIVITY_PROTOCOL_VERSION, type, nonce: this.nonce, payload };
    this.port.postMessage(env);
  }

  /** Pedido com correlação e timeout. */
  request<R = unknown>(type: 'ACTIVITY_REQUEST_MATCH_CREDENTIAL' | 'ACTIVITY_REQUEST_INVITE' | 'ACTIVITY_REQUEST_VOICE_ACTION' | 'ACTIVITY_REQUEST_FULLSCREEN', payload: PayloadOf<typeof type>, timeoutMs = 10000): Promise<R> {
    if (this.closed) return Promise.reject(new ActivityRequestError('closed', 'Atividade encerrada'));
    PayloadSchemas[type].parse(payload);
    const id = `r${++this.seq}`;
    const env: Envelope = { v: ACTIVITY_PROTOCOL_VERSION, type, nonce: this.nonce, id, payload };
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ActivityRequestError('timeout', 'O host não respondeu a tempo.'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.port.postMessage(env);
    });
  }

  /** Libera o canal. Não afeta a chamada do host. */
  close() {
    if (this.closed) return;
    try {
      this.send('ACTIVITY_CLOSED', {});
    } catch {
      /* ignore */
    }
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ActivityRequestError('closed', 'Atividade encerrada'));
    }
    this.pending.clear();
    this.handlers.clear();
    this.port.onmessage = null;
    this.port.close();
  }
}
