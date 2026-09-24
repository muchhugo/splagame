import type { PlayerInput, Vec3 } from '@borrifo/game-contracts';
import { Buttons, FORM_FLOW, GROUND_OWN, INPUT_QUEUE_MAX, PITCH_LIMIT, wrapAngle } from '@borrifo/game-contracts';
import { INK, MORINGA, RODA_DE_OLEIRO, WEAPONS } from '@borrifo/game-content';
import { clamp, Rng } from '../math';
import type { MatchSimulation } from '../match/MatchSimulation';
import { hitHeight } from '../match/MatchSimulation';
import type { BotController, SimPlayer } from '../match/types';
import type { NavGraph } from './NavGraph';

export interface BotDifficulty {
  reactionTime: number;
  aimErrorDeg: number;
  viewRange: number;
  thinkInterval: number;
}

export const BOT_NORMAL: BotDifficulty = { reactionTime: 0.45, aimErrorDeg: 5, viewRange: 17, thinkInterval: 0.2 };

type Mode = 'paint' | 'fight' | 'refill';

/**
 * Bot do servidor: gera PlayerInput e passa pelas MESMAS regras dos humanos
 * (movimento, custo, cadência, tinta). Não edita o mapa nem vê através de
 * paredes: detecção usa linha de visão e ignora inimigos imersos a distância.
 */
export class BotBrain implements BotController {
  private rng: Rng;
  private seq = 0;
  private actionId = 0;
  private mode: Mode = 'paint';
  private path: number[] = [];
  private pathIdx = 0;
  private goal = -1;
  private thinkTimer = 0;
  private stuckTimer = 0;
  private lastProgressPos: Vec3 = [0, 0, 0];
  private target: number | null = null;
  private seenFor = 0;
  private aimYaw = 0;
  private aimPitch = 0.3;
  private strafe = 0;
  private strafeTimer = 0;
  private holdFire = false;
  private wantJump = false;
  private refillHold = 0;
  private lastNode = -1;
  /** Objetivo atual do modo (cápsula, estação, pickup), para replanejar quando muda. */
  private objKey = '';

  constructor(
    private readonly nav: NavGraph,
    seed: number,
    private readonly diff: BotDifficulty = BOT_NORMAL,
  ) {
    this.rng = new Rng(seed);
    void INPUT_QUEUE_MAX;
  }

  think(self: SimPlayer, simAny: unknown): PlayerInput {
    const sim = simAny as MatchSimulation;
    const s = self.state;
    const dt = 1 / 30;
    const input: PlayerInput = { sequence: ++this.seq, clientTick: 0, moveX: 0, moveY: 0, yaw: s.yaw, pitch: s.pitch, heldButtons: 0, pressedActions: [] };
    if (!s.alive || s.travelPhase !== 0 || sim.phase !== 'running') {
      this.path = [];
      this.target = null;
      this.seenFor = 0;
      return input;
    }
    const w = WEAPONS[self.weaponId];

    // ---------- percepção ----------
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = this.diff.thinkInterval;
      const prevTarget = this.target;
      this.target = this.pickTarget(self, sim);
      if (this.target !== prevTarget) this.seenFor = 0;
      if (s.ink < INK.lowThreshold - 5 && this.mode !== 'refill') this.mode = 'refill';
      else if (this.mode === 'refill' && s.ink > 88) this.mode = 'paint';
      if (this.mode !== 'refill') this.mode = this.target !== null ? 'fight' : 'paint';
    }
    if (this.target !== null) this.seenFor += dt;

