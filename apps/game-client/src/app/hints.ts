/**
 * Dicas de controle num só lugar: a mesma ação vira tecla ("E"), botão do
 * controle ("Y", "△", "X" no Nintendo) ou gesto ("toque em Roda"), conforme o
 * último dispositivo usado e as teclas/botões configurados.
 */
import { useStore } from './store';
import { settingsStore, type Settings } from './settings';
import { buttonGlyph, type PadFamily } from '../game/input/gamepad';
import { deviceStore, effectiveFamily, type InputDevice } from '../game/input/device';

export type HintAction = 'move' | 'look' | 'fire' | 'flow' | 'jump' | 'secondary' | 'special' | 'map' | 'menu' | 'travel';

export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { Space: 'Espaço', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', Tab: 'Tab', AltLeft: 'Alt', CapsLock: 'Caps', Escape: 'Esc' };
  return map[code] ?? code;
}

const STICKS: Record<PadFamily, { left: string; right: string; dpad: string }> = {
  xbox: { left: 'LS', right: 'RS', dpad: 'D-pad' },
  playstation: { left: 'L', right: 'R', dpad: 'Direcional' },
  nintendo: { left: 'LS', right: 'RS', dpad: 'Direcional' },
  generico: { left: 'Analógico E', right: 'Analógico D', dpad: 'Direcional' },
};

const TOUCH: Record<HintAction, string> = {
  move: 'Analógico',
  look: 'Arraste à direita',
  fire: 'Usar',
  flow: 'Pião',
  jump: 'Pular',
  secondary: 'Moringa',
  special: 'Roda',
  map: 'Mapa',
  menu: '☰',
  travel: 'Toque no companheiro',
};

/** Rótulo curto da entrada que dispara `action` (para <kbd>). */
export function hintLabel(action: HintAction, device: InputDevice, s: Settings, family: PadFamily): string {
  if (device === 'toque') return TOUCH[action];
  if (device === 'controle') {
    const b = s.gamepad.binds;
    const g = (i: number) => buttonGlyph(family, i);
    switch (action) {
      case 'move':
        return STICKS[family].left;
      case 'look':
        return STICKS[family].right;
      case 'travel':
        return `${STICKS[family].dpad} + ${g(family === 'nintendo' ? 1 : 0)}`;
      default:
        return g(b[action]);
    }
  }
  const k = s.keybinds;
  switch (action) {
    case 'move':
      return `${keyName(k.forward)} ${keyName(k.left)} ${keyName(k.back)} ${keyName(k.right)}`;
    case 'look':
      return 'Mouse';
    case 'fire':
      return 'Clique';
    case 'menu':
      return 'Esc';
    case 'travel':
      return 'Clique no companheiro';
    default:
      return keyName(k[action]);
  }
}

/** Hook: dispositivo atual, família de glifos e função de rótulo. */
export function useHints() {
  const device = useStore(deviceStore, (d) => d.device);
  const pad = useStore(deviceStore, (d) => d.pad);
  const s = useStore(settingsStore, (x) => x);
  const family = effectiveFamily(s.gamepad.preset, pad);
  return { device, family, pad, label: (a: HintAction) => hintLabel(a, device, s, family) };
}

/** "Pressione Y" / "Pressione E" / "Toque em Roda". */
export function pressText(label: string, device: InputDevice): string {
  return device === 'toque' ? `Toque em ${label}` : `Pressione ${label}`;
}
