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

/** Paletas de apresentação. A regra lógica continua em TeamId, nunca em RGB. */
export const PALETTES: Record<Settings['palette'], { name: string; team: [string, string] }> = {
  padrao: { name: 'Padrão (Urucum × Anil)', team: ['#ff6414', '#4a3dff'] },
  alto_contraste: { name: 'Alto contraste', team: ['#ffd500', '#6a00ff'] },
  daltonismo: { name: 'Daltonismo (laranja × azul)', team: ['#e69f00', '#0072b2'] },
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

export function teamColorHex(team: 0 | 1): string {
  return PALETTES[settingsStore.get().palette].team[team];
}
