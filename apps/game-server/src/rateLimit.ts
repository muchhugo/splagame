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

/** Limitador por chave (ex.: IP) com expiração de entradas ociosas. */
export class KeyedRateLimiter {
  private buckets = new Map<string, { b: TokenBucket; seen: number }>();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}
  take(key: string): boolean {
    const now = Date.now();
    let e = this.buckets.get(key);
    if (!e) {
      e = { b: new TokenBucket(this.capacity, this.refillPerSecond), seen: now };
      this.buckets.set(key, e);
    }
    e.seen = now;
    if (this.buckets.size > 10000) {
      for (const [k, v] of this.buckets) if (now - v.seen > 60000) this.buckets.delete(k);
    }
    return e.b.take();
  }
}
