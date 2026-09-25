import type { BuffKind, CapsuleState, GameEvent, ObjectiveSnapshot, PickupSnapshot, TeamId, Vec3 } from '@borrifo/game-contracts';
import { TICK_DT } from '@borrifo/game-contracts';
import { BUFFS, CORREIO, MUTIRAO, type MapSpec } from '@borrifo/game-content';
import type { PaintLayout } from '../paint/PaintLayout';
import type { PaintState } from '../paint/PaintState';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { SimPlayer } from './types';

/** Contexto mínimo que os sistemas de modo usam da simulação (facilita os testes). */
export interface ModeHost {
  readonly tick: number;
  readonly players: Map<number, SimPlayer>;
  readonly layout: PaintLayout;
  readonly paint: PaintState;
  readonly physics: PhysicsWorld;
  readonly map: MapSpec;
  emit(ev: GameEvent, to?: number): void;
}

const secs = (s: number) => Math.round(s / TICK_DT);
const r2 = (v: Vec3): Vec3 => [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100, Math.round(v[2] * 100) / 100];
const hdist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const sorted = (h: ModeHost) => [...h.players.values()].sort((a, b) => a.id - b.id);

/** Estado de buffs/combos por jogador (autoridade do servidor). */
export interface PlayerModeState {
  buff: BuffKind | null;
  buffTicks: number;
  mutiraoTicks: number;
  mutiraoCooldownTicks: number;
  mutiroes: number;
  deliveries: number;
}

export function freshModeState(): PlayerModeState {
  return { buff: null, buffTicks: 0, mutiraoTicks: 0, mutiraoCooldownTicks: 0, mutiroes: 0, deliveries: 0 };
}

/** Aplica os modificadores ao estado previsto: Embalo na velocidade; Fôlego × Mutirão não acumulam (vale o maior). */
export function applyModifiers(p: SimPlayer, m: PlayerModeState) {
  p.state.speedMul = m.buff === 'embalo' && m.buffTicks > 0 ? BUFFS.embalo.speedMul : 1;
  const folego = m.buff === 'folego' && m.buffTicks > 0 ? BUFFS.folego.inkMul : 1;
  const mut = m.mutiraoTicks > 0 ? MUTIRAO.inkMul : 1;
  p.state.inkRegenMul = Math.max(folego, mut);
}

/* ------------------------------------------------------------------ */
/* Pickups: Embalo e Fôlego                                            */
/* ------------------------------------------------------------------ */

export class BuffPickups {
  private readonly items: Array<{ pos: Vec3; kind: BuffKind; readyAt: number; available: boolean }>;

  constructor(private readonly h: ModeHost, startTick: number) {
    this.items = h.map.objectives.pickups.map((p) => ({ pos: p.pos, kind: p.kind, readyAt: startTick + secs(BUFFS.firstSpawnSeconds), available: false }));
  }

  step(state: (p: SimPlayer) => PlayerModeState) {
    const h = this.h;
    for (const [i, it] of this.items.entries()) {
      if (!it.available) {
        if (h.tick >= it.readyAt) {
          it.available = true;
          h.emit({ k: 'pickupSpawn', pickup: i, kind: it.kind });
        } else continue;
      }
      // candidatos: vivos, fora da proteção de spawn, perto e com linha livre (nada através de parede)
      let best: SimPlayer | null = null;
      let bestD = Infinity;
      for (const p of sorted(h)) {
        const s = p.state;
        if (!s.alive || s.spawnProtect > 0 || s.travelPhase !== 0) continue;
        const d = hdist(s.pos, it.pos);
        if (d > BUFFS.pickupRadius || Math.abs(s.pos[1] - it.pos[1]) > 1.2) continue;
        if (h.physics.segmentBlocked([s.pos[0], s.pos[1] + 0.8, s.pos[2]], [it.pos[0], it.pos[1] + 0.5, it.pos[2]], 0)) continue;
        // coleta simultânea: o mais próximo leva; empate exato → menor id (ordem determinística)
        if (d < bestD - 1e-9) {
          best = p;
          bestD = d;
        }
      }
      if (!best) continue;
      const m = state(best);
      const replaced = m.buff && m.buffTicks > 0 ? m.buff : null;
      m.buff = it.kind;
      m.buffTicks = secs(it.kind === 'embalo' ? BUFFS.embalo.duration : BUFFS.folego.duration);
      it.available = false;
      it.readyAt = h.tick + secs(BUFFS.respawnSeconds);
      h.emit({ k: 'buff', pid: best.id, kind: it.kind, replaced, pickup: i });
    }
  }

