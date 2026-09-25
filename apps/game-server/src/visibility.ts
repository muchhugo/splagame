import { PFLAG_ALIVE, PFLAG_CLIMBING, PFLAG_EMBALO, PFLAG_FOLEGO, PFLAG_GROUNDED, PFLAG_HIDDEN, PFLAG_MUTIRAO, PFLAG_PROTECTED, PFLAG_SPECIAL_READY, PFLAG_SUBMERGED, type GameEvent, type RemotePlayerTuple, type TeamId } from '@borrifo/game-contracts';
import { STEALTH } from '@borrifo/game-content';

/** O que a filtragem precisa saber de cada participante (sem acoplar à simulação). */
export interface StealthSubject {
  id: number;
  team: TeamId;
  alive: boolean;
  submerged: boolean;
  pos: readonly [number, number, number];
  /** Velocidade 3D (m/s): nas paredes, subir também ondula. */
  speed: number;
  carrier: boolean;
  /** Em deslocamento tático ou com proteção de reaparecimento: sempre visível. */
  exposedByState: boolean;
}

interface Entry {
  /** Segundos que ainda faltam para esconder (reinicia a cada exposição). */
  conceal: number;
  /** Exposição forçada por evento (dano, buff, Mutirão). */
  reveal: number;
  hidden: boolean;
  /** Última tupla enviada a adversários enquanto visível: é o que eles continuam vendo. */
  ghost: RemotePlayerTuple | null;
}

/** Bits que não dizem onde a pessoa está: seguem valendo na tupla oculta. */
const PUBLIC_BITS = PFLAG_ALIVE | PFLAG_SPECIAL_READY | PFLAG_PROTECTED | PFLAG_EMBALO | PFLAG_FOLEGO | PFLAG_MUTIRAO;
/** Bits da pose congelada (para o boneco não "trocar de pose" enquanto oculto). */
const POSE_BITS = PFLAG_GROUNDED | PFLAG_CLIMBING;

/**
 * Filtragem por interesse de quem está imerso. Com duas turmas, "oculto" é uma propriedade
 * de cada participante em relação à turma adversária: aliados sempre recebem a tupla
 * real; adversários e o banco recebem, enquanto oculto, a última tupla vista congelada
 * (sem velocidade, mira nem ação) com `PFLAG_HIDDEN`. Nada da posição atual sai do
 * servidor para quem não deve ver; a interface do cliente é só apresentação.
 */
export class StealthFilter {
  private entries = new Map<number, Entry>();

  private entry(id: number): Entry {
    let e = this.entries.get(id);
    if (!e) this.entries.set(id, (e = { conceal: STEALTH.concealDelay, reveal: 0, hidden: false, ghost: null }));
    return e;
  }

  /** Eventos públicos que denunciam quem estava imerso. */
  observe(ev: GameEvent) {
    if (ev.k === 'hit') this.reveal(ev.dst);
    else if (ev.k === 'buff') this.reveal(ev.pid);
    else if (ev.k === 'mutirao') {
      this.reveal(ev.a);
      this.reveal(ev.b);
    } else if (ev.k === 'throw' || ev.k === 'special' || ev.k === 'travel') this.reveal(ev.pid);
  }

  reveal(id: number, seconds = STEALTH.eventReveal) {
    const e = this.entry(id);
    e.reveal = Math.max(e.reveal, seconds);
  }

  /**
   * Atualiza quem está oculto (chamar antes de montar os snapshots) e devolve a tupla
   * que adversários e banco recebem para cada participante, na mesma ordem de `real`.
   */
  update(subjects: readonly StealthSubject[], real: readonly RemotePlayerTuple[], dt: number): RemotePlayerTuple[] {
    const out: RemotePlayerTuple[] = [];
    const r2 = STEALTH.revealRadius * STEALTH.revealRadius;
    for (let i = 0; i < subjects.length; i++) {
      const s = subjects[i];
      const e = this.entry(s.id);
      e.reveal = Math.max(0, e.reveal - dt);
      let exposed = !s.alive || !s.submerged || s.carrier || s.exposedByState || e.reveal > 0 || s.speed > STEALTH.revealSpeed;
      if (!exposed)
        for (const o of subjects) {
          if (o.team === s.team || !o.alive) continue;
          const dx = o.pos[0] - s.pos[0], dy = o.pos[1] - s.pos[1], dz = o.pos[2] - s.pos[2];
          if (dx * dx + dy * dy + dz * dz <= r2) {
            exposed = true;
            break;
          }
        }
      if (exposed) {
        e.conceal = STEALTH.concealDelay;
        e.hidden = false;
      } else {
        e.conceal -= dt;
        // nunca escondido sem ter sido visto antes: a posição congelada precisa existir
        if (e.conceal <= 0 && e.ghost) e.hidden = true;
      }
      if (e.hidden && e.ghost) out.push(hiddenTuple(e.ghost, real[i]));
      else {
        e.ghost = real[i];
        out.push(real[i]);
      }
    }
    return out;
  }

  isHidden(id: number): boolean {
    return this.entries.get(id)?.hidden ?? false;
  }

  /** Nova rodada, ou alguém saiu: começa visível (todos nascem à vista na base). */
  reset() {
    this.entries.clear();
  }

  remove(id: number) {
    this.entries.delete(id);
  }
}

/** Posição e pose congeladas do último momento visto; vida e bits públicos atuais. */
function hiddenTuple(ghost: RemotePlayerTuple, now: RemotePlayerTuple): RemotePlayerTuple {
  const flags = (now[7] & PUBLIC_BITS) | (ghost[7] & POSE_BITS) | PFLAG_SUBMERGED | PFLAG_HIDDEN;
  return [ghost[0], ghost[1], ghost[2], ghost[3], ghost[4], 0, ghost[6], flags, now[8], 0, 0, 0];
}
