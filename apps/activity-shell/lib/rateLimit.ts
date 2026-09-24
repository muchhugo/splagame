/**
 * Token bucket em memória, por chave (ex.: IP + usuário). Suficiente para o
 * laboratório (processo único). Não é distribuído nem persistente.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedMs: number }>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(opts: { capacity: number; refillPerMinute: number; now?: () => number; maxKeys?: number }) {
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerMinute / 60_000;
    this.now = opts.now ?? Date.now;
    this.maxKeys = opts.maxKeys ?? 10_000;
  }

  take(key: string): { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number } {
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.prune(now);
      b = { tokens: this.capacity, updatedMs: now };
      this.buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + (now - b.updatedMs) * this.refillPerMs);
      b.updatedMs = now;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, remaining: Math.floor(b.tokens) };
    }
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / this.refillPerMs / 1000)) };
  }

  private prune(now: number) {
    for (const [k, b] of this.buckets) {
      if (b.tokens + (now - b.updatedMs) * this.refillPerMs >= this.capacity) this.buckets.delete(k);
    }
    // Ainda cheio (abuso): descarta os mais antigos.
    if (this.buckets.size >= this.maxKeys) {
      const drop = this.buckets.size - Math.floor(this.maxKeys / 2);
      let i = 0;
      for (const k of this.buckets.keys()) {
        if (i++ >= drop) break;
        this.buckets.delete(k);
      }
    }
  }
}
