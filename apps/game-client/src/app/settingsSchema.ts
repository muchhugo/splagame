/**
 * Esquema versionado das preferências locais. Tudo que vem do localStorage é
 * tratado como não confiável: cada campo é validado (tipo, faixa, valores
 * permitidos) e o que não passa volta ao padrão, sem derrubar o resto.
 * Sem efeitos colaterais: testável fora do navegador.
 */
import { DEFAULT_PAD_BINDS, PAD_ACTIONS, type PadAction, type PadPreset, type ResponseCurve } from '../game/input/gamepad';

export const SETTINGS_VERSION = 2;
export const SETTINGS_KEY = 'borrifo.settings.v2';
export const LEGACY_KEYS = ['borrifo.settings.v1'] as const;

export type BindableAction = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'flow' | 'secondary' | 'special' | 'map' | 'fireAlt';

export interface GamepadSettings {
  enabled: boolean;
  /** 'auto' usa a família detectada pelo nome do controle. */
  preset: PadPreset;
  sensX: number;
  sensY: number;
  invertX: boolean;
  invertY: boolean;
  deadzoneLeft: number;
  deadzoneRight: number;
  curve: ResponseCurve;
  vibration: boolean;
  vibrationIntensity: number;
  aimAssist: boolean;
  aimAssistStrength: number;
  binds: Record<PadAction, number>;
}

export interface Settings {
  version: typeof SETTINGS_VERSION;
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
  gamepad: GamepadSettings;
  /** Versão do tutorial já concluída ou pulada (0 = nunca). */
  tutorialDone: number;
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

export const DEFAULT_GAMEPAD: GamepadSettings = {
  enabled: true,
  preset: 'auto',
  sensX: 1,
  sensY: 1,
  invertX: false,
  invertY: false,
  deadzoneLeft: 0.15,
  deadzoneRight: 0.12,
  curve: 'padrao',
  vibration: true,
  vibrationIntensity: 0.7,
  aimAssist: true,
  aimAssistStrength: 0.5,
  binds: DEFAULT_PAD_BINDS,
};

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
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
  gamepad: DEFAULT_GAMEPAD,
  tutorialDone: 0,
};

// ------------------------------------------------------------ validadores
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
function oneOf<T extends string | number>(v: unknown, allowed: readonly T[], def: T): T {
  return allowed.includes(v as T) ? (v as T) : def;
}
const KEY_CODE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;

function uniqueValues(o: Record<string, string | number>): boolean {
  const v = Object.values(o);
  return new Set(v).size === v.length;
}

function sanitizeKeybinds(v: unknown): Record<BindableAction, string> {
  if (!isObj(v)) return DEFAULT_KEYBINDS;
  const out = { ...DEFAULT_KEYBINDS };
  for (const a of Object.keys(DEFAULT_KEYBINDS) as BindableAction[]) {
    const c = v[a];
    if (typeof c === 'string' && KEY_CODE.test(c) && c !== 'Escape') out[a] = c;
  }
  // duas ações na mesma tecla só aconteceriam com o armazenamento adulterado
  return uniqueValues(out) ? out : DEFAULT_KEYBINDS;
}

function sanitizePadBinds(v: unknown): Record<PadAction, number> {
  if (!isObj(v)) return DEFAULT_PAD_BINDS;
  const out = { ...DEFAULT_PAD_BINDS };
  for (const a of PAD_ACTIONS) {
    const b = v[a];
    if (typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 17) out[a] = b;
  }
  return uniqueValues(out) ? out : DEFAULT_PAD_BINDS;
}

function sanitizeGamepad(v: unknown): GamepadSettings {
  if (!isObj(v)) return DEFAULT_GAMEPAD;
  const d = DEFAULT_GAMEPAD;
  return {
    enabled: bool(v.enabled, d.enabled),
    preset: oneOf(v.preset, ['auto', 'xbox', 'playstation', 'nintendo', 'generico'] as const, d.preset),
    sensX: num(v.sensX, 0.2, 3, d.sensX),
    sensY: num(v.sensY, 0.2, 3, d.sensY),
    invertX: bool(v.invertX, d.invertX),
    invertY: bool(v.invertY, d.invertY),
    deadzoneLeft: num(v.deadzoneLeft, 0.02, 0.4, d.deadzoneLeft),
    deadzoneRight: num(v.deadzoneRight, 0.02, 0.4, d.deadzoneRight),
    curve: oneOf(v.curve, ['linear', 'padrao', 'precisa'] as const, d.curve),
    vibration: bool(v.vibration, d.vibration),
    vibrationIntensity: num(v.vibrationIntensity, 0, 1, d.vibrationIntensity),
    aimAssist: bool(v.aimAssist, d.aimAssist),
    aimAssistStrength: num(v.aimAssistStrength, 0, 1, d.aimAssistStrength),
    binds: sanitizePadBinds(v.binds),
  };
}

