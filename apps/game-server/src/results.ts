import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RoundResult } from '@borrifo/game-contracts';
import { log } from './logger';

/**
 * Destino do resultado agregado da rodada. Escrito apenas pelo servidor de
 * partidas (componente confiável), com idempotência por (matchId, roundId).
 */
export interface ResultSink {
  write(activitySessionId: string, result: RoundResult): Promise<'written' | 'duplicate'>;
}

/** Laboratório: arquivo JSONL local, idempotente. Não é banco de produção. */
export class JsonlResultSink implements ResultSink {
  private seen = new Set<string>();
  /** Leitura única e compartilhada: escritas simultâneas no início esperam a mesma leitura. */
  private loading: Promise<void> | null = null;
  /** Chaves em gravação (duas chamadas iguais ao mesmo tempo gravam uma vez). */
  private writing = new Map<string, Promise<'written' | 'duplicate'>>();
  constructor(private readonly file: string) {}

  private load(): Promise<void> {
    this.loading ??= this.readExisting();
    return this.loading;
  }

  private async readExisting() {
    try {
      const txt = await readFile(this.file, 'utf8');
      for (const line of txt.split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as { key: string };
          this.seen.add(r.key);
        } catch {
          /* linha corrompida ignorada */
        }
      }
    } catch {
      /* arquivo ainda não existe */
    }
  }

  async write(activitySessionId: string, result: RoundResult): Promise<'written' | 'duplicate'> {
    await this.load();
    const key = `${result.matchId}:${result.roundId}`;
    if (this.seen.has(key)) return 'duplicate';
    const inFlight = this.writing.get(key);
    if (inFlight) return inFlight.then(() => 'duplicate' as const);
    const p = this.append(activitySessionId, key, result);
    this.writing.set(key, p);
    try {
      return await p;
    } finally {
      this.writing.delete(key);
    }
  }

  private async append(activitySessionId: string, key: string, result: RoundResult): Promise<'written' | 'duplicate'> {
    await mkdir(dirname(this.file), { recursive: true });
    const row = {
      key,
      activitySessionId,
      matchId: result.matchId,
      roundId: result.roundId,
      mapId: result.mapId,
      status: result.status,
      winner: result.winner,
      teamUnits: result.teamUnits,
      totalUnits: result.totalUnits,
      percent: result.percent,
      players: result.players.map((p) => ({ playerId: p.playerId, team: p.team, isBot: p.isBot, paintedArea: p.paintedArea, eliminations: p.eliminations, deaths: p.deaths })),
      writtenAt: new Date().toISOString(),
    };
    await appendFile(this.file, JSON.stringify(row) + '\n', 'utf8');
    // só marca como gravado DEPOIS de gravar: se a escrita falhar, a próxima tentativa grava
    this.seen.add(key);
    log('info', 'result.persisted', { activitySessionId, matchId: result.matchId, roundId: result.roundId, winner: result.winner });
    return 'written';
  }
}

export class MemoryResultSink implements ResultSink {
  rows = new Map<string, RoundResult>();
  async write(_sid: string, result: RoundResult) {
    const key = `${result.matchId}:${result.roundId}`;
    if (this.rows.has(key)) return 'duplicate' as const;
    this.rows.set(key, result);
    return 'written' as const;
  }
}