  snapshot(): PickupSnapshot[] {
    return this.items.map((it, i) => ({ i, k: it.kind, a: it.available ? 1 : 0, t: it.available ? 0 : Math.max(0, Math.round((it.readyAt - this.h.tick) * TICK_DT * 10) / 10) }));
  }
}

/* ------------------------------------------------------------------ */
/* Mutirão: pintura conjunta de aliados                                */
/* ------------------------------------------------------------------ */

interface Conversion {
  tick: number;
  cell: number;
  area: number;
  pos: Vec3;
}

export class MutiraoTracker {
  private recent = new Map<number, Conversion[]>();
  /** célula → tick em que financiou uma ativação. */
  private spent = new Map<number, number>();
  private readonly window = secs(MUTIRAO.windowSeconds);
  private readonly reuse = secs(MUTIRAO.cellReuseSeconds);

  constructor(private readonly h: ModeHost) {}

  /** Chamado pelo sink de tinta quando `p` converte uma célula de outra cor/neutra para a sua. */
  record(p: SimPlayer, cell: number, prevOwner: number, area: number) {
    if (prevOwner === p.team) return;
    let list = this.recent.get(p.id);
    if (!list) this.recent.set(p.id, (list = []));
    list.push({ tick: this.h.tick, cell, area, pos: this.h.layout.cellCenter(cell) });
    // aparo aqui também: quem está morto ou em recarga não passa por eligible() e a lista cresceria
    const from = this.h.tick - this.window;
    while (list.length && list[0].tick < from) list.shift();
  }

  private eligible(p: SimPlayer): { area: number; centroid: Vec3; cells: number[] } | null {
    const list = this.recent.get(p.id);
    if (!list) return null;
    const from = this.h.tick - this.window;
    while (list.length && list[0].tick < from) list.shift();
    let area = 0;
    const c: Vec3 = [0, 0, 0];
    const cells: number[] = [];
    for (const x of list) {
      const at = this.spent.get(x.cell);
      if (at !== undefined && this.h.tick - at < this.reuse) continue;
      area += x.area;
      c[0] += x.pos[0] * x.area;
      c[1] += x.pos[1] * x.area;
      c[2] += x.pos[2] * x.area;
      cells.push(x.cell);
    }
    if (area < MUTIRAO.minArea) return null;
    return { area, centroid: [c[0] / area, c[1] / area, c[2] / area], cells };
  }

  step(state: (p: SimPlayer) => PlayerModeState) {
    const h = this.h;
    if (h.tick % 3 !== 0) return; // 10 Hz basta para o critério
    const ps = sorted(h).filter((p) => p.state.alive && state(p).mutiraoCooldownTicks <= 0);
    const info = new Map<number, ReturnType<MutiraoTracker['eligible']>>();
    for (const p of ps) info.set(p.id, this.eligible(p));
    const used = new Set<number>();
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      const ia = info.get(a.id);
      if (!ia || used.has(a.id)) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.team !== a.team || used.has(b.id)) continue;
        const ib = info.get(b.id);
        if (!ib) continue;
        // mesmo setor: as duas áreas convertidas cabem num círculo de ~6 m
        if (hdist(ia.centroid, ib.centroid) > MUTIRAO.sectorDiameter) continue;
        // áreas distintas (cada célula conta para um só participante)
        const setA = new Set(ia.cells);
        if (ib.cells.some((c) => setA.has(c))) continue;
        for (const c of [...ia.cells, ...ib.cells]) this.spent.set(c, h.tick);
        for (const p of [a, b]) {
          const m = state(p);
          m.mutiraoTicks = secs(MUTIRAO.duration);
          m.mutiraoCooldownTicks = secs(MUTIRAO.cooldown);
          m.mutiroes++;
        }
        used.add(a.id);
        used.add(b.id);
        const mid: Vec3 = [(ia.centroid[0] + ib.centroid[0]) / 2, (ia.centroid[1] + ib.centroid[1]) / 2, (ia.centroid[2] + ib.centroid[2]) / 2];
        h.emit({ k: 'mutirao', a: a.id, b: b.id, team: a.team, p: r2(mid) });
        break;
      }
    }
    // esquece células antigas (memória limitada)
    if (h.tick % 90 === 0) for (const [c, t] of this.spent) if (h.tick - t >= this.reuse) this.spent.delete(c);
  }
}