/** Converte qualquer valor (JSON lido do armazenamento) em preferências válidas. */
export function sanitizeSettings(raw: unknown): Settings {
  if (!isObj(raw)) return DEFAULT_SETTINGS;
  const d = DEFAULT_SETTINGS;
  return {
    version: SETTINGS_VERSION,
    sensitivity: num(raw.sensitivity, 0.2, 3, d.sensitivity),
    invertY: bool(raw.invertY, d.invertY),
    fov: num(raw.fov, 55, 95, d.fov),
    shoulder: num(raw.shoulder, -0.9, 0.9, d.shoulder),
    flowMode: oneOf(raw.flowMode, ['hold', 'toggle'] as const, d.flowMode),
    mapMode: oneOf(raw.mapMode, ['hold', 'toggle'] as const, d.mapMode),
    volumeMaster: num(raw.volumeMaster, 0, 1, d.volumeMaster),
    volumeSfx: num(raw.volumeSfx, 0, 1, d.volumeSfx),
    volumeMusic: num(raw.volumeMusic, 0, 1, d.volumeMusic),
    muted: bool(raw.muted, d.muted),
    quality: oneOf(raw.quality, ['baixa', 'media', 'alta'] as const, d.quality),
    fpsCap: oneOf(raw.fpsCap, [0, 30, 60, 120] as const, d.fpsCap),
    reduceShake: bool(raw.reduceShake, d.reduceShake),
    reduceFlashes: bool(raw.reduceFlashes, d.reduceFlashes),
    hudScale: num(raw.hudScale, 0.8, 1.4, d.hudScale),
    palette: oneOf(raw.palette, ['padrao', 'alto_contraste', 'daltonismo'] as const, d.palette),
    paintPatterns: bool(raw.paintPatterns, d.paintPatterns),
    keybinds: sanitizeKeybinds(raw.keybinds),
    gamepad: sanitizeGamepad(raw.gamepad),
    tutorialDone: num(raw.tutorialDone, 0, 1000, d.tutorialDone),
  };
}

/**
 * v1 (sem `version`, sem controle) → v2. Os campos da v1 têm o mesmo nome e
 * significado; o que é novo entra com o padrão. Versões futuras desconhecidas
 * são lidas campo a campo (o que for reconhecido é aproveitado).
 */
export function migrateSettings(raw: unknown): Settings {
  return sanitizeSettings(raw);
}

export interface SettingsStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Lê v2; se não houver, migra a v1 e grava como v2. Nunca lança. */
export function loadSettings(storage: SettingsStorage | null): Settings {
  if (!storage) return DEFAULT_SETTINGS;
  try {
    const cur = storage.getItem(SETTINGS_KEY);
    if (cur) return sanitizeSettings(JSON.parse(cur));
    for (const k of LEGACY_KEYS) {
      const old = storage.getItem(k);
      if (!old) continue;
      const migrated = migrateSettings(JSON.parse(old));
      storage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
      storage.removeItem(k);
      return migrated;
    }
  } catch {
    /* JSON inválido ou armazenamento bloqueado: padrão */
  }
  return DEFAULT_SETTINGS;
}

/** Troca a ação de botão/tecla; se o destino já era de outra ação, as duas trocam (sem conflito). */
export function rebind<A extends string, V>(binds: Record<A, V>, action: A, value: V): Record<A, V> {
  const out = { ...binds };
  const other = (Object.keys(out) as A[]).find((a) => a !== action && out[a] === value);
  if (other !== undefined) out[other] = binds[action];
  out[action] = value;
  return out;
}
