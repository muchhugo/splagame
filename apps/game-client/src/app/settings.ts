import { createStore } from './store';

export type BindableAction = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'flow' | 'secondary' | 'special' | 'map' | 'fireAlt';

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  shoulder: number;
  flowMode: 'hold' | 'toggle';
  mapMode: 'hold' | 'toggle';
  volumeMaster: number;
  volumeSfx: number;
  volumeMusic: number;
  muted: boolean;
  quality: 'baixa' | 'media' | 'alta';
  fpsCap: 0 | 30 | 60 | 120;
  reduceShake: boolean;
  reduceFlashes: boolean;
  hudScale: number;
  palette: 'padrao' | 'alto_contraste' | 'daltonismo';
  paintPatterns: boolean;
  keybinds: Record<BindableAction, string>;
}

export const DEFAULT_KEYBINDS: Record<BindableAction, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  flow: 'ShiftLeft',
  secondary: 'KeyQ',
  special: 'KeyE',
  map: 'Tab',
  fireAlt: 'KeyF',
};

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

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  fov: 72,
  shoulder: 0.55,
  flowMode: 'hold',
  mapMode: 'hold',
  volumeMaster: 0.8,
  volumeSfx: 0.9,
  volumeMusic: 0.45,
  muted: false,
  quality: 'media',
  fpsCap: 0,
  reduceShake: false,
  reduceFlashes: false,
  hudScale: 1,
  palette: 'padrao',
  paintPatterns: false,
  keybinds: DEFAULT_KEYBINDS,
};

/** Paletas de apresentação. A regra lógica continua em TeamId, nunca em RGB. */
export const PALETTES: Record<Settings['palette'], { name: string; team: [string, string] }> = {
  padrao: { name: 'Padrão (Urucum × Anil)', team: ['#ff6414', '#4a3dff'] },
  alto_contraste: { name: 'Alto contraste', team: ['#ffd500', '#6a00ff'] },
  daltonismo: { name: 'Daltonismo (laranja × azul)', team: ['#e69f00', '#0072b2'] },
};

const KEY = 'borrifo.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, keybinds: { ...DEFAULT_KEYBINDS, ...(parsed.keybinds ?? {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsStore = createStore<Settings>(load());
settingsStore.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsStore.get()));
  } catch {
    /* armazenamento indisponível: preferências valem só nesta sessão */
  }
});

export function teamColorHex(team: 0 | 1): string {
  return PALETTES[settingsStore.get().palette].team[team];
}