/* ------------------------------------------------------------------ */
/* Correio do Ara: cápsula de pigmento                                 */
/* ------------------------------------------------------------------ */

export class CorreioMode {
  state: CapsuleState = 'aguardando';
  pos: Vec3;
  carrier: number | null = null;
  station = 0;
  deliveries: [number, number] = [0, 0];
  private timerTicks = 0;
  private progressTicks = 0;
  private carryTicks = 0;
  private stationSeq = 0;
  private readonly stationCells: Array<{ cells: number[]; weight: number[]; total: number }>;
  private lastGrounded = new Map<number, Vec3>();
  lastStationShare: [number, number] = [0, 0];
  /** Vencedor antecipado (alvo de entregas atingido). */
  decided: TeamId | null = null;

  constructor(
    private readonly h: ModeHost,
    startTick: number,
  ) {
    this.pos = [...h.map.objectives.capsule] as Vec3;
    this.timerTicks = startTick + secs(CORREIO.firstSpawnSeconds);
    // células de cada estação (área demarcada), pré-calculadas: o critério de 60% é exato e barato
    this.stationCells = h.map.objectives.stations.map((st) => {
      const cells: number[] = [];
      const weight: number[] = [];
      let total = 0;
      const L = h.layout;
      for (const s of L.surfaces) {
        if (s.traversal !== 'floor') continue;
        for (let k = 0; k < s.cols * s.rows; k++) {
          const c = s.cellOffset + k;
          if (L.weight[c] <= 0) continue;
          const p = L.cellCenter(c);
          if (Math.abs(p[1] - st[1]) > 0.6 || hdist(p, st) > CORREIO.stationRadius) continue;
          cells.push(c);
          weight.push(L.weight[c]);
          total += L.weight[c];
        }
      }
      return { cells, weight, total };
    });
    this.station = this.nextStationIndex();
  }

  /** Sequência definida pelo servidor: alterna os lados (estações vêm em pares oeste/leste). */
  private nextStationIndex(): number {
    const n = this.h.map.objectives.stations.length;
    const pairs = Math.max(1, Math.floor(n / 2));
    const k = this.stationSeq++;
    const pair = Math.floor(k / 2) % pairs;
    const side = k % 2;
    return Math.min(n - 1, pair * 2 + side);
  }

  stationShare(i = this.station): [number, number] {
    const sc = this.stationCells[i];
    if (!sc || sc.total <= 0) return [0, 0];
    let a = 0,
      b = 0;
    const o = this.h.paint.owner;
    for (let k = 0; k < sc.cells.length; k++) {
      const v = o[sc.cells[k]];
      if (v === 0) a += sc.weight[k];
      else if (v === 1) b += sc.weight[k];
    }
    return [a / sc.total, b / sc.total];
  }

  isCarrier(id: number) {
    return this.carrier === id && (this.state === 'carregada' || this.state === 'em_entrega');
  }

  private set(st: CapsuleState, pid: number | null = null) {
    this.state = st;
    const team = pid !== null ? (this.h.players.get(pid)?.team ?? null) : null;
    this.h.emit({ k: 'capsule', st, pid, team, station: this.station });
  }

  /** Portador eliminado, saiu ou desconectou: a cápsula cai num ponto válido. */
  drop(pid: number) {
    if (!this.isCarrier(pid)) return;
    const p = this.h.players.get(pid);
    const at = this.lastGrounded.get(pid) ?? (p ? p.state.pos : this.h.map.objectives.capsule);
    const hit = this.h.physics.raycast([at[0], at[1] + 0.5, at[2]], [0, -1, 0], 6);
    this.carrier = null;
    this.progressTicks = 0;
    this.carryTicks = 0;
    if (!hit || hit.point[1] < this.h.map.killY + 1) return this.startReturn();
    this.pos = [at[0], hit.point[1], at[2]];
    this.timerTicks = this.h.tick + secs(CORREIO.dropReturnSeconds);
    this.set('caida', pid);
  }