    // ---------- navegação ----------
    const here = this.nav.nearest(s.pos);
    if (here) this.lastNode = here.id;
    // objetivo do modo: portador vai à estação (e não para para brigar); os demais disputam a cápsula
    const obj = this.objective(self, sim);
    const key = obj ? `${obj.kind}:${obj.pos.map((v) => v.toFixed(0)).join(',')}` : '';
    if (key !== this.objKey) {
      this.objKey = key;
      this.path = [];
    }
    if (obj?.kind === 'entregar') this.mode = 'paint';
    if (this.mode === 'paint' || (this.mode === 'refill' && s.groundState !== GROUND_OWN)) {
      if (this.path.length === 0 || this.pathIdx >= this.path.length) {
        if (obj && this.mode === 'paint') this.planTo(obj.pos);
        else this.planPaintGoal(self, sim);
      }
    }
    let moveDir: Vec3 | null = null;
    if (this.path.length && this.pathIdx < this.path.length) {
      const node = this.nav.nodes[this.path[this.pathIdx]];
      const dx = node.pos[0] - s.pos[0],
        dz = node.pos[2] - s.pos[2];
      const d = Math.hypot(dx, dz);
      if (d < 0.7) this.pathIdx++;
      else moveDir = [dx / d, 0, dz / d];
      if (node.pos[1] - s.pos[1] > 0.5 && d < 1.4) this.wantJump = true;
    }

    // travamento: sem progresso => pular, depois replanejar
    this.stuckTimer += dt;
    if (Math.hypot(s.pos[0] - this.lastProgressPos[0], s.pos[2] - this.lastProgressPos[2]) > 0.8) {
      this.lastProgressPos = [...s.pos] as Vec3;
      this.stuckTimer = 0;
    } else if (this.stuckTimer > 1.2 && moveDir) {
      this.wantJump = true;
      if (this.stuckTimer > 2.6) {
        this.path = [];
        this.stuckTimer = 0;
        this.strafe = this.rng.next() < 0.5 ? -1 : 1;
      }
    }

    let fire = false;
    let flow = false;
    let desiredYaw = s.yaw;
    let desiredPitch = 0.35;

