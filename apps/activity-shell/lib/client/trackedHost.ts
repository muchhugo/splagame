import { ActivityHost } from '@borrifo/activity-sdk';

/**
 * Contadores de módulo usados pelo teste de vazamento ("Abrir/fechar 10×").
 * Depois de fechar a Atividade, hosts, iframes e ouvintes devem voltar a zero.
 */
export interface LeakCounters {
  hosts: number;
  listeners: number;
  iframes: number;
}

const counters = { hosts: 0, listeners: 0 };
const subs = new Set<() => void>();
const ZERO: LeakCounters = { hosts: 0, listeners: 0, iframes: 0 };
let snapshot: LeakCounters = ZERO;

function countIframes(): number {
  return typeof document === 'undefined' ? 0 : document.querySelectorAll('iframe[data-borrifo-activity]').length;
}

/** Recalcula o snapshot (inclui iframes no DOM) e avisa os assinantes. */
export function notifyLeakCounters(): void {
  const next = { hosts: counters.hosts, listeners: counters.listeners, iframes: countIframes() };
  if (next.hosts === snapshot.hosts && next.listeners === snapshot.listeners && next.iframes === snapshot.iframes) return;
  snapshot = next;
  subs.forEach((s) => s());
}

export function subscribeLeakCounters(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** Snapshot estável (mesma referência enquanto nada muda) para useSyncExternalStore. */
export const getLeakCounters = (): LeakCounters => snapshot;
export const getServerLeakCounters = (): LeakCounters => ZERO;

/** Registra um ouvinte/observador do host; devolve a função que o remove (idempotente). */
export function trackListener(remove: () => void): () => void {
  counters.listeners++;
  notifyLeakCounters();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    remove();
    counters.listeners--;
    notifyLeakCounters();
  };
}

/** ActivityHost do sdk com contagem de instâncias vivas. `destroy()` é idempotente. */
export class LabActivityHost extends ActivityHost {
  private live = true;

  constructor(opts: ConstructorParameters<typeof ActivityHost>[0]) {
    super(opts);
    counters.hosts++;
    notifyLeakCounters();
  }

  override destroy(): void {
    super.destroy();
    if (!this.live) return;
    this.live = false;
    counters.hosts--;
    notifyLeakCounters();
  }
}
