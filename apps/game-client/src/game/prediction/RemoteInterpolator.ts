import type { RemotePlayerTuple } from '@borrifo/game-contracts';

export interface RemoteSample {
  tick: number;
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  form: number;
  flags: number;
  hp: number;
  charge: number;
  vel: [number, number];
}

/**
 * Interpolação de jogadores remotos com pequeno buffer (render atrasado em
 * `delayTicks`). Sem extrapolação ilimitada: segura a última amostra.
 */
export class RemoteInterpolator {
  private buf = new Map<number, RemoteSample[]>();
  private tickOffset: number | null = null;
  delayTicks = 3;

  push(serverTick: number, receivedAt: number, tuples: RemotePlayerTuple[]) {
    const est = serverTick - (receivedAt / 1000) * 30;
    // maior estimativa = menor atraso observado; deriva lenta para acompanhar o relógio
    if (this.tickOffset === null || est > this.tickOffset) this.tickOffset = est;
    else this.tickOffset = this.tickOffset * 0.995 + est * 0.005;
    for (const t of tuples) {
      const s: RemoteSample = {
        tick: serverTick,
        pos: [t[1] / 100, t[2] / 100, t[3] / 100],
        yaw: t[4] / 1000,
        pitch: t[5] / 1000,
        form: t[6],
        flags: t[7],
        hp: t[8],
        charge: t[9] / 100,
        vel: [t[10] / 100, t[11] / 100],
      };
      let arr = this.buf.get(t[0]);
      if (!arr) this.buf.set(t[0], (arr = []));
      arr.push(s);
      if (arr.length > 20) arr.shift();
    }
  }

  renderTick(now: number): number {
    if (this.tickOffset === null) return 0;
    return (now / 1000) * 30 + this.tickOffset - this.delayTicks;
  }

  sample(playerId: number, tick: number): RemoteSample | null {
    const arr = this.buf.get(playerId);
    if (!arr || arr.length === 0) return null;
    if (tick <= arr[0].tick) return arr[0];
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (a.tick <= tick) {
        const b = arr[i + 1];
        if (!b) return a;
        // teleporte (reaparecimento/deslocamento): não interpola
        const jump = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]) > 4;
        const t = jump ? 1 : (tick - a.tick) / Math.max(1, b.tick - a.tick);
        return {
          ...b,
          pos: [a.pos[0] + (b.pos[0] - a.pos[0]) * t, a.pos[1] + (b.pos[1] - a.pos[1]) * t, a.pos[2] + (b.pos[2] - a.pos[2]) * t],
          yaw: lerpAngle(a.yaw, b.yaw, t),
          pitch: a.pitch + (b.pitch - a.pitch) * t,
          charge: a.charge + (b.charge - a.charge) * t,
          flags: t < 0.5 ? a.flags : b.flags,
          form: t < 0.5 ? a.form : b.form,
        };
      }
    }
    return arr[0];
  }

  latest(playerId: number): RemoteSample | null {
    const arr = this.buf.get(playerId);
    return arr && arr.length ? arr[arr.length - 1] : null;
  }

  ids(): number[] {
    return [...this.buf.keys()];
  }

  clear() {
    this.buf.clear();
    this.tickOffset = null;
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
