/**
 * Controles (Web Gamepad API): Xbox, PlayStation, Nintendo e genéricos, por USB
 * ou Bluetooth, no navegador, no Electron e no celular. Aqui ficam só funções
 * puras (família, glifos, zona morta, curva) e o "hub" que lê os controles uma
 * vez por quadro. Quem decide o que cada botão faz é o InputManager.
 *
 * Índices dos botões e eixos seguem o "standard mapping" do W3C
 * (https://w3c.github.io/gamepad/#remapping). Um controle sem esse mapeamento
 * ainda funciona, mas os botões podem estar em outra ordem: o jogo avisa e o
 * remapeamento resolve.
 */

export type PadFamily = 'xbox' | 'playstation' | 'nintendo' | 'generico';
export type PadPreset = 'auto' | PadFamily;

/** Botões do mapeamento padrão (posição física, não o rótulo impresso). */
export const PAD = {
  SUL: 0, // A / ✕ / B (Nintendo)
  LESTE: 1, // B / ○ / A
  OESTE: 2, // X / □ / Y
  NORTE: 3, // Y / △ / X
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8, // View / Create (Share) / −
  MENU: 9, // Menu / Options / +
  L3: 10,
  R3: 11,
  CIMA: 12,
  BAIXO: 13,
  ESQ: 14,
  DIR: 15,
  HOME: 16,
  TOUCHPAD: 17, // só alguns PlayStation expõem
} as const;

/** Ações do jogo que podem ir para um botão do controle. */
export type PadAction = 'fire' | 'flow' | 'contextual' | 'jump' | 'secondary' | 'special' | 'map' | 'menu' | 'recenter';

export const PAD_ACTIONS: readonly PadAction[] = ['fire', 'flow', 'contextual', 'jump', 'secondary', 'special', 'map', 'menu', 'recenter'];

export const PAD_ACTION_LABELS: Record<PadAction, string> = {
  fire: 'Usar ferramenta (disparar)',
  flow: 'Forma Pião',
  contextual: 'Ação contextual (Moringa; no mapa, Pião-Guia)',
  jump: 'Pular',
  secondary: 'Moringa',
  special: 'Roda de Oleiro',
  map: 'Mapa tático',
  menu: 'Menu',
  recenter: 'Recentralizar a câmera',
};

/** Layout padrão pedido no briefing (idêntico nas três famílias, pela posição física). */
export const DEFAULT_PAD_BINDS: Record<PadAction, number> = {
  fire: PAD.RT,
  flow: PAD.LB,
  contextual: PAD.LT,
  jump: PAD.SUL,
  secondary: PAD.RB,
  special: PAD.NORTE,
  map: PAD.VIEW,
  menu: PAD.MENU,
  recenter: PAD.R3,
};

/** Detecta a família pelo `Gamepad.id` (nome + vendor/product que o navegador expõe). */
export function padFamily(id: string): PadFamily {
  const s = id.toLowerCase();
  // IDs de fabricante USB: 045e Microsoft, 054c Sony, 057e Nintendo
  if (/xbox|xinput|x-box|045e|microsoft/.test(s)) return 'xbox';
  if (/dualsense|dualshock|playstation|054c|sony|ps[345] /.test(s) || /^wireless controller/.test(s)) return 'playstation';
  if (/nintendo|057e|pro controller|joy-?con/.test(s)) return 'nintendo';
  return 'generico';
}

/** Nome curto para avisos: "Controle Xbox", "Controle PlayStation"… */
export function familyName(f: PadFamily): string {
  return { xbox: 'Xbox', playstation: 'PlayStation', nintendo: 'Nintendo', generico: 'genérico' }[f];
}

const GLYPHS: Record<PadFamily, readonly string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→', 'Xbox', 'Botão 18'],
  playstation: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'PS', 'Touchpad'],
  // No Nintendo o botão de baixo se chama B e o da direita, A
  nintendo: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→', 'Home', 'Captura'],
  generico: ['Botão ↓', 'Botão →', 'Botão ←', 'Botão ↑', 'L1', 'R1', 'L2', 'R2', 'Select', 'Start', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'Central', 'Botão 18'],
};

/** Rótulo do botão `index` na família dada (ex.: 3 → "Y" / "△" / "X"). */
export function buttonGlyph(family: PadFamily, index: number): string {
  return GLYPHS[family][index] ?? `Botão ${index + 1}`;
}

/**
 * Zona morta radial com reescala: abaixo de `dz` o analógico é zero; acima, a
 * magnitude cresce de 0 a 1 sem salto. Mantém a direção (sem "cruz" nos eixos).
 */
export function radialDeadzone(x: number, y: number, dz: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= dz || m === 0) return [0, 0];
  const scaled = Math.min(1, (m - dz) / Math.max(1e-6, 1 - dz));
  return [(x / m) * scaled, (y / m) * scaled];
}