    if (this.mode === 'fight' && this.target !== null) {
      const t = sim.players.get(this.target);
      if (t) {
        const tp: Vec3 = [t.state.pos[0], t.state.pos[1] + hitHeight(t.state) * 0.55, t.state.pos[2]];
        const eye: Vec3 = [s.pos[0], s.pos[1] + 1.1, s.pos[2]];
        const lead = w.kind === 'automatic' ? 0.18 : 0.05;
        const aimP: Vec3 = [tp[0] + t.state.vel[0] * lead, tp[1], tp[2] + t.state.vel[2] * lead];
        const dx = aimP[0] - eye[0],
          dy = aimP[1] - eye[1],
          dz = aimP[2] - eye[2];
        const hd = Math.hypot(dx, dz);
        desiredYaw = Math.atan2(dx, dz);
        desiredPitch = -Math.atan2(dy, hd);
        if (w.kind === 'automatic') desiredPitch -= clamp(hd * 0.012, 0, 0.12); // compensa a queda
        const range = w.kind === 'charge' ? 22 : w.kind === 'contact' ? 6 : 10.5;
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeTimer = this.rng.range(0.5, 1.4);
          this.strafe = this.rng.int(3) - 1;
        }
        if (hd > range * 0.85) moveDir = [dx / hd, 0, dz / hd];
        else if (w.kind === 'contact') moveDir = [dx / hd, 0, dz / hd];
        else moveDir = null;
        if (this.seenFor > this.diff.reactionTime && hd < range) {
          if (w.kind === 'charge') {
            if (s.charging && s.charge >= 0.85) fire = false;
            else fire = true;
          } else fire = true;
        }
        if (s.ink > 70 && hd > 5 && hd < 11 && this.rng.next() < 0.004) input.pressedActions.push({ actionId: ++this.actionId, kind: 'secondary' });
      }
    } else if (this.mode === 'refill') {
      if (s.groundState === GROUND_OWN) {
        flow = true;
        moveDir = this.refillHold > 0 ? null : moveDir;
        this.refillHold = 0.5;
      } else {
        // sem tinta própria sob os pés: pinta o chão logo à frente com o que resta
        desiredPitch = 0.9;
        fire = s.ink > 3;
      }
    } else {
      // pintar: mira o chão à frente, prioriza área neutra/inimiga
      if (moveDir) desiredYaw = Math.atan2(moveDir[0], moveDir[2]) + Math.sin(sim.tick * 0.09 + self.id) * 0.35;
      desiredPitch = w.kind === 'charge' ? 0.18 : 0.42;
      fire = w.kind === 'charge' ? this.rng.next() < 0.6 : true;
      if (w.kind === 'contact') desiredPitch = 0.2;
      // atravessa tinta própria na forma de fluxo
      if (s.groundState === GROUND_OWN && s.ink < 60 && moveDir) {
        flow = true;
        fire = false;
      }
      if (s.ink > 85 && this.rng.next() < 0.003) input.pressedActions.push({ actionId: ++this.actionId, kind: 'secondary' });
      // na estação (portador ou quem prepara): gira pintando a área demarcada sob os pés
      if (obj && (obj.kind === 'entregar' || obj.kind === 'estacao') && Math.hypot(obj.pos[0] - s.pos[0], obj.pos[2] - s.pos[2]) < 2.2) {
        moveDir = null;
        desiredYaw = sim.tick * 0.12 + self.id;
        desiredPitch = w.kind === 'charge' ? 0.5 : 0.95;
        fire = s.ink > 2;
        flow = false;
      }
    }
    this.refillHold = Math.max(0, this.refillHold - dt);

    // especial quando cheia e há disputa por perto
    if (s.special >= RODA_DE_OLEIRO.pointsRequired && !s.specialActive && (this.mode === 'fight' || this.rng.next() < 0.01)) {
      input.pressedActions.push({ actionId: ++this.actionId, kind: 'special' });
    }

    // Estilingue: solta a carga quando cheia
    if (w.kind === 'charge' && s.charging && s.charge >= 0.85 && this.mode === 'fight') fire = false;
    if (w.kind === 'charge' && this.mode === 'paint' && s.charging && s.charge >= 0.5) fire = false;

    // mira imperfeita e suavizada (tempo de reação)
    const err = (this.diff.aimErrorDeg * Math.PI) / 180;
    const turn = 7 * dt;
    this.aimYaw = wrapAngle(this.aimYaw + clamp(wrapAngle(desiredYaw + this.rng.gauss() * err * 0.3 - this.aimYaw), -turn, turn));
    this.aimPitch = this.aimPitch + clamp(desiredPitch + this.rng.gauss() * err * 0.2 - this.aimPitch, -turn, turn);
    input.yaw = this.aimYaw;
    input.pitch = clamp(this.aimPitch, -PITCH_LIMIT, PITCH_LIMIT);

    // converte direção de movimento do mundo para eixos locais do yaw
    if (moveDir) {
      const fx = Math.sin(input.yaw),
        fz = Math.cos(input.yaw);
      const rx = Math.cos(input.yaw),
        rz = -Math.sin(input.yaw);
      input.moveY = clamp(moveDir[0] * fx + moveDir[2] * fz, -1, 1);
      input.moveX = clamp(moveDir[0] * rx + moveDir[2] * rz, -1, 1);
    }
    if (this.mode === 'fight' && this.strafe !== 0) input.moveX = clamp(input.moveX + this.strafe * 0.7, -1, 1);
    const ml = Math.hypot(input.moveX, input.moveY);
    if (ml > 1) {
      input.moveX /= ml;
      input.moveY /= ml;
    }
    if (this.wantJump && s.grounded) {
      input.pressedActions.push({ actionId: ++this.actionId, kind: 'jump' });
      this.wantJump = false;
    }
    if (fire) input.heldButtons |= Buttons.FIRE;
    if (flow && !fire) input.heldButtons |= Buttons.FLOW;
    this.holdFire = fire;
    void MORINGA;
    void FORM_FLOW;
    return input;
  }

  /** Inimigo visível mais próximo (linha de visão; imersos só muito perto). */
  private pickTarget(self: SimPlayer, sim: MatchSimulation): number | null {
    const s = self.state;
    const eye: Vec3 = [s.pos[0], s.pos[1] + 1.1, s.pos[2]];
    let best: number | null = null;
    let bd = this.diff.viewRange;
    for (const t of sim.players.values()) {
      if (t.team === self.team || !t.state.alive || t.state.spawnProtect > 0) continue;
      const d = Math.hypot(t.state.pos[0] - s.pos[0], t.state.pos[1] - s.pos[1], t.state.pos[2] - s.pos[2]);
      if (d > bd) continue;
      if (t.state.submerged && d > 3.5 && Math.hypot(t.state.vel[0], t.state.vel[2]) < 6) continue;
      const tc: Vec3 = [t.state.pos[0], t.state.pos[1] + 0.8, t.state.pos[2]];
      if (sim.physics.segmentBlocked(eye, tc, 0.1)) continue;
      bd = d;
      best = t.id;
    }
    return best;
  }

  /**
   * Objetivo do modo para este bot (mesmas regras dos humanos, sem informação privilegiada:
   * posição da cápsula, portador e estação ativa são públicos no Correio do Ara).
   */
  private objective(self: SimPlayer, sim: MatchSimulation): { kind: 'entregar' | 'capsula' | 'estacao' | 'buff'; pos: Vec3 } | null {
    const c = sim.correio;
    const s = self.state;
    if (c) {
      const station = sim.opts.map.objectives.stations[c.station];
      if (c.isCarrier(self.id)) return { kind: 'entregar', pos: station };
      if (c.state === 'disponivel' || c.state === 'caida') {
        // vai quem estiver entre os dois mais próximos da equipe (os outros seguem pintando/cobrindo)
        const mine = [...sim.players.values()].filter((p) => p.team === self.team && p.state.alive);
        mine.sort((a, b) => Math.hypot(a.state.pos[0] - c.pos[0], a.state.pos[2] - c.pos[2]) - Math.hypot(b.state.pos[0] - c.pos[0], b.state.pos[2] - c.pos[2]));
        if (mine.slice(0, 2).some((p) => p.id === self.id)) return { kind: 'capsula', pos: c.pos };
      }
      const carrier = c.carrier !== null ? sim.players.get(c.carrier) : undefined;
      // aliado carregando: prepara (pinta) a estação ativa
      if (carrier && carrier.team === self.team && self.id % 2 === 0) return { kind: 'estacao', pos: station };
    }
    const pk = sim.pickupSnapshot();
    if (pk && s.ink > 40 && self.mode.buff === null) {
      const pickups = sim.opts.map.objectives.pickups;
      for (const p of pk) {
        const at = pickups[p.i].pos;
        if (p.a === 1 && Math.hypot(at[0] - s.pos[0], at[2] - s.pos[2]) < 9) return { kind: 'buff', pos: at };
      }
    }
    return null;
  }

  private planTo(pos: Vec3) {
    if (this.lastNode < 0) return;
    const n = this.nav.nearest(pos, 3);
    if (!n) return;
    const path = n.id === this.lastNode ? [n.id] : this.nav.findPath(this.lastNode, n.id);
    if (path && path.length) {
      this.path = path;
      this.pathIdx = Math.min(1, path.length - 1);
      this.goal = n.id;
    }
  }

  /** Escolhe um destino com mais área neutra/inimiga, penalizando distância. */
  private planPaintGoal(self: SimPlayer, sim: MatchSimulation) {
    const nodes = this.nav.nodes;
    if (nodes.length === 0 || this.lastNode < 0) return;
    const s = self.state;
    let best = -1;
    let bestScore = -Infinity;
    const owner = sim.paint.owner;
    for (let k = 0; k < 16; k++) {
      const n = nodes[this.rng.int(nodes.length)];
      let score = 0;
      for (const m of this.nav.neighbors(n.pos, 2.2)) score += owner[m.cell] === self.team ? -1 : owner[m.cell] === -1 ? 1.3 : 1.6;
      const d = Math.hypot(n.pos[0] - s.pos[0], n.pos[2] - s.pos[2]);
      score -= d * 0.12;
      if (this.mode === 'refill') score = owner[n.cell] === self.team ? 10 - d : -d;
      if (score > bestScore) {
        bestScore = score;
        best = n.id;
      }
    }
    if (best < 0) return;
    const path = this.nav.findPath(this.lastNode, best);
    if (path && path.length > 1) {
      this.path = path;
      this.pathIdx = 1;
      this.goal = best;
    } else {
      this.path = [];
    }
    void this.goal;
  }
}
