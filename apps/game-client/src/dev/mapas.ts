/**
 * Vitrine de mapas, SÓ DE DESENVOLVIMENTO (`mapas.html` fica fora do build): monta o
 * runtime real de um mapa sem servidor, para capturas de revisão.
 *   ?mapa=toca-do-ara.padrao
 * window.__mapas.view(pos, yaw, pitch) posiciona a câmera de inspeção.
 */
import { MAPS, DEFAULT_MAP_ID } from '@borrifo/game-content';
import type { Vec3 } from '@borrifo/game-contracts';
import { GameRuntime } from '../game/GameRuntime';

const id = new URLSearchParams(location.search).get('mapa') ?? DEFAULT_MAP_ID;
const map = MAPS[id] ?? MAPS[DEFAULT_MAP_ID];
const canvas = document.getElementById('c') as HTMLCanvasElement;
const noop = () => {};
const rt = await GameRuntime.create(
  canvas,
  map,
  {
    sendInput: noop,
    onMapToggle: noop,
    onMenuRequested: noop,
    onPointerLock: noop,
    onUserGesture: noop,
    playerName: (n) => `#${n}`,
    voiceOf: () => undefined,
    requestPaintResync: noop,
  },
  noop,
);
rt.setMode('correio');
rt.setPhase('running', 60000);
// objetivo de exemplo (sem servidor): cápsula no centro, estação 0 ativa, pickups disponíveis
rt.modeView.setSnapshot(
  { st: 'disponivel', p: map.objectives.capsule, c: null, s: 0, sp: [0.35, 0.1], pr: 0, d: [0, 0], t: 0 },
  map.objectives.pickups.map((p, i) => ({ i, k: p.kind, a: 1, t: 0 })),
);
(window as unknown as { __mapas: unknown }).__mapas = {
  ready: true,
  map: { id: map.id, name: map.name, variant: map.variant, bounds: map.bounds, spawns: map.spawns, objectives: map.objectives },
  view: (pos: Vec3, yaw: number, pitch: number) => {
    rt.debugView = { pos, yaw, pitch };
  },
};