export type ResponseCurve = 'linear' | 'padrao' | 'precisa';
const CURVE_EXP: Record<ResponseCurve, number> = { linear: 1, padrao: 1.6, precisa: 2.4 };

/** Curva de resposta aplicada à magnitude (preserva direção). */
export function applyCurve(x: number, y: number, curve: ResponseCurve): [number, number] {
  const m = Math.hypot(x, y);
  if (m === 0) return [0, 0];
  const k = Math.pow(Math.min(1, m), CURVE_EXP[curve]) / m;
  return [x * k, y * k];
}

/** Velocidade máxima de giro da câmera com o analógico no fim de curso (rad/s). */
export const LOOK_RATE = { yaw: 3.4, pitch: 2.3 };

/** Gatilhos analógicos: aperta acima de PRESS, solta abaixo de RELEASE (histerese). */
const PRESS = 0.4;
const RELEASE = 0.25;

export interface PadFrame {
  /** Analógicos já com zona morta (sem curva: a curva é da câmera). */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  pressed: boolean[];
}

export interface PadInfo {
  index: number;
  id: string;
  family: PadFamily;
  standard: boolean;
  rumble: boolean;
}

type PadEvent = { type: 'connected' | 'disconnected'; info: PadInfo } | { type: 'press' | 'release'; button: number } | { type: 'activity' };

interface PadLike {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
  vibrationActuator?: { playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> } | null;
}

/**
 * Lê os controles e publica bordas (apertou/soltou), conexão e "atividade".
 * A Gamepad API não tem eventos de botão: com controle conectado a leitura é a
 * cada ~8 ms (independente do FPS, para um toque rápido não se perder num
 * quadro lento); sem controle, a cada 500 ms. Usa o controle mexido por último;
 * mais de um conectado não briga pelo personagem.
 */
export class GamepadHub {
  private listeners = new Set<(e: PadEvent) => void>();
  private prev = new Map<number, boolean[]>();
  private known = new Map<number, PadInfo>();
  private activeIndex: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  deadzones = { left: 0.15, right: 0.12 };
  frame: PadFrame = { lx: 0, ly: 0, rx: 0, ry: 0, pressed: [] };
  private readonly onConnect = (e: Event) => {
    this.scan((e as GamepadEvent).gamepad as unknown as PadLike);
    // passa já para a leitura rápida, sem esperar o ciclo lento
    if (this.started) this.loop();
  };
  private loop() {
    if (this.timer) clearTimeout(this.timer);
    this.poll();
    this.timer = setTimeout(() => this.loop(), this.known.size ? 8 : 500);
  }
  private readonly onDisconnect = (e: Event) => this.drop((e as GamepadEvent).gamepad.index);

  constructor(private readonly nav: { getGamepads?: () => (PadLike | null)[] } = typeof navigator !== 'undefined' ? (navigator as unknown as { getGamepads?: () => (PadLike | null)[] }) : {}) {}

  get supported(): boolean {
    return typeof this.nav.getGamepads === 'function';
  }

  get active(): PadInfo | null {
    return this.activeIndex === null ? null : (this.known.get(this.activeIndex) ?? null);
  }

  get connected(): PadInfo[] {
    return [...this.known.values()];
  }

