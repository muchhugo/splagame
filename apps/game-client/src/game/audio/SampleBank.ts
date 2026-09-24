// Carrega e decodifica os arquivos de áudio do jogo. O download começa cedo
// (não precisa de gesto do usuário); a decodificação acontece quando existe um
// AudioContext. Falhas são registradas uma vez e o efeito correspondente fica
// mudo — nunca travam a partida.

export interface BankStatus {
  total: number;
  decoded: number;
  failed: string[];
}

export class SampleBank {
  private readonly bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly failed = new Set<string>();
  private decoding: Promise<void> | null = null;

  constructor(
    private readonly files: Map<string, string>,
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  get status(): BankStatus {
    return { total: this.files.size, decoded: this.buffers.size, failed: [...this.failed] };
  }

  /** Inicia os downloads (idempotente). */
  prefetch(): void {
    for (const [name, rel] of this.files) {
      if (this.bytes.has(name)) continue;
      const url = this.baseUrl + rel;
      this.bytes.set(
        name,
        this.fetcher(url)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .catch((e: unknown) => {
            this.fail(name, `download de ${url}: ${e instanceof Error ? e.message : String(e)}`);
            return null;
          }),
      );
    }
  }

  /** Decodifica tudo no contexto dado (idempotente; resolve mesmo com falhas). */
  decodeAll(ctx: BaseAudioContext): Promise<void> {
    if (this.decoding) return this.decoding;
    this.prefetch();
    this.decoding = Promise.all(
      [...this.bytes].map(async ([name, p]) => {
        const data = await p;
        if (!data || this.buffers.has(name)) return;
        try {
          this.buffers.set(name, await ctx.decodeAudioData(data.slice(0)));
        } catch (e) {
          this.fail(name, `decodificação: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    ).then(() => undefined);
    return this.decoding;
  }

  get(name: string): AudioBuffer | undefined {
    return this.buffers.get(name);
  }

  private fail(name: string, why: string): void {
    if (this.failed.has(name)) return;
    this.failed.add(name);
    console.warn(`[audio] efeito "${name}" indisponível (${why}); o jogo segue sem ele.`);
  }
}
