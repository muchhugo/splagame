/** Balde de fichas simples: capacidade + reposição por segundo (relógio monotônico). */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.tokens = capacity;
    this.last = now();
  }
  take(n = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSecond);
    this.last = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/**
 * Limitador por chave (ex.: IP) com LRU de verdade: a chave usada vai para o fim; acima do
 * teto, as menos recentes saem primeiro (uma enxurrada de chaves novas não cresce a memória
 * sem limite e não apaga quem está ativo antes dos ociosos).
 */
export class KeyedRateLimiter {
  private buckets = new Map<string, { b: TokenBucket; seen: number }>();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    readonly maxKeys = 50_000,
    private readonly now: () => number = () => Date.now(),
  ) {}
  take(key: string): boolean {
    const now = this.now();
    let e = this.buckets.get(key);
    if (e) this.buckets.delete(key);
    else e = { b: new TokenBucket(this.capacity, this.refillPerSecond), seen: now };
    e.seen = now;
    this.buckets.set(key, e);
    while (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    return e.b.take();
  }
  get size() {
    return this.buckets.size;
  }
}
