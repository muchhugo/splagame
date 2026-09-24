import { useEffect, useRef, useState } from 'react';
import { TEAMS } from '@borrifo/game-contracts';
import { PIAO_GUIA } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { settingsStore, PALETTES } from '../app/settings';
import { hudStore } from '../game/hud';
import { getController } from './App';

const PX = 7; // pixels por metro

/**
 * Mapa tático: território conhecido (a própria réplica de tinta, por nível) e
 * aliados. Adversários NUNCA são desenhados. Clique num aliado para Pião-Guia.
 */
export function TacticalMap() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const palette = useStore(settingsStore, (s) => s.palette);
  const myTeam = useStore(hudStore, (s) => s.myTeam);
  const alive = useStore(hudStore, (s) => s.alive);
  const [allies, setAllies] = useState<Array<{ playerId: number; name: string; x: number; y: number; alive: boolean; isMe: boolean }>>([]);
  const c = getController();
  const rt = c?.runtime;
  const bounds = rt?.map.bounds;
  const W = bounds ? (bounds.max[2] - bounds.min[2]) * PX : 300;
  const H = bounds ? (bounds.max[0] - bounds.min[0]) * PX : 300;

  useEffect(() => {
    if (!rt || !bounds) return;
    // orientação: a base da própria turma fica embaixo
    const toScreen = (x: number, z: number): [number, number] => {
      if (myTeam === 0) return [(bounds.max[2] - z) * PX, (bounds.max[0] - x) * PX];
      return [(z - bounds.min[2]) * PX, (x - bounds.min[0]) * PX];
    };
    const draw = () => {
      const cv = canvas.current;
      if (!cv) return;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#1d1411';
      g.fillRect(0, 0, cv.width, cv.height);
      const layout = rt.layout;
      const owner = rt.replica.state.owner;
      const [c0, c1] = PALETTES[palette].team;
      const floors = layout.surfaces.filter((s) => s.traversal === 'floor').sort((a, b) => a.aabbMin[1] - b.aabbMin[1]);
      for (const s of floors) {
        const hgt = s.aabbMax[1];
        const shade = Math.round(70 + Math.min(1, hgt / 3.5) * 70);
        for (let j = 0; j < s.rows; j++)
          for (let i = 0; i < s.cols; i++) {
            const cell = s.cellOffset + j * s.cols + i;
            if (layout.weight[cell] === 0) continue;
            const o = owner[cell];
            const u = (i + 0.5) * s.cellSize,
              v = (j + 0.5) * s.cellSize;
            const x = s.origin[0] + s.axisU[0] * u + s.axisV[0] * v;
            const z = s.origin[2] + s.axisU[2] * u + s.axisV[2] * v;
            const [sx, sy] = toScreen(x, z);
            g.fillStyle = o === 0 ? c0 : o === 1 ? c1 : `rgb(${shade},${shade - 8},${shade - 14})`;
            g.fillRect(sx - PX * 0.14, sy - PX * 0.14, PX * 0.28, PX * 0.28);
          }
        // contorno do nível elevado para leitura de altura
        if (hgt > 0.5 && s.scoring) {
          const a = toScreen(s.aabbMin[0], s.aabbMin[2]);
          const b = toScreen(s.aabbMax[0], s.aabbMax[2]);
          g.strokeStyle = 'rgba(255,244,230,.35)';
          g.lineWidth = 1;
          g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        }
      }
      setAllies(rt.tacticalAllies().map((a) => ({ playerId: a.playerId, name: a.name, alive: a.alive, isMe: a.isMe, x: toScreen(a.pos[0], a.pos[2])[0], y: toScreen(a.pos[0], a.pos[2])[1] })));
    };
    draw();
    const t = setInterval(draw, 250);
    return () => clearInterval(t);
  }, [rt, bounds, palette, myTeam]);

  if (!rt) return null;
  return (
    <div className="tacmap" role="dialog" aria-label="Mapa tático">
      <div className="frame panel">
        <strong>Mapa tático · Turma {TEAMS[myTeam].name}</strong>
        <div className="mapwrap" style={{ width: W, height: H }}>
          <canvas ref={canvas} width={W} height={H} style={{ width: W, height: H }} />
          {allies.map((a) => (
            <button
              key={a.playerId}
              className={`ally-pin ${a.isMe ? 'me' : ''}`}
              style={{ left: a.x, top: a.y, background: `var(--team${myTeam})` }}
              disabled={!a.alive || a.isMe || !alive}
              onClick={() => c?.travelTo(a.playerId)}
              title={a.isMe ? 'Você' : `${PIAO_GUIA.name} até ${a.name}`}
            >
              {a.isMe ? 'você' : a.name}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          Clique num companheiro vivo para usar o {PIAO_GUIA.name}: preparação de {PIAO_GUIA.prepTime}s (vulnerável) e chegada anunciada a todos.
        </span>
      </div>
    </div>
  );
}