  subscribe(fn: (e: PadEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    if (this.started || !this.supported || typeof window === 'undefined') return;
    this.started = true;
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
    this.loop();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
  }

  private emit(e: PadEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private scan(p: PadLike | null) {
    if (!p || !p.connected || this.known.has(p.index)) return;
    const info: PadInfo = { index: p.index, id: p.id.slice(0, 120), family: padFamily(p.id), standard: p.mapping === 'standard', rumble: typeof p.vibrationActuator?.playEffect === 'function' };
    this.known.set(p.index, info);
    this.prev.set(p.index, []);
    if (this.activeIndex === null) this.activeIndex = p.index;
    this.emit({ type: 'connected', info });
  }

  private drop(index: number) {
    const info = this.known.get(index);
    if (!info) return;
    this.known.delete(index);
    this.prev.delete(index);
    if (this.activeIndex === index) {
      // botões que estavam apertados neste controle são soltos
      this.releaseActive();
      this.activeIndex = this.known.keys().next().value ?? null;
    }
    this.emit({ type: 'disconnected', info });
  }

  private releaseActive() {
    const was = this.frame.pressed;
    this.frame = { lx: 0, ly: 0, rx: 0, ry: 0, pressed: [] };
    for (let b = 0; b < was.length; b++) if (was[b]) this.emit({ type: 'release', button: b });
  }

  /** Uma leitura. Público para testes; em jogo roda sozinho a cada ~8 ms. */
  poll() {
    let pads: (PadLike | null)[];
    try {
      pads = this.nav.getGamepads?.() ?? [];
    } catch {
      return; // política de permissões pode bloquear (iframe sem allow="gamepad")
    }
    const seen = new Set<number>();
    for (const p of pads) {
      if (!p || !p.connected) continue;
      seen.add(p.index);
      if (!this.known.has(p.index)) this.scan(p);
      const prev = this.prev.get(p.index) ?? [];
      // gatilhos analógicos usam o valor com histerese; os demais, o `pressed` do navegador
      const now = p.buttons.map((b, i) => ((i === PAD.LT || i === PAD.RT) && b.value > 0 ? (prev[i] ? b.value > RELEASE : b.value > PRESS) : b.pressed));
      const [lx, ly] = radialDeadzone(p.axes[0] ?? 0, p.axes[1] ?? 0, this.deadzones.left);
      const [rx, ry] = radialDeadzone(p.axes[2] ?? 0, p.axes[3] ?? 0, this.deadzones.right);
      const moved = lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0;
      const changed = now.some((v, i) => v !== !!prev[i]);
      if ((moved || changed) && this.activeIndex !== p.index) {
        // outro controle foi mexido: ele assume, e o anterior solta tudo
        this.releaseActive();
        this.activeIndex = p.index;
      }
      this.prev.set(p.index, now);
      if (this.activeIndex === p.index) {
        // estado atualizado ANTES das bordas: quem trata "apertou" já lê isPressed() verdadeiro
        this.frame = { lx, ly, rx, ry, pressed: now };
        for (let b = 0; b < now.length; b++) {
          if (now[b] && !prev[b]) this.emit({ type: 'press', button: b });
          else if (!now[b] && prev[b]) this.emit({ type: 'release', button: b });
        }
        if (moved || changed) this.emit({ type: 'activity' });
      }
    }
    // alguns navegadores não disparam gamepaddisconnected (ex.: Bluetooth caindo)
    for (const idx of [...this.known.keys()]) if (!seen.has(idx)) this.drop(idx);
  }

  isPressed(button: number): boolean {
    return !!this.frame.pressed[button];
  }

  /** Vibração curta no controle ativo. Silenciosa se o navegador/controle não suportar. */
  rumble(durationMs: number, weak: number, strong: number): boolean {
    const idx = this.activeIndex;
    if (idx === null) return false;
    let pad: PadLike | null = null;
    try {
      pad = this.nav.getGamepads?.()[idx] ?? null;
    } catch {
      return false;
    }
    const act = pad?.vibrationActuator;
    if (!act?.playEffect) return false;
    act
      .playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.round(Math.min(400, Math.max(10, durationMs))),
        weakMagnitude: Math.min(1, Math.max(0, weak)),
        strongMagnitude: Math.min(1, Math.max(0, strong)),
      })
      .catch(() => {});
    return true;
  }
}

/** Um hub por página: o jogo, o menu e a navegação de interface leem do mesmo. */
export const gamepadHub = new GamepadHub();

// ------------------------------------------------------------ vibração

export type RumbleKind = 'disparo' | 'dano' | 'moringa' | 'especial' | 'aterrissagem' | 'eliminado' | 'eliminou' | 'teste';

/** Perfis curtos (ms, fraco, forte) e intervalo mínimo entre repetições (ms). */
export const RUMBLE: Record<RumbleKind, { ms: number; weak: number; strong: number; gap: number }> = {
  disparo: { ms: 45, weak: 0.35, strong: 0, gap: 180 },
  dano: { ms: 110, weak: 0.3, strong: 0.55, gap: 160 },
  moringa: { ms: 140, weak: 0.4, strong: 0.6, gap: 200 },
  especial: { ms: 260, weak: 0.5, strong: 0.8, gap: 400 },
  aterrissagem: { ms: 70, weak: 0.1, strong: 0.45, gap: 250 },
  eliminado: { ms: 320, weak: 0.6, strong: 0.9, gap: 800 },
  eliminou: { ms: 90, weak: 0.55, strong: 0.2, gap: 200 },
  teste: { ms: 220, weak: 0.5, strong: 0.7, gap: 300 },
};

/**
 * Limita a vibração: cada tipo respeita o intervalo mínimo e o total vibrado
 * numa janela de 1 s fica abaixo de 45% (nunca vira vibração constante).
 */
export class RumbleGate {
  private last = new Map<RumbleKind, number>();
  private window: Array<[number, number]> = [];
  allow(kind: RumbleKind, now: number): boolean {
    const p = RUMBLE[kind];
    const l = this.last.get(kind);
    if (l !== undefined && now - l < p.gap) return false;
    this.window = this.window.filter(([t]) => now - t < 1000);
    const busy = this.window.reduce((a, [, ms]) => a + ms, 0);
    if (busy + p.ms > 450 && kind !== 'eliminado') return false;
    this.last.set(kind, now);
    this.window.push([now, p.ms]);
    return true;
  }
}
