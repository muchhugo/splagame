import { teamPair } from '@borrifo/game-content';
import { createStore } from './store';
import { loadSettings, SETTINGS_KEY, type BindableAction, type Settings } from './settingsSchema';

export type { BindableAction, GamepadSettings, Settings } from './settingsSchema';
export { DEFAULT_GAMEPAD, DEFAULT_KEYBINDS, DEFAULT_SETTINGS, rebind } from './settingsSchema';

export const ACTION_LABELS: Record<BindableAction, string> = {
  forward: 'Frente',
  back: 'Trás',
  left: 'Esquerda',
  right: 'Direita',
  jump: 'Pular',
  flow: 'Forma Pião (fluxo)',
  secondary: 'Moringa',
  special: 'Roda de Oleiro',
  map: 'Mapa tático',
  fireAlt: 'Disparo (tecla alternativa)',
};

/**
 * Paletas de ACESSIBILIDADE: remapeiam localmente o par que o servidor escolheu
 * para a rodada (não mudam o dono lógico da tinta, que é o TeamId). "padrao"
 * usa o par da rodada (ver packages/game-content/src/palette.ts).
 */
export const PALETTES: Record<Settings['palette'], { name: string; team: [string, string] | null; names: [string, string] | null }> = {
  padrao: { name: 'Cores da rodada (escolhidas pela partida)', team: null, names: null },
  alto_contraste: { name: 'Alto contraste (amarelo × violeta)', team: ['#ffd500', '#6a00ff'], names: ['Amarela', 'Violeta'] },
  daltonismo: { name: 'Daltonismo (laranja × azul, Okabe–Ito)', team: ['#e69f00', '#0072b2'], names: ['Laranja', 'Azul'] },
};

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage bloqueado (iframe com cookies de terceiros desligados)
  }
}

export const settingsStore = createStore<Settings>(loadSettings(storage()));
settingsStore.subscribe(() => {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(settingsStore.get()));
  } catch {
    /* armazenamento indisponível: preferências valem só nesta sessão */
  }
});

/** Cores efetivas das equipes: a paleta de acessibilidade, se escolhida; senão o par da rodada. */
export function teamColorsFor(palette: Settings['palette'], pairId: string | null | undefined): [string, string] {
  const acc = PALETTES[palette].team;
  if (acc) return acc;
  const p = teamPair(pairId);
  return [p.teams[0].color, p.teams[1].color];
}

/** Nomes de apresentação que combinam com as cores efetivas. */
export function teamNamesFor(palette: Settings['palette'], pairId: string | null | undefined): [string, string] {
  const acc = PALETTES[palette].names;
  if (acc) return acc;
  const p = teamPair(pairId);
  return [p.teams[0].name, p.teams[1].name];
}
