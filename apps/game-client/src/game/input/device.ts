/**
 * Último dispositivo de entrada usado (teclado/mouse, controle ou toque). Muda
 * sozinho, sem pausar nada, a cada interação: as dicas na tela acompanham.
 */
import { createStore } from '../../app/store';
import { gamepadHub, type PadFamily, type PadInfo, type PadPreset } from './gamepad';

export type InputDevice = 'teclado' | 'controle' | 'toque';

export interface DeviceState {
  device: InputDevice;
  /** Controle ativo (o último mexido), se houver. */
  pad: PadInfo | null;
  padCount: number;
}

const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const deviceStore = createStore<DeviceState>({ device: coarse() ? 'toque' : 'teclado', pad: null, padCount: 0 });

export function setDevice(device: InputDevice) {
  if (deviceStore.get().device !== device) deviceStore.set({ device });
}

/** Família efetiva dos glifos: a escolhida nas configurações ou a detectada. */
export function effectiveFamily(preset: PadPreset, pad: PadInfo | null): PadFamily {
  if (preset !== 'auto') return preset;
  return pad?.family ?? 'generico';
}

let installed = false;

/**
 * Liga a detecção (uma vez por página). `notify` mostra os avisos de
 * conexão; fica fora daqui para este módulo não depender da interface.
 */
export function installDeviceTracking(notify: (text: string, kind: 'info' | 'warn' | 'good', ttlMs?: number) => void, familyLabel: (f: PadFamily) => string) {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  let mouseTravel = 0;
  // eventos sintéticos (ex.: Esc que a navegação do controle dispara) não contam
  window.addEventListener('keydown', (e) => e.isTrusted && setDevice('teclado'), true);
  window.addEventListener(
    'pointerdown',
    (e) => e.isTrusted && setDevice(e.pointerType === 'touch' || e.pointerType === 'pen' ? 'toque' : 'teclado'),
    true,
  );
  window.addEventListener(
    'mousemove',
    (e) => {
      if (!e.isTrusted) return;
      // tremida de mouse na mesa não tira o jogador do modo controle
      mouseTravel += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (mouseTravel > 24) {
        mouseTravel = 0;
        setDevice('teclado');
      }
    },
    true,
  );
  gamepadHub.subscribe((e) => {
    if (e.type === 'activity' || e.type === 'press') {
      mouseTravel = 0;
      const pad = gamepadHub.active;
      if (deviceStore.get().device !== 'controle' || deviceStore.get().pad?.index !== pad?.index) deviceStore.set({ device: 'controle', pad });
    } else if (e.type === 'connected') {
      deviceStore.set({ pad: gamepadHub.active, padCount: gamepadHub.connected.length });
      notify(`Controle conectado (${familyLabel(e.info.family)})`, 'good');
      if (!e.info.standard) notify('Este controle não usa o mapeamento padrão: confira os botões em Configurações › Controle.', 'warn', 7000);
    } else if (e.type === 'disconnected') {
      const pad = gamepadHub.active;
      const wasActive = deviceStore.get().device === 'controle' && !pad;
      deviceStore.set({ pad, padCount: gamepadHub.connected.length, ...(wasActive ? { device: coarse() ? 'toque' : 'teclado' } : {}) });
      notify('Controle desconectado', 'warn');
    }
  });
  gamepadHub.start();
}
