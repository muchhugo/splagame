import type { ActionKind } from '@borrifo/game-contracts';
import { Buttons, PITCH_LIMIT, clamp } from '@borrifo/game-contracts';
import { settingsStore, type BindableAction } from '../../app/settings';

/**
 * Entrada de mouse/teclado. Só captura quando o canvas tem foco ou o ponteiro
 * está travado — nunca intercepta atalhos com o usuário digitando fora do jogo.
 * Converte "alternar" em bit contínuo (FLOW) antes de chegar à simulação.
 */
export class InputManager {
  yaw = 0;
  pitch = 0.1;
  private keys = new Set<string>();
  private mouseFire = false;
  private flowToggled = false;
  private mapToggled = false;
  private pendingActions: ActionKind[] = [];
  private listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions | undefined]> = [];
  enabled = true;
  locked = false;
  onMenuRequested: (() => void) | null = null;
  onMapChanged: ((open: boolean) => void) | null = null;
  onPointerLockChange: ((locked: boolean) => void) | null = null;
  onUserGesture: (() => void) | null = null;
  private lookDX = 0;
  private lookDY = 0;
  private touch = { mx: 0, my: 0, fire: false, flow: false };

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.tabIndex = 0;
    this.on(canvas, 'mousedown', (e) => this.onMouseDown(e as MouseEvent));
    this.on(window, 'mouseup', (e) => {
      if ((e as MouseEvent).button === 0) this.mouseFire = false;
    });
    this.on(document, 'mousemove', (e) => this.onMouseMove(e as MouseEvent));
    this.on(canvas, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.on(document, 'keydown', (e) => {
      // com o ponteiro travado, o foco pode não estar no canvas
      if (this.locked && document.activeElement !== canvas) this.onKey(e as KeyboardEvent, true);
    });
    this.on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.releaseAll();
      this.onPointerLockChange?.(this.locked);
    });
    this.on(window, 'blur', () => this.releaseAll());
    this.on(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
  }

  private on(t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    t.addEventListener(type, fn, opts);
    this.listeners.push([t, type, fn, opts]);
  }

  /** Pede pointer lock (precisa de gesto explícito do usuário). */
  requestLock() {
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* navegador recusou */
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private onMouseDown(e: MouseEvent) {
    this.canvas.focus();
    this.onUserGesture?.();
    if (!this.locked) {
      this.requestLock();
      return;
    }
    if (e.button === 0) this.mouseFire = true;
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.locked || !this.enabled) return;
    this.lookDX += e.movementX;
    this.lookDY += e.movementY;
  }

  /** Aplica o movimento do mouse acumulado (chamado a cada frame). */
  consumeLook() {
    const s = settingsStore.get();
    const k = 0.0022 * s.sensitivity;
    this.yaw += this.lookDX * k;
    this.pitch += this.lookDY * k * (s.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -PITCH_LIMIT + 0.05, PITCH_LIMIT - 0.05);
    this.lookDX = 0;
    this.lookDY = 0;
  }

  /** Entrada de toque (analógico virtual e área de câmera). */
  setTouch(mx: number, my: number, fire: boolean, flow: boolean) {
    this.touch = { mx, my, fire, flow };
  }
  touchLook(dx: number, dy: number) {
    this.lookDX += dx * 1.6;
    this.lookDY += dy * 1.6;
  }
  touchAction(a: ActionKind) {
    this.pendingActions.push(a);
  }

  private bindOf(code: string): BindableAction | null {
    const kb = settingsStore.get().keybinds;
    for (const [a, c] of Object.entries(kb)) if (c === code) return a as BindableAction;
    if (code === 'ShiftRight' && kb.flow === 'ShiftLeft') return 'flow';
    return null;
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.code === 'Escape') return; // Esc: o navegador libera o ponteiro; o menu abre pelo evento de lock
    const action = this.bindOf(e.code);
    if (!action) return;
    if (down && !this.locked && document.activeElement !== this.canvas) return;
    e.preventDefault();
    if (down) {
      if (this.keys.has(e.code)) return; // auto-repetição
      this.keys.add(e.code);
      const s = settingsStore.get();
      if (action === 'jump') this.pendingActions.push('jump');
      if (action === 'secondary') this.pendingActions.push('secondary');
      if (action === 'special') this.pendingActions.push('special');
      if (action === 'flow' && s.flowMode === 'toggle') this.flowToggled = !this.flowToggled;
      if (action === 'map') {
        if (s.mapMode === 'toggle') this.mapToggled = !this.mapToggled;
        this.onMapChanged?.(this.mapOpen);
      }
    } else {
      this.keys.delete(e.code);
      if (action === 'map') this.onMapChanged?.(this.mapOpen);
    }
  }

  private held(action: BindableAction): boolean {
    const code = settingsStore.get().keybinds[action];
    return this.keys.has(code) || (action === 'flow' && this.keys.has('ShiftRight'));
  }

  get mapOpen(): boolean {
    return settingsStore.get().mapMode === 'toggle' ? this.mapToggled : this.held('map');
  }

  closeMap() {
    this.mapToggled = false;
    this.onMapChanged?.(false);
  }

  moveAxes(): [number, number] {
    if (!this.enabled) return [0, 0];
    let x = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0) + this.touch.mx;
    let y = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0) + this.touch.my;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return [x, y];
  }

  buttons(): number {
    if (!this.enabled) return 0;
    let b = 0;
    if (this.mouseFire || this.held('fireAlt') || this.touch.fire) b |= Buttons.FIRE;
    const flow = settingsStore.get().flowMode === 'toggle' ? this.flowToggled : this.held('flow');
    if (flow || this.touch.flow) b |= Buttons.FLOW;
    if (this.mapOpen) b |= Buttons.MAP;
    return b;
  }

  takeActions(): ActionKind[] {
    const a = this.pendingActions;
    this.pendingActions = [];
    return this.enabled ? a : [];
  }

  /** Neutraliza entradas (perda de foco, menu, aba oculta). */
  releaseAll() {
    this.keys.clear();
    this.mouseFire = false;
    this.pendingActions = [];
    this.touch = { mx: 0, my: 0, fire: false, flow: false };
  }

  dispose() {
    this.releaseLock();
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners = [];
  }
}