  private startReturn() {
    this.carrier = null;
    this.timerTicks = this.h.tick + secs(CORREIO.returningSeconds);
    this.set('retornando');
  }

  private tryPickup(): boolean {
    let best: SimPlayer | null = null;
    let bestD = Infinity;
    for (const p of sorted(this.h)) {
      const s = p.state;
      if (!s.alive || s.travelPhase !== 0 || p.suspended) continue;
      const d = hdist(s.pos, this.pos);
      if (d > CORREIO.pickupRadius || Math.abs(s.pos[1] - this.pos[1]) > 1.3) continue;
      if (d < bestD - 1e-9) {
        best = p;
        bestD = d;
      }
    }
    if (!best) return false;
    this.carrier = best.id;
    this.carryTicks = 0;
    this.progressTicks = 0;
    this.set('carregada', best.id);
    return true;
  }

  step(state: (p: SimPlayer) => PlayerModeState) {
    if (this.decided !== null) return;
    const h = this.h;
    for (const p of h.players.values()) if (p.state.alive && p.state.grounded) this.lastGrounded.set(p.id, [...p.state.pos] as Vec3);
    switch (this.state) {
      case 'aguardando':
      case 'retornando':
      case 'entregue':
        if (h.tick >= this.timerTicks) {
          this.pos = [...h.map.objectives.capsule] as Vec3;
          this.set('disponivel');
        }
        break;
      case 'disponivel':
        this.tryPickup();
        break;
      case 'caida':
        if (!this.tryPickup() && h.tick >= this.timerTicks) this.startReturn();
        break;
      case 'carregada':
      case 'em_entrega': {
        const p = this.carrier !== null ? h.players.get(this.carrier) : undefined;
        if (!p || !p.state.alive) {
          if (p) this.drop(p.id);
          else this.startReturn();
          break;
        }
        this.pos = [p.state.pos[0], p.state.pos[1] + 1.7, p.state.pos[2]];
        this.carryTicks++;
        if (this.carryTicks >= secs(CORREIO.maxCarrySeconds)) {
          // posse longa demais: a cápsula esquenta e volta ao centro (evita travar a partida)
          this.startReturn();
          break;
        }
        const st = h.map.objectives.stations[this.station];
        const share = this.stationShare();
        this.lastStationShare = share;
        const inside = hdist(p.state.pos, st) <= CORREIO.stationRadius && Math.abs(p.state.pos[1] - st[1]) < 1.2;
        const ready = share[p.team] >= CORREIO.stationPaintShare;
        if (inside && ready) {
          if (this.state !== 'em_entrega') this.set('em_entrega', p.id);
          this.progressTicks++;
          if (this.progressTicks >= secs(CORREIO.deliverSeconds)) {
            this.deliveries[p.team]++;
            state(p).deliveries++;
            this.carrier = null;
            this.progressTicks = 0;
            this.station = this.nextStationIndex();
            this.timerTicks = h.tick + secs(CORREIO.deliveredPauseSeconds);
            this.pos = [...st] as Vec3;
            this.set('entregue', p.id);
            if (this.deliveries[p.team] >= CORREIO.targetDeliveries) this.decided = p.team;
          }
        } else if (this.state === 'em_entrega') {
          // saiu da área ou a tinta caiu abaixo do limite: a entrega recomeça
          this.progressTicks = 0;
          this.set('carregada', p.id);
        }
        break;
      }
    }
    if (this.state !== 'carregada' && this.state !== 'em_entrega') this.lastStationShare = this.stationShare();
  }

  snapshot(): ObjectiveSnapshot {
    const t = this.state === 'caida' || this.state === 'retornando' || this.state === 'entregue' || this.state === 'aguardando' ? Math.max(0, (this.timerTicks - this.h.tick) * TICK_DT) : 0;
    return {
      st: this.state,
      p: r2(this.pos),
      c: this.isCarrier(this.carrier ?? -1) ? this.carrier : null,
      s: this.station,
      sp: [Math.round(this.lastStationShare[0] * 100) / 100, Math.round(this.lastStationShare[1] * 100) / 100],
      pr: Math.min(1, this.progressTicks / secs(CORREIO.deliverSeconds)),
      d: [...this.deliveries] as [number, number],
      t: Math.round(t * 10) / 10,
    };
  }
}
