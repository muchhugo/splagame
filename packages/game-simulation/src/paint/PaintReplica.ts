import type { PaintDeltaWire, PaintSnapshotWire } from '@borrifo/game-contracts';
import { PaintState } from './PaintState';
import type { PaintLayout } from './PaintLayout';

export type ReplicaStatus = 'awaiting_snapshot' | 'synced';

/**
 * Réplica de tinta no cliente. Protocolo:
 * - Ao entrar/ressincronizar, aguarda snapshot com corte em `paintSeq`.
 * - Deltas que chegam antes do snapshot ficam em buffer (limitado).
 * - Após o snapshot, descarta deltas com toSeq <= corte e aplica os demais em ordem.
 * - Lacuna, versão de chunk divergente ou rodada diferente => pede ressincronização.
 */
export class PaintReplica {
  readonly state: PaintState;
  status: ReplicaStatus = 'awaiting_snapshot';
  private buffer: PaintDeltaWire[] = [];
  private expectedRound = -1;
  private expectedContext = 0;
  static readonly MAX_BUFFER = 256;
  resyncRequests = 0;

  constructor(
    layout: PaintLayout,
    private readonly hooks: {
      onCellsChanged?: (cells: number[]) => void;
      onFullReset?: () => void;
      requestResync?: (roundId: number, reason: string) => void;
    } = {},
  ) {
    this.state = new PaintState(layout);
  }

  /** Nova rodada: invalida tudo que for anterior. */
  expectRound(roundId: number, contextTag: number) {
    this.expectedRound = roundId;
    this.expectedContext = contextTag;
    this.state.reset(roundId, contextTag);
    this.buffer = [];
    this.status = 'awaiting_snapshot';
    this.hooks.onFullReset?.();
  }

  receiveSnapshot(s: PaintSnapshotWire): 'applied' | 'ignored' {
    if (s.roundId !== this.expectedRound || s.contextTag !== this.expectedContext) return 'ignored';
    this.state.applySnapshot(s);
    this.status = 'synced';
    this.hooks.onFullReset?.();
    const pending = this.buffer.filter((d) => d.roundId === s.roundId && d.toSeq > s.paintSeq).sort((a, b) => a.fromSeq - b.fromSeq);
    this.buffer = [];
    for (const d of pending) {
      if (this.receiveDelta(d) === 'resync') break;
    }
    return 'applied';
  }

  receiveDelta(d: PaintDeltaWire): 'applied' | 'buffered' | 'ignored' | 'resync' {
    if (d.roundId !== this.expectedRound || d.contextTag !== this.expectedContext) return 'ignored';
    if (this.status === 'awaiting_snapshot') {
      if (this.buffer.length >= PaintReplica.MAX_BUFFER) this.buffer.shift();
      this.buffer.push(d);
      return 'buffered';
    }
    if (d.toSeq <= this.state.paintSeq) return 'ignored'; // duplicado/antigo
    const changed: number[] = [];
    const res = this.state.applyDelta(d, changed);
    if (!res.ok) {
      this.status = 'awaiting_snapshot';
      this.buffer = [d];
      this.resyncRequests++;
      this.hooks.requestResync?.(this.expectedRound, res.reason);
      return 'resync';
    }
    if (changed.length) this.hooks.onCellsChanged?.(changed);
    return 'applied';
  }
}
