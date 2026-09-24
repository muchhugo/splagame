import { useEffect, useRef, useState } from 'react';
import { PIAO_GUIA } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { settingsStore, teamColorsFor } from '../app/settings';
import { useTeams } from '../app/teams';
import { uiStore } from '../app/uiStore';
import { hudStore } from '../game/hud';
import { PAD, gamepadHub } from '../game/input/gamepad';
import { useHints } from '../app/hints';
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
  const [padSel, setPadSel] = useState<number | null>(null);
  const hints = useHints();
  const teams = useTeams();
  const c = getController();
  const selectable = allies.filter((a) => a.alive && !a.isMe && alive);
  const selRef = useRef({ selectable, padSel });
  selRef.current = { selectable, padSel };

  // controle: direcional escolhe o companheiro, A (ou a ação contextual) confirma, B fecha
  useEffect(() => {
    return gamepadHub.subscribe((e) => {
      if (e.type !== 'press') return;
      const { selectable: list, padSel: sel } = selRef.current;
      const binds = settingsStore.get().gamepad.binds;
      const nintendo = hints.family === 'nintendo';
      const confirm = nintendo ? PAD.LESTE : PAD.SUL;
      const back = nintendo ? PAD.SUL : PAD.LESTE;
      const idx = list.findIndex((a) => a.playerId === sel);
      if (e.button === PAD.DIR || e.button === PAD.BAIXO || e.button === PAD.ESQ || e.button === PAD.CIMA) {
        if (!list.length) return;
        const step = e.button === PAD.DIR || e.button === PAD.BAIXO ? 1 : -1;
        const next = idx < 0 ? (step > 0 ? 0 : list.length - 1) : (idx + step + list.length) % list.length;
        setPadSel(list[next].playerId);
      } else if ((e.button === confirm || e.button === binds.contextual || e.button === binds.jump) && idx >= 0) {
        getController()?.travelTo(list[idx].playerId);
      } else if (e.button === back) close();
    });
  }, [hints.family]);
  const rt = c?.runtime;
  const bounds = rt?.map.bounds;
  const W = bounds ? (bounds.max[2] - bounds.min[2]) * PX : 300;
  const H = bounds ? (bounds.max[0] - bounds.min[0]) * PX : 300;
  // cabe na tela (celular deitado tem ~390 px de altura): escala o mapa inteiro, pinos incluídos
  const [vp, setVp] = useState(() => ({ w: innerWidth, h: innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: innerWidth, h: innerHeight });
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  const k = Math.min(1, (vp.w - 64) / W, (vp.h - 130) / H);
  const close = () => {
    getController()?.runtime?.input.closeMap();
    uiStore.set({ mapOpen: false });
  };

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
      const [c0, c1] = teamColorsFor(palette, uiStore.get().lobby?.teamPairId);
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
  }, [rt, bounds, palette, myTeam, teams[0].color, teams[1].color]);

  if (!rt) return null;
  return (
    <div className="tacmap" role="dialog" aria-label="Mapa tático">
      <div className="frame panel">
        <div className="row" style={{ justifyContent: 'space-between', alignSelf: 'stretch' }}>
          <strong>Mapa tático · Turma {teams[myTeam].name}</strong>
          <button className="btn small ghost" data-sfx="back" onClick={close}>
            Fechar
          </button>
        </div>
        <div style={{ width: W * k, height: H * k }}>
          <div className="mapwrap" style={{ width: W, height: H, transform: k < 1 ? `scale(${k})` : undefined, transformOrigin: 'top left' }}>
            <canvas ref={canvas} width={W} height={H} style={{ width: W, height: H }} />
            {allies.map((a) => (
              <button
                data-sfx="none"
                key={a.playerId}
                className={`ally-pin ${a.isMe ? 'me' : ''} ${padSel === a.playerId ? 'pad-selected' : ''}`}
                style={{ left: a.x, top: a.y, background: `var(--team${myTeam})` }}
                disabled={!a.alive || a.isMe || !alive}
                onClick={() => c?.travelTo(a.playerId)}
                title={a.isMe ? 'Você' : `${PIAO_GUIA.name} até ${a.name}`}
              >
                {a.isMe ? 'você' : a.name}
              </button>
            ))}
          </div>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {hints.device === 'controle'
            ? `${hints.label('travel')} leva até um companheiro vivo pelo ${PIAO_GUIA.name}`
            : hints.device === 'toque'
              ? `Toque num companheiro vivo para usar o ${PIAO_GUIA.name}`
              : `Clique num companheiro vivo para usar o ${PIAO_GUIA.name}`}
          : preparação de {PIAO_GUIA.prepTime}s (vulnerável) e chegada anunciada a todos.
        </span>
      </div>
    </div>
  );
}
